import { describe, expect, it } from 'vitest'

import { displaySize, displayToPdf, normalizeRotation, rotateAnnotation } from '@/lib/geometry'
import type { HighlightAnnotation, ImageAnnotation, PdfBox, Rotation } from '@/types/pdf'

const A4: PdfBox = { x: 0, y: 0, width: 600, height: 800 }

describe('normalizeRotation', () => {
  it.each([
    [0, 0],
    [90, 90],
    [360, 0],
    [-90, 270],
    [450, 90],
  ])('%i → %i', (input, expected) => {
    expect(normalizeRotation(input)).toBe(expected)
  })

  it('wirft bei ungültigen Werten', () => {
    expect(() => normalizeRotation(45)).toThrow(RangeError)
    expect(() => normalizeRotation(Number.NaN)).toThrow(RangeError)
  })
})

describe('displaySize', () => {
  it('vertauscht Breite/Höhe bei 90/270', () => {
    expect(displaySize(A4, 0)).toEqual({ width: 600, height: 800 })
    expect(displaySize(A4, 90)).toEqual({ width: 800, height: 600 })
    expect(displaySize(A4, 270)).toEqual({ width: 800, height: 600 })
  })
})

describe('displayToPdf', () => {
  // Angezeigte linke obere Ecke → welche PDF-Ecke?
  const cases: [Rotation, { x: number; y: number }][] = [
    [0, { x: 0, y: 800 }], // oben links
    [90, { x: 0, y: 0 }], // unten links (Seite im Uhrzeigersinn gedreht)
    [180, { x: 600, y: 0 }], // unten rechts
    [270, { x: 600, y: 800 }], // oben rechts
  ]
  it.each(cases)('Rotation %i: Ecke oben links', (rotation, expected) => {
    expect(displayToPdf({ x: 0, y: 0 }, A4, rotation)).toEqual(expected)
  })

  it('berücksichtigt CropBox-Versatz', () => {
    const box: PdfBox = { x: 10, y: 20, width: 100, height: 200 }
    expect(displayToPdf({ x: 0, y: 200 }, box, 0)).toEqual({ x: 10, y: 20 })
    expect(displayToPdf({ x: 100, y: 50 }, box, 90)).toEqual({ x: 60, y: 120 }) // Mittelpunkt
    expect(displayToPdf({ x: 50, y: 100 }, box, 90)).toEqual({ x: 110, y: 70 })
  })

  it('bildet den Mittelpunkt bei jeder Drehung auf den Mittelpunkt ab', () => {
    for (const r of [0, 90, 180, 270] as const) {
      const d = displaySize(A4, r)
      expect(displayToPdf({ x: d.width / 2, y: d.height / 2 }, A4, r)).toEqual({ x: 300, y: 400 })
    }
  })
})

describe('rotateAnnotation', () => {
  const size = { width: 600, height: 800 }
  const hl: HighlightAnnotation = {
    id: 'h',
    kind: 'highlight',
    color: '#ff0',
    x: 10,
    y: 20,
    width: 100,
    height: 50,
  }

  it('transponiert Markierungen bei cw', () => {
    // cw: (x,y) → (H − y, x); Rechteck 10..110 × 20..70 → x' = 800−70 = 730, y' = 10
    expect(rotateAnnotation(hl, size, 'cw')).toMatchObject({
      x: 730,
      y: 10,
      width: 50,
      height: 100,
    })
  })

  it('cw gefolgt von ccw ist die Identität', () => {
    const once = rotateAnnotation(hl, size, 'cw')
    const back = rotateAnnotation(once, { width: 800, height: 600 }, 'ccw')
    expect(back).toEqual(hl)
  })

  it('hält Bilder aufrecht und in der Seite', () => {
    const img: ImageAnnotation = {
      id: 'i',
      kind: 'image',
      dataUrl: 'data:image/png;base64,',
      x: 500,
      y: 700,
      width: 100,
      height: 100,
    }
    const r = rotateAnnotation(img, size, 'cw')
    expect(r.width).toBe(100)
    expect(r.height).toBe(100)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.x + r.width).toBeLessThanOrEqual(800)
    expect(r.y + r.height).toBeLessThanOrEqual(600)
  })
})
