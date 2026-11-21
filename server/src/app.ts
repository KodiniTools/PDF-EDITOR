/**
 * HTTP-Schicht (node:http, ohne Framework). nginx leitet
 * /pdf-editor-privat/api/* → http://127.0.0.1:<PORT>/api/* weiter und übernimmt
 * TLS und Zugriffsschutz (Basic Auth). Der Server lauscht nur auf localhost.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import Anthropic from '@anthropic-ai/sdk'

import type { Config } from './config.ts'
import { SuggestError, suggestRedactions, type StreamFn } from './suggest.ts'
import { parseSuggestRequest, ValidationError } from './validate.ts'

export interface AppDeps {
  config: Pick<Config, 'model' | 'effort' | 'maxBodyBytes' | 'maxChars' | 'timeoutMs'>
  stream: StreamFn
  log?: (line: string) => void
  /** Gleichzeitige Analysen (Schutz vor versehentlichem Mehrfachklick/Kosten). */
  maxConcurrent?: number
}

class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent || res.destroyed) return
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(json)
}

async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  const type = req.headers['content-type'] ?? ''
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type muss application/json sein.')
  }
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) {
    throw new HttpError(413, 'Anfrage zu groß.')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > limit) throw new HttpError(413, 'Anfrage zu groß.')
    chunks.push(buf)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'Ungültiges JSON.')
  }
}

/** Übersetzt Fehler in Status + nutzerfreundliche Meldung (ohne interne Details). */
export function toHttpError(err: unknown, timedOut: boolean): HttpError {
  if (err instanceof HttpError) return err
  if (err instanceof ValidationError) return new HttpError(err.status, err.message)
  if (err instanceof SuggestError) return new HttpError(err.status, err.message)
  if (timedOut)
    return new HttpError(
      504,
      'Die Analyse hat zu lange gedauert. Bitte weniger Seiten auf einmal prüfen.',
    )
  if (err instanceof Anthropic.RateLimitError) {
    return new HttpError(429, 'Die KI ist gerade ausgelastet. Bitte gleich noch einmal versuchen.')
  }
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError
  ) {
    return new HttpError(500, 'Der Server ist falsch konfiguriert (API-Schlüssel).')
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new HttpError(502, 'Die KI hat die Anfrage abgelehnt.')
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new HttpError(502, 'Die KI ist nicht erreichbar.')
  }
  if (err instanceof Anthropic.APIError) {
    return new HttpError(502, 'Fehler bei der KI-Anfrage.')
  }
  return new HttpError(500, 'Interner Fehler.')
}

export function createHandler(deps: AppDeps) {
  const log = deps.log ?? ((line: string) => console.log(line))
  const maxConcurrent = deps.maxConcurrent ?? 2
  let running = 0

  async function suggestions(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (running >= maxConcurrent) {
      send(res, 429, { error: 'Es läuft bereits eine Analyse. Bitte warten.' })
      return
    }
    running++
    const started = Date.now()
    const client = new AbortController()
    // Browser bricht ab (Seite geschlossen, „Abbrechen“) → KI-Aufruf ebenfalls abbrechen.
    res.on('close', () => {
      if (!res.writableFinished) client.abort()
    })
    const timeout = AbortSignal.timeout(deps.config.timeoutMs)
    const signal = AbortSignal.any([client.signal, timeout])
    let chars = 0
    try {
      const body = await readJson(req, deps.config.maxBodyBytes)
      const input = parseSuggestRequest(body, deps.config.maxChars)
      chars = input.pages.reduce((n, p) => n + p.lines.reduce((m, l) => m + l.length, 0), 0)
      const findings = await suggestRedactions(deps.stream, input, {
        model: deps.config.model,
        effort: deps.config.effort,
        signal,
      })
      send(res, 200, { findings })
      // Bewusst ohne Dokumentinhalt im Log.
      log(
        `suggest ok pages=${input.pages.length} chars=${chars} findings=${findings.length} ms=${Date.now() - started}`,
      )
    } catch (err) {
      if (client.signal.aborted) {
        log(`suggest abgebrochen (Client) chars=${chars} ms=${Date.now() - started}`)
        return
      }
      const httpErr = toHttpError(err, timeout.aborted)
      log(
        `suggest fehler status=${httpErr.status} chars=${chars} ms=${Date.now() - started} ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
      )
      send(res, httpErr.status, { error: httpErr.message })
    } finally {
      running--
    }
  }

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    try {
      if (url.pathname === '/api/health') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          send(res, 405, { error: 'Methode nicht erlaubt.' })
          return
        }
        send(res, 200, { ok: true, model: deps.config.model })
        return
      }
      if (url.pathname === '/api/redaction-suggestions') {
        if (req.method !== 'POST') {
          send(res, 405, { error: 'Methode nicht erlaubt.' })
          return
        }
        await suggestions(req, res)
        return
      }
      send(res, 404, { error: 'Nicht gefunden.' })
    } catch (err) {
      log(`unerwarteter Fehler: ${err instanceof Error ? err.stack : String(err)}`)
      send(res, 500, { error: 'Interner Fehler.' })
    }
  }
}
