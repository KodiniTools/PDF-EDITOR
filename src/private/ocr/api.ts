/** Texterkennung gescannter Seiten über das private Backend (POST <base>api/ocr). */
import { postJson, SuggestApiError } from '../suggestions/api'

export interface OcrLine {
  text: string
  /** [x0, y0, x1, y1] in Bildpixeln, Ursprung oben links. */
  box: [number, number, number, number]
}

export interface OcrImage {
  /** Base64 ohne data:-Präfix. */
  image: string
  mediaType: 'image/jpeg' | 'image/png'
  width: number
  height: number
}

export async function requestOcr(
  input: OcrImage,
  signal: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<OcrLine[]> {
  const body = await postJson('ocr', input, signal, fetchFn)
  const list = (body as { lines?: unknown } | null)?.lines
  if (!Array.isArray(list)) throw new SuggestApiError('Unerwartete Antwort vom Server.', 502)
  return list.flatMap((l: unknown) => {
    const { text, box } = (l ?? {}) as { text?: unknown; box?: unknown }
    if (typeof text !== 'string' || !text.trim() || !Array.isArray(box) || box.length !== 4) {
      return []
    }
    if (!box.every((n) => typeof n === 'number' && Number.isFinite(n))) return []
    return [{ text, box: box as OcrLine['box'] }]
  })
}
