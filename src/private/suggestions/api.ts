/** Aufruf des privaten Backends (server/), erreichbar unter <base>/api/ hinter nginx. */
import { toCategory, type Category } from './categories'

export interface PagePayload {
  /** 1-basierte Position in der aktuellen Seitenliste. */
  page: number
  lines: string[]
}

export interface Finding {
  page: number
  text: string
  category: Category
  reason: string
}

export class SuggestApiError extends Error {
  readonly status: number
  readonly cause: unknown
  constructor(message: string, status: number, options?: { cause?: unknown }) {
    super(message)
    this.name = 'SuggestApiError'
    this.status = status
    this.cause = options?.cause
  }
}

/** Zeitlimit pro Anfrage (Backend bricht nach 180 s ab). */
export const REQUEST_TIMEOUT_MS = 200_000

const API_BASE = `${import.meta.env.BASE_URL}api/`

function messageForStatus(status: number, serverMessage: string | undefined): string {
  if (status === 401) return 'Anmeldung abgelaufen. Bitte die Seite neu laden und erneut anmelden.'
  if (serverMessage) return serverMessage
  if (status === 413) return 'Zu viel Text auf einmal.'
  if (status === 429) return 'Die KI ist gerade ausgelastet. Bitte gleich noch einmal versuchen.'
  if (status === 502 || status === 503) return 'Das KI-Backend ist nicht erreichbar.'
  if (status === 504) return 'Die Anfrage hat zu lange gedauert.'
  return `Anfrage fehlgeschlagen (HTTP ${status}).`
}

function parseFindings(body: unknown): Finding[] {
  const list = (body as { findings?: unknown } | null)?.findings
  if (!Array.isArray(list)) throw new SuggestApiError('Unerwartete Antwort vom Server.', 502)
  return list.flatMap((f: unknown) => {
    const { page, text, category, reason } = (f ?? {}) as Record<string, unknown>
    if (typeof page !== 'number' || typeof text !== 'string' || !text.trim()) return []
    return [
      {
        page,
        text,
        category: toCategory(category),
        reason: typeof reason === 'string' ? reason : '',
      },
    ]
  })
}

/**
 * POST an einen Endpunkt des privaten Backends (`<base>api/<path>`) mit
 * Zeitlimit, Abbruch und verständlichen Fehlermeldungen (SuggestApiError).
 * Abbruch über `signal` wirft einen DOMException('AbortError').
 */
export async function postJson(
  path: string,
  payload: unknown,
  signal: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetchFn(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.any([signal, timeout]),
      credentials: 'same-origin',
    })
  } catch (err) {
    if (signal.aborted) throw err
    if (timeout.aborted)
      throw new SuggestApiError('Die Anfrage hat zu lange gedauert.', 504, { cause: err })
    throw new SuggestApiError('Server nicht erreichbar. Läuft das Backend?', 0, { cause: err })
  }

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // z. B. HTML-Fehlerseite von nginx
  }
  if (!res.ok) {
    const serverMessage = (body as { error?: unknown } | null)?.error
    throw new SuggestApiError(
      messageForStatus(res.status, typeof serverMessage === 'string' ? serverMessage : undefined),
      res.status,
    )
  }
  return body
}

/** Fragt Schwärzungsvorschläge für die übergebenen Seiten ab. */
export async function requestSuggestions(
  pages: readonly PagePayload[],
  signal: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<Finding[]> {
  return parseFindings(await postJson('redaction-suggestions', { pages }, signal, fetchFn))
}
