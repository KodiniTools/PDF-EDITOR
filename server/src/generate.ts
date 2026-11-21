/**
 * Neues Dokument mit KI: Claude liefert strukturierte Inhaltsblöcke, der Browser
 * setzt sie mit pdf-lib im gewählten Seitenformat (kein Layout durch die KI).
 */
import {
  baseParams,
  callClaude,
  parseJson,
  SuggestError,
  type CallOptions,
  type StreamFn,
  type StreamParams,
} from './claude.ts'
import type { GenerateRequest, PageFormat, RewriteLanguage } from './validate.ts'

export const BLOCK_TYPES = [
  'heading',
  'paragraph',
  'bullets',
  'numbered',
  'table',
  'field',
  'divider',
  'spacer',
  'pagebreak',
] as const
export type BlockType = (typeof BLOCK_TYPES)[number]

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullets' | 'numbered'; items: string[] }
  | { type: 'table'; rows: string[][]; header: boolean }
  | { type: 'field'; text: string }
  | { type: 'divider' | 'spacer' | 'pagebreak' }

export interface GeneratedDocument {
  title: string
  blocks: Block[]
}

export const LIMITS = {
  blocks: 400,
  text: 6_000,
  items: 100,
  rows: 200,
  cols: 8,
  cell: 600,
  title: 200,
} as const

const LANGUAGE_NAMES: Record<RewriteLanguage, string> = {
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

const FORMAT_NAMES: Record<PageFormat, string> = {
  A4: 'DIN A4',
  A5: 'DIN A5',
  A3: 'DIN A3',
  Letter: 'US Letter',
  Legal: 'US Legal',
}

export const GENERATE_SYSTEM_PROMPT = `Du entwirfst den Inhalt eines neuen PDF-Dokuments nach der Beschreibung des Nutzers.
Du lieferst nur Inhaltsblöcke; Schrift, Ränder und Umbrüche setzt das Programm.

Blocktypen:
- heading: Überschrift, "level" 1 (Titel), 2 (Abschnitt) oder 3 (Unterabschnitt), Text in "text".
- paragraph: Fließtext in "text". Absätze nicht mit Zeilenumbrüchen formatieren.
- bullets / numbered: Aufzählung, Einträge in "items" (ohne eigene Aufzählungszeichen oder Nummern).
- table: Tabelle in "rows" (Liste von Zeilen, jede Zeile Liste von Zellen, alle Zeilen gleich viele Spalten, höchstens ${LIMITS.cols} Spalten); "header": true, wenn die erste Zeile Spaltenüberschriften enthält. Leere Zellen als "".
- field: Ausfüllfeld mit Beschriftung in "text" (z. B. "Name", "Datum, Unterschrift"); das Programm zeichnet daneben eine Linie zum Ausfüllen.
- divider: horizontale Trennlinie. spacer: etwas Abstand. pagebreak: neue Seite.

Regeln:
- Schreibe den Inhalt in der angegebenen Sprache.
- Soll das Dokument leer bzw. eine Vorlage sein, nutze Felder, leere Tabellenzellen und Platzhalter wie "[Name]" statt erfundener Angaben.
- Erfinde keine echten Personen, Adressen, Kontonummern oder Rechtsauskünfte; nutze erkennbare Platzhalter.
- Passe die Menge an das Seitenformat an (Querformat: breitere Tabellen möglich; A5: knapper).
- Verwende nur lateinische Schrift (auch č, ć, đ, š, ž usw.); Bosnisch und Kroatisch immer in lateinischer Schrift, nie kyrillisch. Keine Emojis, keine Markdown-Syntax.
- "title" ist der Dateiname-taugliche Titel des Dokuments (kurz, ohne Dateiendung).`

const BLOCK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['type'],
  properties: {
    type: { type: 'string', enum: [...BLOCK_TYPES] },
    level: { type: 'integer' },
    text: { type: 'string' },
    items: { type: 'array', items: { type: 'string' } },
    rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
    header: { type: 'boolean' },
  },
} as const

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'blocks'],
  properties: {
    title: { type: 'string' },
    blocks: { type: 'array', items: BLOCK_SCHEMA },
  },
} as const

export function buildGenerateParams(
  req: GenerateRequest,
  opts: Omit<CallOptions, 'signal'>,
): StreamParams {
  const orientation = req.orientation === 'landscape' ? 'Querformat' : 'Hochformat'
  return {
    ...baseParams(opts, 32_000),
    output_config: {
      effort: opts.effort,
      format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
    },
    system: GENERATE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Seitenformat: ${FORMAT_NAMES[req.format]}, ${orientation}\nSprache: ${LANGUAGE_NAMES[req.language]}\n\n<beschreibung>\n${req.prompt}\n</beschreibung>`,
      },
    ],
  }
}

function str(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  return v.replace(/\r\n?/g, '\n').trim().slice(0, max)
}

/** Prüft und begrenzt die KI-Antwort; ungültige Blöcke werden verworfen. */
export function sanitizeDocument(raw: unknown): GeneratedDocument {
  const obj = (raw ?? {}) as { title?: unknown; blocks?: unknown }
  if (!Array.isArray(obj.blocks)) {
    throw new SuggestError('Die Antwort von Claude war nicht lesbar.', 502)
  }
  const blocks: Block[] = []
  for (const b of obj.blocks.slice(0, LIMITS.blocks)) {
    const r = (b ?? {}) as Record<string, unknown>
    switch (r.type) {
      case 'heading': {
        const text = str(r.text, LIMITS.text).replace(/\s*\n\s*/g, ' ')
        const level = r.level === 1 || r.level === 3 ? r.level : 2
        if (text) blocks.push({ type: 'heading', level, text })
        break
      }
      case 'paragraph':
      case 'field': {
        const text = str(r.text, LIMITS.text)
        if (text) blocks.push({ type: r.type, text })
        break
      }
      case 'bullets':
      case 'numbered': {
        const items = (Array.isArray(r.items) ? r.items : [])
          .slice(0, LIMITS.items)
          .map((i) => str(i, LIMITS.text))
          .filter(Boolean)
        if (items.length > 0) blocks.push({ type: r.type, items })
        break
      }
      case 'table': {
        const rows = (Array.isArray(r.rows) ? r.rows : [])
          .slice(0, LIMITS.rows)
          .filter((row): row is unknown[] => Array.isArray(row) && row.length > 0)
          .map((row) => row.slice(0, LIMITS.cols).map((c) => str(c, LIMITS.cell)))
        const cols = Math.max(0, ...rows.map((row) => row.length))
        if (cols === 0) break
        // Alle Zeilen auf gleiche Spaltenzahl bringen.
        const even = rows.map((row) => [...row, ...Array<string>(cols - row.length).fill('')])
        blocks.push({ type: 'table', rows: even, header: r.header === true })
        break
      }
      case 'divider':
      case 'spacer':
      case 'pagebreak':
        blocks.push({ type: r.type })
        break
      default:
        break
    }
  }
  if (blocks.length === 0) throw new SuggestError('Claude hat keinen Inhalt geliefert.', 502)
  const title = str(obj.title, LIMITS.title).replace(/\s+/g, ' ') || 'Neues Dokument'
  return { title, blocks }
}

export async function generateDocument(
  stream: StreamFn,
  req: GenerateRequest,
  opts: CallOptions,
): Promise<GeneratedDocument> {
  const text = await callClaude(
    stream,
    buildGenerateParams(req, opts),
    opts.signal,
    'Bitte ein kürzeres Dokument beschreiben.',
  )
  return sanitizeDocument(parseJson(text))
}
