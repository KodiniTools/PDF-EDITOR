/** Prüfung des Request-Bodys von POST /api/redaction-suggestions. */

export interface PageText {
  /** 1-basierte Seitennummer in der aktuellen Seitenliste des Editors. */
  page: number
  /** Erkannte Textzeilen der Seite (pdf.js). */
  lines: string[]
}

export interface SuggestRequest {
  pages: PageText[]
}

export class ValidationError extends Error {
  override name = 'ValidationError'
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export const MAX_PAGES = 200
export const MAX_LINES_PER_PAGE = 2_000
export const MAX_LINE_LENGTH = 2_000

export function parseSuggestRequest(body: unknown, maxChars: number): SuggestRequest {
  if (
    typeof body !== 'object' ||
    body === null ||
    !Array.isArray((body as { pages?: unknown }).pages)
  ) {
    throw new ValidationError('Erwartet: { "pages": [{ "page": 1, "lines": ["…"] }] }')
  }
  const rawPages = (body as { pages: unknown[] }).pages
  if (rawPages.length === 0) throw new ValidationError('Keine Seiten übergeben.')
  if (rawPages.length > MAX_PAGES)
    throw new ValidationError(`Höchstens ${MAX_PAGES} Seiten pro Anfrage.`)

  const seen = new Set<number>()
  let chars = 0
  const pages: PageText[] = rawPages.map((p, i) => {
    if (typeof p !== 'object' || p === null) throw new ValidationError(`Seite ${i + 1}: ungültig.`)
    const { page, lines } = p as { page?: unknown; lines?: unknown }
    if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > 100_000) {
      throw new ValidationError(`Seite ${i + 1}: "page" muss eine positive ganze Zahl sein.`)
    }
    if (seen.has(page)) throw new ValidationError(`Seite ${page} ist doppelt.`)
    seen.add(page)
    if (!Array.isArray(lines) || lines.length > MAX_LINES_PER_PAGE) {
      throw new ValidationError(
        `Seite ${page}: "lines" muss ein Array mit höchstens ${MAX_LINES_PER_PAGE} Einträgen sein.`,
      )
    }
    const clean = lines.map((l) => {
      if (typeof l !== 'string' || l.length > MAX_LINE_LENGTH) {
        throw new ValidationError(
          `Seite ${page}: Zeilen müssen Strings mit höchstens ${MAX_LINE_LENGTH} Zeichen sein.`,
        )
      }
      chars += l.length + 1
      return l
    })
    return { page, lines: clean }
  })

  if (chars > maxChars) {
    throw new ValidationError(`Zu viel Text auf einmal (${chars} > ${maxChars} Zeichen).`, 413)
  }
  return { pages }
}
