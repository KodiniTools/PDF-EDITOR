// @vitest-environment node
import * as mupdf from 'mupdf'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import { fillFormFields } from '@/private/forms/fill'
import { pdfRectToDisplay } from '@/private/forms/geometry'
import { displayToPdf } from '@/lib/geometry'

/** Formular wie nach dem Export des Editors: Seiten kopiert, ohne AcroForm. */
async function exportedForm(): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  const p = d.addPage([600, 800])
  const form = d.getForm()
  form.createTextField('person.name').addToPage(p, { x: 100, y: 700, width: 200, height: 20 })
  form.createCheckBox('agree').addToPage(p, { x: 100, y: 650, width: 15, height: 15 })
  const dd = form.createDropdown('land')
  dd.addOptions(['Deutschland', 'Österreich'])
  dd.addToPage(p, { x: 100, y: 600, width: 150, height: 20 })
  const r = form.createRadioGroup('anrede')
  r.addOptionToPage('Herr', p, { x: 100, y: 550, width: 15, height: 15 })
  r.addOptionToPage('Frau', p, { x: 150, y: 550, width: 15, height: 15 })
  form.createTextField('leer').addToPage(p, { x: 100, y: 500, width: 200, height: 20 })
  const out = await PDFDocument.create()
  const [copy] = await out.copyPages(await PDFDocument.load(await d.save()), [0])
  out.addPage(copy!)
  return out.save()
}

describe('fillFormFields', () => {
  it('füllt Text, Auswahl, Checkbox und Radio aus und bettet alle Felder ein', async () => {
    const values = new Map<string, string | boolean>([
      ['person.name', 'Max Mustermann'],
      ['land', 'Österreich'],
      ['agree', true],
      ['anrede', 'Frau'],
      ['unbekannt', 'x'],
    ])
    const { bytes, filled } = await fillFormFields(await exportedForm(), [values])
    expect(filled).toBe(5) // Text, Auswahl, Checkbox, beide Radio-Widgets

    const doc = new mupdf.PDFDocument(bytes)
    const page = doc.loadPage(0)
    expect(page.getWidgets()).toHaveLength(0) // eingebettet
    const text = page.toStructuredText('preserve-whitespace').asText()
    expect(text).toContain('Max Mustermann')
    expect(text).toContain('Österreich')
    // Checkbox/Radio: Häkchen bzw. Punkt als Vektorgrafik → dunkle Pixel an der Stelle
    const pix = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceGray, false)
    const w = pix.getWidth()
    const px = pix.getPixels()
    const darkness = (x0: number, y0: number, size: number) => {
      let dark = 0
      for (let y = y0; y < y0 + size; y++)
        for (let x = x0; x < x0 + size; x++) if ((px[y * w + x] ?? 255) < 128) dark++
      return dark
    }
    // PDF y 650–665 → oben 135–150; 550–565 → 235–250
    expect(darkness(103, 138, 9)).toBeGreaterThan(5) // Checkbox an
    expect(darkness(153, 238, 9)).toBeGreaterThan(5) // „Frau“ an
    expect(darkness(103, 238, 9)).toBeLessThan(5) // „Herr“ aus
    doc.destroy()
  })

  it('lässt Seiten ohne Werte inhaltlich unverändert', async () => {
    const { bytes, filled } = await fillFormFields(await exportedForm(), [])
    expect(filled).toBe(0)
    const doc = new mupdf.PDFDocument(bytes)
    expect(doc.countPages()).toBe(1)
    doc.destroy()
  })
})

describe('pdfRectToDisplay', () => {
  it.each([0, 90, 180, 270] as const)('kehrt displayToPdf um (%i°)', (rot) => {
    const box = { x: 50, y: 100, width: 500, height: 600 }
    const r = pdfRectToDisplay([100, 200, 300, 260], box, rot)
    const a = displayToPdf({ x: r.x, y: r.y }, box, rot)
    const b = displayToPdf({ x: r.x + r.width, y: r.y + r.height }, box, rot)
    expect(
      [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)].map((n) =>
        Math.round(n),
      ),
    ).toEqual([100, 200, 300, 260])
  })
})
