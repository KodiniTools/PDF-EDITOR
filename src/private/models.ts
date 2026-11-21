/**
 * Bekannte Claude-Modelle für die Auswahl im privaten Build: Anzeigename und
 * Listenpreise (USD pro 1 Mio. Tokens, Stand 11/2026) für eine Kostenschätzung.
 * Welche Modelle wählbar sind, bestimmt der Server (GET /api/health → models).
 */
import type { UsageMeta } from './suggestions/api'

export interface ModelInfo {
  label: string
  hint: string
  /** USD pro 1 Mio. Tokens. */
  input: number
  output: number
  /** Optional: höherer Tarif ab dieser Prompt-Größe (Tokens). */
  longPrompt?: { above: number; input: number; output: number }
}

export const MODEL_INFO: Record<string, ModelInfo> = {
  'claude-opus-5-5': { label: 'Opus 5.5', hint: 'ausgewogen, Standard', input: 4, output: 20 },
  'claude-sonnet-5-5': { label: 'Sonnet 5.5', hint: 'günstiger', input: 2, output: 10 },
  'claude-haiku-5-5': {
    label: 'Haiku 5.5',
    hint: 'schnell, sehr günstig',
    input: 0.1,
    output: 0.5,
    longPrompt: { above: 100_000, input: 0.5, output: 2.5 },
  },
  'claude-fable-5-2': { label: 'Fable 5.2', hint: 'stärkstes Modell, teuer', input: 8, output: 40 },
}

export function modelLabel(id: string): string {
  return MODEL_INFO[id]?.label ?? id
}

/**
 * Geschätzte Kosten in USD (Listenpreis; Cache-Lesen ≈ 0,05×, Cache-Schreiben ≈ 1,25×
 * Eingabepreis). null, wenn das Modell unbekannt ist.
 */
export function estimateCost(meta: UsageMeta): number | null {
  const info = MODEL_INFO[meta.model]
  if (!info) return null
  const promptTokens = meta.inputTokens + meta.cacheReadTokens + meta.cacheWriteTokens
  const tier = info.longPrompt && promptTokens > info.longPrompt.above ? info.longPrompt : info
  return (
    (meta.inputTokens * tier.input +
      meta.outputTokens * tier.output +
      meta.cacheReadTokens * tier.input * 0.05 +
      meta.cacheWriteTokens * tier.input * 1.25) /
    1_000_000
  )
}

export function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return '< $0.01'
  return `$${value.toFixed(2)}`
}
