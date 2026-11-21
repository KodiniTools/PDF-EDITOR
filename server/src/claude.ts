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

/** Gemeinsame Request-Felder: Modell, automatischer Fallback bei Ablehnung. */
export function baseParams(opts: Omit<CallOptions, 'signal'>, maxTokens: number) {
  return {
    model: opts.model,
    max_tokens: maxTokens,
    // Bei einer Ablehnung durch Sicherheitsklassifikatoren automatisch auf das
    // empfohlene Ausweichmodell wechseln.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  } satisfies Partial<StreamParams>
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
