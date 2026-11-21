/**
 * Zerlegt eine Antwort in Text und Seitenverweise der Form „(S. 3)“, „(S. 3, 5)“,
 * „(S. 3–5)“ oder „(Seite 2)“, damit die Seiten im Panel anklickbar sind.
 */
export type AnswerPart =
  { kind: 'text'; text: string } | { kind: 'page'; page: number; label: string }

const REF = /\((?:S\.|Seiten?)\s*(\d+(?:\s*(?:,|–|-|und|bis)\s*\d+)*)\)/g

export function splitPageRefs(text: string, pageCount: number): AnswerPart[] {
  const parts: AnswerPart[] = []
  let last = 0
  for (const m of text.matchAll(REF)) {
    const start = m.index
    const numbers = (m[1] ?? '').match(/\d+/g)?.map(Number) ?? []
    if (numbers.length === 0 || numbers.some((n) => n < 1 || n > pageCount)) continue
    if (start > last) parts.push({ kind: 'text', text: text.slice(last, start) })
    parts.push({ kind: 'text', text: '(S. ' })
    // Trennzeichen zwischen den Zahlen aus dem Original übernehmen.
    const inner = m[1] ?? ''
    let pos = 0
    for (const n of inner.matchAll(/\d+/g)) {
      if (n.index > pos) parts.push({ kind: 'text', text: inner.slice(pos, n.index) })
      parts.push({ kind: 'page', page: Number(n[0]), label: n[0] })
      pos = n.index + n[0].length
    }
    parts.push({ kind: 'text', text: ')' })
    last = start + m[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}
