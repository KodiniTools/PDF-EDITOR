/** Fragen zum Dokument über das private Backend (POST <base>api/ask). */
import { postJson, SuggestApiError, type PagePayload } from '../suggestions/api'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Schickt Dokumenttext und Gesprächsverlauf (abwechselnd user/assistant, letzte
 * Nachricht = Frage) und liefert die Antwort als Text.
 */
export async function requestAnswer(
  pages: readonly PagePayload[],
  messages: readonly ChatMessage[],
  signal: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const body = await postJson('ask', { pages, messages }, signal, fetchFn)
  const answer = (body as { answer?: unknown } | null)?.answer
  if (typeof answer !== 'string') throw new SuggestApiError('Unerwartete Antwort vom Server.', 502)
  return answer
}
