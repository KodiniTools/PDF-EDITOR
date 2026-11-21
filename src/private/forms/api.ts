/** Wertvorschläge für Formularfelder (POST <base>api/form-suggestions). */
import { postJson, SuggestApiError, type PagePayload } from '../suggestions/api'

export type FieldKind = 'text' | 'checkbox' | 'radio' | 'choice'

export interface FieldPayload {
  id: string
  type: FieldKind
  label: string
  context: string
  page: number
  options?: string[]
  multiline?: boolean
  maxLength?: number
}

export interface FieldSuggestion {
  id: string
  value: string
  reason: string
}

export async function requestFormSuggestions(
  input: { fields: FieldPayload[]; profile: string; pages: PagePayload[] },
  signal: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<FieldSuggestion[]> {
  const body = await postJson('form-suggestions', input, signal, fetchFn)
  const list = (body as { suggestions?: unknown } | null)?.suggestions
  if (!Array.isArray(list)) throw new SuggestApiError('Unerwartete Antwort vom Server.', 502)
  return list.flatMap((s: unknown) => {
    const { id, value, reason } = (s ?? {}) as Record<string, unknown>
    if (typeof id !== 'string' || typeof value !== 'string') return []
    return [{ id, value, reason: typeof reason === 'string' ? reason : '' }]
  })
}
