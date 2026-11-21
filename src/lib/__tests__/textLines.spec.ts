import { describe, expect, it } from 'vitest'

import {
  buildTextLines,
  multiply,
  toFontFamily,
  type Matrix,
  type RawTextItem,
} from '@/lib/textLines'

// Viewport-Transform von pdf.js (Skalierung 1) für eine 600×800-Seite.
const VT0: Matrix = [1, 0, 0, -1, 0, 800] // ungedreht
const VT90: Matrix = [0, 1, 1, 0, 0, 0] // 90° im Uhrzeigersinn

function item(str: string, x: number, y: number, size: number, width: number): RawTextItem {
  return { str, transform: [size, 0, 0, size, x, y], width, ascent: 0.75, descent: -0.25 }
}

describe('multiply', () => {
  it('Identität ändert nichts', () => {
    const m: Matrix = [2, 0, 0, 3, 10, 20]
    expect(multiply([1, 0, 0, 1, 0, 0], m)).toEqual(m)
  })
})

describe('buildTextLines', () => {
  it('rechnet in den angezeigten Raum um (Ursprung oben links)', () => {
    const [line] = buildTextLines([item('Hallo', 50, 700, 12, 30)], VT0)
    expect(line).toMatchObject({ text: 'Hallo', x: 50, baseline: 100, fontSize: 12, width: 30 })
    expect(line!.top).toBeCloseTo(100 - 9)
    expect(line!.height).toBeCloseTo(12)
  })

  it('fasst Elemente auf derselben Grundlinie zusammen und ergänzt Leerzeichen', () => {
    const lines = buildTextLines(
      [
        item('Hallo', 50, 700, 12, 30),
        item('Welt', 84, 700, 12, 25),
        item('Zweite', 50, 680, 12, 40),
      ],
      VT0,
    )
    expect(lines.map((l) => l.text)).toEqual(['Hallo Welt', 'Zweite'])
    expect(lines[0]!.width).toBe(59)
  })

  it('trennt weit entfernte Spalten', () => {
    const lines = buildTextLines(
      [item('Links', 50, 700, 12, 30), item('Rechts', 400, 700, 12, 30)],
      VT0,
    )
    expect(lines).toHaveLength(2)
  })

  it('überspringt leere Elemente und Text, der in der Ansicht nicht waagrecht ist', () => {
    const vertical: RawTextItem = { str: 'Hoch', transform: [0, 12, -12, 0, 100, 100], width: 30 }
    const lines = buildTextLines([item('  ', 10, 10, 12, 5), vertical], VT0)
    expect(lines).toEqual([])
  })

  it('erkennt Text auf gedrehter Seite nicht als waagrecht', () => {
    expect(buildTextLines([item('Hallo', 50, 700, 12, 30)], VT90)).toEqual([])
  })

  it('erzeugt drehungsunabhängige Schlüssel', () => {
    const [line] = buildTextLines([item('A', 50.04, 700, 12, 8)], VT0)
    expect(line!.key).toBe('500:7000')
  })
})

describe('toFontFamily', () => {
  it.each([
    ['serif', 'serif'],
    ['sans-serif', 'sans'],
    ['monospace', 'mono'],
    ['Times-Roman', 'serif'],
    [undefined, 'sans'],
  ] as const)('%s → %s', (input, expected) => {
    expect(toFontFamily(input)).toBe(expected)
  })
})

describe('buildTextLines – Segmente', () => {
  it('ordnet jedem Textelement seinen Zeichenbereich zu (Leerzeichen dazwischen ausgenommen)', () => {
    const [line] = buildTextLines(
      [item('Hallo', 50, 700, 12, 30), item('Welt', 84, 700, 12, 25)],
      VT0,
    )
    expect(line!.text).toBe('Hallo Welt')
    expect(line!.segments).toEqual([
      { start: 0, end: 5, x: 50, width: 30 },
      { start: 6, end: 10, x: 84, width: 25 },
    ])
  })

  it('verschiebt Segmente beim Trimmen führender Leerzeichen', () => {
    const [line] = buildTextLines([item('  Text ', 50, 700, 12, 40)], VT0)
    expect(line!.text).toBe('Text')
    // Volle Zeichenzahl des Elements bleibt erhalten (7 Zeichen auf 40 pt).
    expect(line!.segments).toEqual([{ start: -2, end: 5, x: 50, width: 40 }])
  })
})
