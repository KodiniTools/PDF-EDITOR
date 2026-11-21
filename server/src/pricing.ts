/**
 * Listenpreise (USD pro 1 Mio. Tokens, Stand 11/2026) für die eigene Kostenzählung.
 * Muss zu MODEL_INFO in src/private/models.ts passen (gleiche Zahlen im Browser).
 */
import type { UsageMeta } from './claude.ts'

interface Price {
  input: number
  output: number
  /** Optional: höherer Tarif ab dieser Prompt-Größe (Tokens). */
  longPrompt?: { above: number; input: number; output: number }
}

export const MODEL_PRICES: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    longPrompt: { above: 100_000, input: 0.5, output: 2.5 },
  },
  'claude-fable-5-2': { input: 8, output: 40 },
}

/**
 * Geschätzte Kosten in USD (Cache-Lesen ≈ 0,05×, Cache-Schreiben ≈ 1,25× Eingabepreis).
 * null, wenn das Modell keinen hinterlegten Preis hat.
 */
export function estimateCost(meta: UsageMeta): number | null {
  const price = MODEL_PRICES[meta.model]
  if (!price) return null
  const promptTokens = meta.inputTokens + meta.cacheReadTokens + meta.cacheWriteTokens
  const tier = price.longPrompt && promptTokens > price.longPrompt.above ? price.longPrompt : price
  return (
    (meta.inputTokens * tier.input +
      meta.outputTokens * tier.output +
      meta.cacheReadTokens * tier.input * 0.05 +
      meta.cacheWriteTokens * tier.input * 1.25) /
    1_000_000
  )
}
