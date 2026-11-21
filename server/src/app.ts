/**
 * HTTP-Schicht (node:http, ohne Framework). nginx leitet
 * /pdf-editor-privat/api/* → http://127.0.0.1:<PORT>/api/* weiter und übernimmt
 * TLS und Zugriffsschutz (Basic Auth). Der Server lauscht nur auf localhost.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import Anthropic from '@anthropic-ai/sdk'

import { askDocument } from './ask.ts'
import { SuggestError, type StreamFn } from './claude.ts'
import type { Config } from './config.ts'
import { suggestRedactions } from './suggest.ts'
import { parseAskRequest, parseSuggestRequest, ValidationError, type PageText } from './validate.ts'

export interface AppDeps {
  config: Pick<
    Config,
    'model' | 'effort' | 'maxBodyBytes' | 'maxChars' | 'maxAskChars' | 'timeoutMs'
  >
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

  const countChars = (pages: readonly PageText[]) =>
    pages.reduce((n, p) => n + p.lines.reduce((m, l) => m + l.length, 0), 0)

  /**
   * Führt einen KI-Endpunkt aus: Body lesen, Abbruch (Client weg / Zeitlimit),
   * Begrenzung gleichzeitiger Aufrufe, Fehler → verständliche Meldung.
   * `run` liefert die Antwort und eine Log-Zeile – bewusst ohne Dokumentinhalt.
   */
  async function aiEndpoint(
    name: string,
    req: IncomingMessage,
    res: ServerResponse,
    run: (body: unknown, signal: AbortSignal) => Promise<{ body: unknown; log: string }>,
  ): Promise<void> {
    if (running >= maxConcurrent) {
      send(res, 429, { error: 'Es läuft bereits eine KI-Anfrage. Bitte warten.' })
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
    try {
      const body = await readJson(req, deps.config.maxBodyBytes)
      const result = await run(body, signal)
      send(res, 200, result.body)
      log(`${name} ok ${result.log} ms=${Date.now() - started}`)
    } catch (err) {
      if (client.signal.aborted) {
        log(`${name} abgebrochen (Client) ms=${Date.now() - started}`)
        return
      }
      const httpErr = toHttpError(err, timeout.aborted)
      log(
        `${name} fehler status=${httpErr.status} ms=${Date.now() - started} ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
      )
      send(res, httpErr.status, { error: httpErr.message })
    } finally {
      running--
    }
  }

  const callOpts = (signal: AbortSignal) => ({
    model: deps.config.model,
    effort: deps.config.effort,
    signal,
  })

  const routes: Record<string, (req: IncomingMessage, res: ServerResponse) => Promise<void>> = {
    '/api/redaction-suggestions': (req, res) =>
      aiEndpoint('suggest', req, res, async (body, signal) => {
        const input = parseSuggestRequest(body, deps.config.maxChars)
        const findings = await suggestRedactions(deps.stream, input, callOpts(signal))
        return {
          body: { findings },
          log: `pages=${input.pages.length} chars=${countChars(input.pages)} findings=${findings.length}`,
        }
      }),
    '/api/ask': (req, res) =>
      aiEndpoint('ask', req, res, async (body, signal) => {
        const input = parseAskRequest(body, deps.config.maxAskChars)
        const answer = await askDocument(deps.stream, input, callOpts(signal))
        return {
          body: { answer },
          log: `pages=${input.pages.length} chars=${countChars(input.pages)} turns=${input.messages.length}`,
        }
      }),
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
      const route = Object.hasOwn(routes, url.pathname) ? routes[url.pathname] : undefined
      if (route) {
        if (req.method !== 'POST') {
          send(res, 405, { error: 'Methode nicht erlaubt.' })
          return
        }
        await route(req, res)
        return
      }
      send(res, 404, { error: 'Nicht gefunden.' })
    } catch (err) {
      log(`unerwarteter Fehler: ${err instanceof Error ? err.stack : String(err)}`)
      send(res, 500, { error: 'Interner Fehler.' })
    }
  }
}
