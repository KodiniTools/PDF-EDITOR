/** Inhalt für ein neues Dokument von Claude anfordern (POST <base>api/generate-document). */
import { postJson, SuggestApiError } from '../suggestions/api'
import type { RewriteLanguage } from '../rewrite/api'
import type { Block, GeneratedDocument, Orientation, PageFormat } from './types'

/** Muss zu MAX_GENERATE_PROMPT in server/src/validate.ts passen. */
export const MAX_PROMPT_LENGTH = 4_000

export interface GenerateInput {
  prompt: string
  format: PageFormat
  orientation: Orientation
  language: RewriteLanguage
}

const isStr = (v: unknown): v is string => typeof v === 'string'

/** Prüft die Antwort; der Server hat bereits bereinigt, hier nur Typsicherheit. */
export function parseDocument(body: unknown): GeneratedDocument {
  const doc = (body as { document?: unknown } | null)?.document as
    { title?: unknown; blocks?: unknown } | undefined
  if (!doc || !Array.isArray(doc.blocks)) {
    throw new SuggestApiError('Unerwartete Antwort vom Server.', 502)
  }
  const blocks = doc.blocks.flatMap((b: unknown): Block[] => {
    const r = (b ?? {}) as Record<string, unknown>
    switch (r.type) {
      case 'heading':
        return isStr(r.text)
          ? [{ type: 'heading', level: r.level === 1 || r.level === 3 ? r.level : 2, text: r.text }]
          : []
      case 'paragraph':
      case 'field':
        return isStr(r.text) ? [{ type: r.type, text: r.text }] : []
      case 'bullets':
      case 'numbered':
        return Array.isArray(r.items) ? [{ type: r.type, items: r.items.filter(isStr) }] : []
      case 'table':
        return Array.isArray(r.rows)
          ? [
              {
                type: 'table',
                rows: r.rows.filter(Array.isArray).map((row: unknown[]) => row.map(String)),
                header: r.header === true,
              },
            ]
          : []
      case 'divider':
      case 'spacer':
      case 'pagebreak':
        return [{ type: r.type }]
      default:
        return []
    }
  })
  if (blocks.length === 0) throw new SuggestApiError('Claude hat keinen Inhalt geliefert.', 502)
  return { title: isStr(doc.title) && doc.title.trim() ? doc.title : 'Neues Dokument', blocks }
}

export async function requestDocument(
  input: GenerateInput,
  signal: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<GeneratedDocument> {
  return parseDocument(await postJson('generate-document', input, signal, fetchFn))
}
