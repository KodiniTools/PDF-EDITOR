/** Text umschreiben/übersetzen über das private Backend (POST <base>api/rewrite). */
import { postJson, SuggestApiError } from '../suggestions/api'

export type RewriteMode = 'correct' | 'shorter' | 'formal' | 'simple' | 'translate'
/** Muss zu REWRITE_LANGUAGES in server/src/validate.ts passen. */
export type RewriteLanguage = 'de' | 'en' | 'hr' | 'bs' | 'it' | 'es' | 'fr' | 'nl' | 'pt'

export const MODE_LABELS: Record<Exclude<RewriteMode, 'translate'>, string> = {
  correct: 'Korrigieren',
  shorter: 'Kürzer',
  formal: 'Förmlicher',
  simple: 'Einfacher',
}

export const LANGUAGE_LABELS: Record<RewriteLanguage, string> = {
  de: 'Deutsch',
  en: 'Englisch',
  hr: 'Kroatisch',
  bs: 'Bosnisch',
  it: 'Italienisch',
  es: 'Spanisch',
  fr: 'Französisch',
  nl: 'Niederländisch',
  pt: 'Portugiesisch',
}

export const MAX_REWRITE_LENGTH = 4_000

export interface RewriteInput {
  text: string
  mode: RewriteMode
  language?: RewriteLanguage
  singleLine: boolean
}

export async function requestRewrite(
  input: RewriteInput,
  signal: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const body = await postJson('rewrite', input, signal, fetchFn)
  const text = (body as { text?: unknown } | null)?.text
  if (typeof text !== 'string' || !text.trim()) {
    throw new SuggestApiError('Unerwartete Antwort vom Server.', 502)
  }
  return text
}
