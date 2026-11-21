import { describe, expect, it } from 'vitest'

import type { TextLine } from '@/lib/textLines'
import { coverage, findRanges, locateText, rangeToRect } from '@/private/suggestions/locate'

function line(
  text: string,
  segments: TextLine['segments'],
  extra: Partial<TextLine> = {},
): TextLine {
  return {
    key: 'k',
    text,
    x: segments[0]?.x ?? 0,
    top: 100,
    width: 100,
    height: 12,
    baseline: 109,
    fontSize: 10,
    font: 'sans',
    segments,
    ...extra,
  }
}

describe('findRanges', () => {
  it('findet alle Vorkommen an Wortgrenzen', () => {
    expect(findRanges('Max Muster, Max', 'Max')).toEqual([
      [0, 3],
      [12, 15],
    ])
  })

  it('ignoriert Treffer mitten im Wort', () => {
    expect(findRanges('Maximum', 'Max')).toEqual([])
  })

  it('fällt auf Groß-/Kleinschreibung-unabhängige Suche zurück', () => {
    expect(findRanges('MAX MUSTER', 'Max Muster')).toEqual([[0, 10]])
  })

  it('erlaubt Treffer mit Satzzeichen am Rand', () => {
    expect(findRanges('Tel.: +49 30 123456.', '+49 30 123456')).toEqual([[6, 19]])
  })

  it('liefert für leere Suche nichts', () => {
    expect(findRanges('abc', '  ')).toEqual([])
  })
})

describe('rangeToRect', () => {
  // „Name: Max Muster“ aus zwei pdf.js-Elementen
  const l = line('Name: Max Muster', [
    { start: 0, end: 5, x: 50, width: 25 },
    { start: 6, end: 16, x: 80, width: 50 },
  ])

  it('interpoliert innerhalb eines Segments', () => {
    const r = rangeToRect(l, 6, 9)! // „Max“ = erste 3 von 10 Zeichen ab x 80
    expect(r.x).toBeCloseTo(80 - 0.6)
    expect(r.width).toBeCloseTo(15 + 1.2)
    expect(r.y).toBeCloseTo(99.5)
    expect(r.height).toBeCloseTo(13)
  })

  it('spannt über mehrere Segmente', () => {
    const r = rangeToRect(l, 0, 16)!
    expect(r.x).toBeCloseTo(50 - 0.6)
    expect(r.x + r.width).toBeCloseTo(130 + 0.6)
  })

  it('berücksichtigt Segmente mit abgeschnittenem Leerraum', () => {
    // Element „  Text “ (7 Zeichen, 70 pt) → Zeile „Text“ mit start -2
    const t = line('Text', [{ start: -2, end: 5, x: 0, width: 70 }])
    const r = rangeToRect(t, 0, 4)!
    expect(r.x + 0.6).toBeCloseTo(20)
    expect(r.width - 1.2).toBeCloseTo(40)
  })

  it('nutzt Zeichenbreiten, wenn ein Maß übergeben wird', () => {
    // „WWii“: W = 3 Einheiten, i = 1 → „ii“ beginnt bei 6/8 der Breite
    const t = line('WWii', [{ start: 0, end: 4, x: 0, width: 80 }])
    const measure = (s: string) => [...s].reduce((n, c) => n + (c === 'W' ? 3 : 1), 0)
    const r = rangeToRect(t, 2, 4, measure)!
    expect(r.x + 0.6).toBeCloseTo(60)
    expect(r.width - 1.2).toBeCloseTo(20)
  })

  it('liefert null für leere Bereiche', () => {
    expect(rangeToRect(l, 3, 3)).toBeNull()
  })
})

describe('locateText', () => {
  it('findet Text in mehreren Zeilen', () => {
    const a = line('Max Muster', [{ start: 0, end: 10, x: 0, width: 50 }])
    const b = line('Gruß, Max Muster', [{ start: 0, end: 16, x: 0, width: 80 }], { top: 200 })
    const rects = locateText([a, b], 'Max Muster')
    expect(rects).toHaveLength(2)
    expect(rects[1]!.y).toBeCloseTo(199.5)
  })
})

describe('coverage', () => {
  it('berechnet den überdeckten Anteil', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 }
    expect(coverage(a, { x: 5, y: 0, width: 10, height: 10 })).toBeCloseTo(0.5)
    expect(coverage(a, { x: 20, y: 0, width: 1, height: 1 })).toBe(0)
  })
})
