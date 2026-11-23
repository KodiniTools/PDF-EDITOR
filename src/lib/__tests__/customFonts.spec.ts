import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  customFont,
  customFonts,
  ensureCustomFont,
  isCustomFont,
  parseFontFiles,
  pickFace,
  setCustomFontsForTest,
} from '@/lib/customFonts'
import { cssFontFamily } from '@/lib/textLayout'

const FILES = {
  '/src/assets/fonts/editor/Open_Sans-Regular.ttf': '/a/os-r.ttf',
  '/src/assets/fonts/editor/Open_Sans-Bold.ttf': '/a/os-b.ttf',
  '/src/assets/fonts/editor/Open_Sans-BoldItalic.ttf': '/a/os-bi.ttf',
  '/src/assets/fonts/editor/Caveat-Regular.otf': '/a/caveat.otf',
}

afterEach(() => setCustomFontsForTest({}))

describe('parseFontFiles', () => {
  it('fasst Schnitte je Familie zusammen und sortiert nach Anzeigename', () => {
    const fonts = parseFontFiles(FILES)
    expect(fonts.map((f) => [f.id, f.label])).toEqual([
      ['custom:Caveat', 'Caveat'],
      ['custom:Open_Sans', 'Open Sans'],
    ])
    expect(fonts[1]?.faces).toEqual({
      regular: '/a/os-r.ttf',
      bold: '/a/os-b.ttf',
      boldItalic: '/a/os-bi.ttf',
    })
  })

  it('überspringt Dateien ohne gültigen Schnitt und Familien ohne Regular', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fonts = parseFontFiles({
      '/fonts/Nur-Bold.ttf': '/a/1.ttf',
      '/fonts/OhneSchnitt.ttf': '/a/2.ttf',
      '/fonts/Seltsam-Light.ttf': '/a/3.ttf',
    })
    expect(fonts).toEqual([])
    expect(warn).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })

  it('ist ohne Dateien leer (Auslieferungszustand)', () => {
    expect(parseFontFiles({})).toEqual([])
  })
})

describe('eigene Schriften', () => {
  it('wählt den nächstliegenden vorhandenen Schnitt', () => {
    setCustomFontsForTest(FILES)
    const openSans = customFont('custom:Open_Sans')!
    expect(pickFace(openSans, {}).key).toBe('regular')
    expect(pickFace(openSans, { bold: true }).key).toBe('bold')
    expect(pickFace(openSans, { bold: true, italic: true }).key).toBe('boldItalic')
    // Kursiv fehlt: normal (der Browser stellt schräg, im PDF steht der normale Schnitt).
    expect(pickFace(openSans, { italic: true }).key).toBe('regular')
    const caveat = customFont('custom:Caveat')!
    expect(pickFace(caveat, { bold: true, italic: true })).toEqual({
      key: 'regular',
      url: '/a/caveat.otf',
    })
  })

  it('liefert CSS-Familien mit Ersatzschrift, auch für unbekannte Schriften', () => {
    setCustomFontsForTest(FILES)
    expect(customFonts()).toHaveLength(2)
    expect(isCustomFont('custom:Caveat')).toBe(true)
    expect(isCustomFont('serif')).toBe(false)
    expect(isCustomFont(undefined)).toBe(false)
    expect(cssFontFamily('custom:Caveat')).toBe('"pdfed-Caveat", Helvetica, Arial, sans-serif')
    expect(cssFontFamily('custom:Gibt_es_nicht')).toBe('Helvetica, Arial, sans-serif')
    expect(cssFontFamily(undefined)).toBe('Helvetica, Arial, sans-serif')
    expect(cssFontFamily('mono')).toContain('Courier')
  })

  it('meldet Standardschriften als bereit und blockiert ohne FontFace-API nicht', () => {
    setCustomFontsForTest(FILES)
    expect(ensureCustomFont('sans')).toBe(true)
    expect(ensureCustomFont(undefined)).toBe(true)
    expect(ensureCustomFont('custom:Gibt_es_nicht')).toBe(true)
    // jsdom kennt FontFace nicht: nicht bereit, aber ohne Fehler.
    expect(ensureCustomFont('custom:Caveat', { bold: true })).toBe(false)
  })
})
