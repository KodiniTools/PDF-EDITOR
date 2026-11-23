import { describe, expect, it } from 'vitest'

import { adjustSoftBreaks, caretAfterWrap, unwrapSoft, wrapTextToWidth } from '@/lib/textWrap'

/** Jedes Zeichen ist eine Einheit breit. */
const measure = (s: string) => s.length

describe('wrapTextToWidth', () => {
  it('lässt passende Zeilen unverändert', () => {
    expect(wrapTextToWidth('kurz\nauch kurz', 10, measure)).toEqual({
      text: 'kurz\nauch kurz',
      inserted: [],
      soft: [],
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

  it('meldet weiche Umbrüche, die sich zurücknehmen und neu setzen lassen', () => {
    const source = 'eins zwei drei vier\nfest fünf sechs sieben'
    const narrow = wrapTextToWidth(source, 10, measure)
    expect(narrow.text).toBe('eins zwei\ndrei vier\nfest fünf\nsechs\nsieben')
    expect(narrow.soft).toEqual([9, 29, 35])
    // Zurücknehmen ergibt den Ausgangstext; der von Hand gesetzte Umbruch bleibt.
    expect(unwrapSoft(narrow.text, narrow.soft)).toBe(source)
    const wide = wrapTextToWidth(unwrapSoft(narrow.text, narrow.soft), 100, measure)
    expect(wide).toEqual({ text: source, inserted: [], soft: [] })
  })

  it('lässt überlange Wörter auf Wunsch ganz und bricht nur an Leerzeichen um', () => {
    const source = 'ab abcdefghij cd ef'
    const r = wrapTextToWidth(source, 4, measure, false)
    expect(r.text).toBe('ab\nabcdefghij\ncd\nef')
    expect(r.inserted).toEqual([])
    expect(unwrapSoft(r.text, r.soft)).toBe(source)
    expect(wrapTextToWidth('abcdefghij', 4, measure, false).text).toBe('abcdefghij')
  })

  it('ignoriert weiche Umbrüche, die nicht mehr auf einen Umbruch zeigen', () => {
    expect(unwrapSoft('ab\ncd', [0, 2, 99])).toBe('ab cd')
  })
})

describe('adjustSoftBreaks', () => {
  const text = 'aaa\nbbb\nccc'

  it('behält Stellen vor der Änderung und verschiebt Stellen dahinter', () => {
    // Einfügen in der mittleren Zeile.
    expect(adjustSoftBreaks(text, 'aaa\nbbXXb\nccc', [3, 7])).toEqual([3, 9])
    // Löschen am Anfang.
    expect(adjustSoftBreaks(text, 'a\nbbb\nccc', [3, 7])).toEqual([1, 5])
    // Anhängen am Ende.
    expect(adjustSoftBreaks(text, `${text}!`, [3, 7])).toEqual([3, 7])
  })

  it('verwirft Stellen im geänderten Bereich', () => {
    // Der erste Umbruch wurde durch ein Leerzeichen ersetzt.
    expect(adjustSoftBreaks(text, 'aaa bbb\nccc', [3, 7])).toEqual([7])
    // Alles ersetzt.
    expect(adjustSoftBreaks(text, 'neu', [3, 7])).toEqual([])
  })
})
