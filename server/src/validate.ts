/** Prüfung der Request-Bodys der API-Endpunkte. */

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

/** Seiten mit Textzeilen prüfen (gemeinsam für Schwärzen und Fragen). */
export function parsePages(body: unknown, maxChars: number): PageText[] {
  return parseSuggestRequest(body, maxChars).pages
}

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

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AskRequest {
  pages: PageText[]
  messages: ChatMessage[]
}

export const MAX_MESSAGES = 40
export const MAX_MESSAGE_LENGTH = 4_000

/**
 * POST /api/ask: Dokumenttext + Gesprächsverlauf. Der Verlauf beginnt und endet mit
 * einer Nutzerfrage, Rollen wechseln sich ab.
 */
export function parseAskRequest(body: unknown, maxChars: number): AskRequest {
  const pages = parsePages(body, maxChars)
  const raw = (body as { messages?: unknown }).messages
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) {
    throw new ValidationError(`"messages" muss 1 bis ${MAX_MESSAGES} Einträge haben.`)
  }
  const messages = raw.map((m, i): ChatMessage => {
    const { role, content } = (m ?? {}) as { role?: unknown; content?: unknown }
    const expected = i % 2 === 0 ? 'user' : 'assistant'
    if (role !== expected) {
      throw new ValidationError(`Nachricht ${i + 1}: Rolle "${expected}" erwartet.`)
    }
    if (typeof content !== 'string' || !content.trim()) {
      throw new ValidationError(`Nachricht ${i + 1}: Text fehlt.`)
    }
    // Frühere Antworten dürfen länger sein als Fragen.
    const limit = role === 'user' ? MAX_MESSAGE_LENGTH : MAX_MESSAGE_LENGTH * 4
    if (content.length > limit) {
      throw new ValidationError(`Nachricht ${i + 1}: höchstens ${limit} Zeichen.`)
    }
    return { role: expected, content }
  })
  if (messages[messages.length - 1]?.role !== 'user') {
    throw new ValidationError('Die letzte Nachricht muss eine Frage sein.')
  }
  return { pages, messages }
}

export const REWRITE_MODES = ['correct', 'shorter', 'formal', 'simple', 'translate'] as const
export type RewriteMode = (typeof REWRITE_MODES)[number]

/** Zielsprachen, deren Zeichen die PDF-Standardschriften (WinAnsi) darstellen können. */
export const REWRITE_LANGUAGES = ['de', 'en', 'fr', 'es', 'it', 'nl', 'pt'] as const
export type RewriteLanguage = (typeof REWRITE_LANGUAGES)[number]

export interface RewriteRequest {
  text: string
  mode: RewriteMode
  /** Nur bei mode 'translate'. */
  language?: RewriteLanguage
  /** Ersetzt eine vorhandene PDF-Zeile → Ergebnis einzeilig, ähnlich lang. */
  singleLine: boolean
}

export const MAX_REWRITE_LENGTH = 4_000

/** POST /api/rewrite: einen Textabschnitt umschreiben oder übersetzen. */
export function parseRewriteRequest(body: unknown): RewriteRequest {
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError('Erwartet: { "text": "…", "mode": "correct" }')
  }
  const { text, mode, language, singleLine } = body as Record<string, unknown>
  if (typeof text !== 'string' || !text.trim()) throw new ValidationError('Text fehlt.')
  if (text.length > MAX_REWRITE_LENGTH) {
    throw new ValidationError(`Höchstens ${MAX_REWRITE_LENGTH} Zeichen.`, 413)
  }
  if (!REWRITE_MODES.includes(mode as RewriteMode)) {
    throw new ValidationError(`"mode" muss einer von ${REWRITE_MODES.join(', ')} sein.`)
  }
  if (singleLine !== undefined && typeof singleLine !== 'boolean') {
    throw new ValidationError('"singleLine" muss true oder false sein.')
  }
  const req: RewriteRequest = {
    text,
    mode: mode as RewriteMode,
    singleLine: singleLine ?? false,
  }
  if (mode === 'translate') {
    if (!REWRITE_LANGUAGES.includes(language as RewriteLanguage)) {
      throw new ValidationError(`"language" muss einer von ${REWRITE_LANGUAGES.join(', ')} sein.`)
    }
    req.language = language as RewriteLanguage
  }
  return req
}
