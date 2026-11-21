/** Gemeinsames für alle KI-Funktionen: SDK-Schnittstelle, Fehler, Auswertung der Antwort. */
import type Anthropic from '@anthropic-ai/sdk'

import type { Effort } from './config.ts'

export type BetaMessage = Anthropic.Beta.Messages.BetaMessage
export type StreamParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming

/** Minimale Schnittstelle zum SDK, damit Tests ohne Netz laufen. */
export type StreamFn = (
  params: StreamParams,
  options: { signal: AbortSignal },
) => { finalMessage(): Promise<BetaMessage> }

export interface CallOptions {
  model: string
  effort: Effort
  signal: AbortSignal
}

/** Fehler mit HTTP-Status und nutzerfreundlicher Meldung. */
export class SuggestError extends Error {
  override name = 'SuggestError'
  readonly status: number
  constructor(message: string, status: number, options?: { cause?: unknown }) {
    super(message, options)
    this.status = status
  }
}

/**
 * Gemeinsame Request-Felder. Bewusst ohne serverseitigen Fallback (`fallbacks`):
 * Die Anfrage läuft und wird abgerechnet ausschließlich über das gewählte Modell.
 * Lehnt es ab, kommt eine verständliche Fehlermeldung (422) statt eines stillen
 * Modellwechsels. (Claude Haiku 5.5 würde `fallbacks` ohnehin mit 400 ablehnen.)
 */
export function baseParams(opts: Omit<CallOptions, 'signal'>, maxTokens: number) {
  return {
    model: opts.model,
    max_tokens: maxTokens,
  } satisfies Partial<StreamParams>
}

/** Tatsächlich verwendetes Modell und Tokenverbrauch einer Anfrage (für Anzeige/Log). */
export interface UsageMeta {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/**
 * Hüllt `stream` ein und summiert Modell + Tokens aller Antworten einer Anfrage.
 * `message.model` ist das Modell, das die Antwort wirklich erzeugt hat.
 */
export function trackUsage(stream: StreamFn): { stream: StreamFn; meta: () => UsageMeta | null } {
  let meta: UsageMeta | null = null
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    stream: (params, options) => {
      const inner = stream(params, options)
      return {
        finalMessage: async () => {
          const message = await inner.finalMessage()
          const u = (message.usage ?? {}) as unknown as Record<string, unknown>
          meta = {
            model: typeof message.model === 'string' ? message.model : params.model,
            inputTokens: (meta?.inputTokens ?? 0) + n(u.input_tokens),
            outputTokens: (meta?.outputTokens ?? 0) + n(u.output_tokens),
            cacheReadTokens: (meta?.cacheReadTokens ?? 0) + n(u.cache_read_input_tokens),
            cacheWriteTokens: (meta?.cacheWriteTokens ?? 0) + n(u.cache_creation_input_tokens),
          }
          return message
        },
      }
    },
    meta: () => meta,
  }
}

export function textOf(message: BetaMessage): string {
  return message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')
}

/** Ruft Claude auf, prüft den Stop-Grund und liefert den Antworttext. */
export async function callClaude(
  stream: StreamFn,
  params: StreamParams,
  signal: AbortSignal,
  tooLongHint: string,
): Promise<string> {
  const message = await stream(params, { signal }).finalMessage()
  switch (message.stop_reason) {
    case 'refusal':
      throw new SuggestError('Claude hat die Bearbeitung dieser Anfrage abgelehnt.', 422, {
        cause: message.stop_details,
      })
    case 'max_tokens':
    case 'model_context_window_exceeded':
      throw new SuggestError(`Die Antwort war zu lang. ${tooLongHint}`, 422)
    default:
      return textOf(message)
  }
}

/** Liest strukturierte Ausgabe (output_config.format). */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new SuggestError('Die Antwort von Claude war nicht lesbar.', 502, { cause: err })
  }
}
