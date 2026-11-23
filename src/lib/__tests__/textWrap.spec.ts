import { describe, expect, it } from 'vitest'

import { caretAfterWrap, wrapTextToWidth } from '@/lib/textWrap'

/** Jedes Zeichen ist eine Einheit breit. */
const measure = (s: string) => s.length

describe('wrapTextToWidth', () => {
  it('lässt passende Zeilen unverändert', () => {
    expect(wrapTextToWidth('kurz\nauch kurz', 10, measure)).toEqual({
      text: 'kurz\nauch kurz',
      inserted: [],
    })
  })

  it('bricht an Leerzeichen um, ohne die Länge zu ändern', () => {
    const source = 'eins zwei drei vier fünf'
    const r = wrapTextToWidth(source, 10, measure)
    expect(r.text).toBe('eins zwei\ndrei vier\nfünf')
    expect(r.text).toHaveLength(source.length)
    expect(r.inserted).toEqual([])
    for (const line of r.text.split('\n')) expect(line.length).toBeLessThanOrEqual(10)
  })

  it('behält vorhandene Umbrüche und leere Zeilen', () => {
    expect(wrapTextToWidth('a b c d\n\nx', 3, measure).text).toBe('a b\nc d\n\nx')
  })

  it('teilt Wörter ohne Leerzeichen und meldet die eingefügten Stellen', () => {
    const r = wrapTextToWidth('abcdefghij', 4, measure)
    expect(r.text).toBe('abcd\nefgh\nij')
    expect(r.inserted).toEqual([4, 8])
    expect(caretAfterWrap(10, r)).toBe(12)
    expect(caretAfterWrap(3, r)).toBe(3)
  })

  it('ist stabil: erneutes Umbrechen ändert nichts', () => {
    const once = wrapTextToWidth(
      'Die genauen Befehle stehen im PR. Prüf bitte auch /a/b/c.json',
      12,
      measure,
    )
    expect(wrapTextToWidth(once.text, 12, measure).text).toBe(once.text)
  })

  it('endet auch bei zu kleiner oder ungültiger Breite', () => {
    expect(wrapTextToWidth('abc', 0.5, measure).text).toBe('a\nb\nc')
    expect(wrapTextToWidth('abc', 0, measure).text).toBe('abc')
    expect(wrapTextToWidth('abc', Number.NaN, measure).text).toBe('abc')
  })
})
