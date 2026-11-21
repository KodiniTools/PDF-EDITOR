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

export const OCR_MEDIA_TYPES = ['image/jpeg', 'image/png'] as const
export type OcrMediaType = (typeof OCR_MEDIA_TYPES)[number]
export const MAX_OCR_SIDE = 4_000

export interface OcrRequest {
  /** Base64 ohne data:-Präfix. */
  image: string
  mediaType: OcrMediaType
  width: number
  height: number
}

/** POST /api/ocr: Bild einer gescannten Seite. */
export function parseOcrRequest(body: unknown): OcrRequest {
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError('Erwartet: { "image": "<base64>", "mediaType", "width", "height" }')
  }
  const { image, mediaType, width, height } = body as Record<string, unknown>
  if (typeof image !== 'string' || image.length < 100 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) {
    throw new ValidationError('"image" muss ein Base64-kodiertes Bild sein.')
  }
  if (!OCR_MEDIA_TYPES.includes(mediaType as OcrMediaType)) {
    throw new ValidationError(`"mediaType" muss einer von ${OCR_MEDIA_TYPES.join(', ')} sein.`)
  }
  for (const [name, v] of [
    ['width', width],
    ['height', height],
  ] as const) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > MAX_OCR_SIDE) {
      throw new ValidationError(`"${name}" muss eine ganze Zahl von 1 bis ${MAX_OCR_SIDE} sein.`)
    }
  }
  return {
    image,
    mediaType: mediaType as OcrMediaType,
    width: width as number,
    height: height as number,
  }
}

export const FIELD_TYPES = ['text', 'checkbox', 'radio', 'choice'] as const
export type FieldType = (typeof FIELD_TYPES)[number]

export interface FormFieldInput {
  id: string
  type: FieldType
  /** Feldname, Tooltip (TU) bzw. Beschriftung daneben. */
  label: string
  /** Text in der Nähe des Felds (Beschriftung auf der Seite). */
  context: string
  page: number
  options?: string[]
  multiline?: boolean
  maxLength?: number
}

export interface FormRequest {
  fields: FormFieldInput[]
  /** Stammdaten des Nutzers, frei formuliert. */
  profile: string
  /** Optional: Text der Seiten mit Feldern (Hinweise im Formular). */
  pages: PageText[]
}

export const MAX_FIELDS = 500
export const MAX_PROFILE_LENGTH = 20_000

function str(v: unknown, max: number, name: string, required = false): string {
  if (v === undefined && !required) return ''
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) {
    throw new ValidationError(`"${name}" muss ein Text mit höchstens ${max} Zeichen sein.`)
  }
  return v
}

/** POST /api/form-suggestions: Felder, Stammdaten und optional Seitentext. */
export function parseFormRequest(body: unknown, maxChars: number): FormRequest {
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError('Erwartet: { "fields": [...], "profile": "…" }')
  }
  const { fields, profile, pages } = body as Record<string, unknown>
  if (!Array.isArray(fields) || fields.length === 0 || fields.length > MAX_FIELDS) {
    throw new ValidationError(`"fields" muss 1 bis ${MAX_FIELDS} Einträge haben.`)
  }
  const ids = new Set<string>()
  const parsed = fields.map((f, i): FormFieldInput => {
    if (typeof f !== 'object' || f === null) throw new ValidationError(`Feld ${i + 1}: ungültig.`)
    const r = f as Record<string, unknown>
    const id = str(r.id, 100, 'id', true)
    if (ids.has(id)) throw new ValidationError(`Feld-ID "${id}" ist doppelt.`)
    ids.add(id)
    if (!FIELD_TYPES.includes(r.type as FieldType)) {
      throw new ValidationError(`Feld ${id}: "type" muss einer von ${FIELD_TYPES.join(', ')} sein.`)
    }
    const type = r.type as FieldType
    if (typeof r.page !== 'number' || !Number.isInteger(r.page) || r.page < 1) {
      throw new ValidationError(`Feld ${id}: "page" muss eine positive ganze Zahl sein.`)
    }
    const out: FormFieldInput = {
      id,
      type,
      label: str(r.label, 300, 'label'),
      context: str(r.context, 500, 'context'),
      page: r.page,
    }
    if (type === 'choice' || type === 'radio') {
      if (
        !Array.isArray(r.options) ||
        r.options.length === 0 ||
        r.options.length > 200 ||
        !r.options.every((o) => typeof o === 'string' && o.length <= 200)
      ) {
        throw new ValidationError(`Feld ${id}: "options" muss 1 bis 200 Texte enthalten.`)
      }
      out.options = r.options as string[]
    }
    if (r.multiline !== undefined) out.multiline = r.multiline === true
    if (r.maxLength !== undefined) {
      if (typeof r.maxLength !== 'number' || !Number.isInteger(r.maxLength) || r.maxLength < 1) {
        throw new ValidationError(`Feld ${id}: "maxLength" muss eine positive ganze Zahl sein.`)
      }
      out.maxLength = r.maxLength
    }
    return out
  })
  const text = str(profile, MAX_PROFILE_LENGTH, 'profile')
  const pageTexts =
    pages === undefined || (Array.isArray(pages) && pages.length === 0)
      ? []
      : parsePages({ pages }, maxChars)
  if (!text.trim() && pageTexts.length === 0) {
    throw new ValidationError('Bitte Stammdaten hinterlegen.')
  }
  return { fields: parsed, profile: text, pages: pageTexts }
}

/**
 * Optionales Feld `model` jedes KI-Requests: muss in der Allowlist stehen.
 * Fehlt es, gilt das Standardmodell des Servers.
 */
export function parseModel(body: unknown, allowed: readonly string[], fallback: string): string {
  const model = (body as { model?: unknown } | null)?.model
  if (model === undefined || model === null) return fallback
  if (typeof model !== 'string' || !allowed.includes(model)) {
    throw new ValidationError(`"model" muss einer von ${allowed.join(', ')} sein.`)
  }
  return model
}

export const PAGE_FORMATS = ['A4', 'A5', 'A3', 'Letter', 'Legal'] as const
export type PageFormat = (typeof PAGE_FORMATS)[number]
export const ORIENTATIONS = ['portrait', 'landscape'] as const
export type Orientation = (typeof ORIENTATIONS)[number]

export interface GenerateRequest {
  prompt: string
  format: PageFormat
  orientation: Orientation
  language: RewriteLanguage
}

export const MAX_GENERATE_PROMPT = 4_000

/** Neues Dokument erzeugen: Beschreibung, Seitenformat, Ausrichtung, Sprache. */
export function parseGenerateRequest(body: unknown): GenerateRequest {
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError(
      'Erwartet: { "prompt": "…", "format": "A4", "orientation": "portrait", "language": "de" }',
    )
  }
  const { prompt, format, orientation, language } = body as Record<string, unknown>
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new ValidationError('Bitte beschreiben, was das Dokument enthalten soll.')
  }
  if (prompt.length > MAX_GENERATE_PROMPT) {
    throw new ValidationError(`Beschreibung zu lang (max. ${MAX_GENERATE_PROMPT} Zeichen).`, 413)
  }
  if (!PAGE_FORMATS.includes(format as PageFormat)) {
    throw new ValidationError(`"format" muss einer von ${PAGE_FORMATS.join(', ')} sein.`)
  }
  if (!ORIENTATIONS.includes(orientation as Orientation)) {
    throw new ValidationError(`"orientation" muss einer von ${ORIENTATIONS.join(', ')} sein.`)
  }
  const lang = language ?? 'de'
  if (!REWRITE_LANGUAGES.includes(lang as RewriteLanguage)) {
    throw new ValidationError(`"language" muss einer von ${REWRITE_LANGUAGES.join(', ')} sein.`)
  }
  return {
    prompt: prompt.trim(),
    format: format as PageFormat,
    orientation: orientation as Orientation,
    language: lang as RewriteLanguage,
  }
}
