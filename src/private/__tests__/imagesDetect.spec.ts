// @vitest-environment node
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'

import { detectImageRegions, findEmbeddedImages, fitInto, padRect } from '@/private/images/detect'
import type { PageRef } from '@/types/pdf'

// 1×1-PNG (rot)
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
)

async function pdfWithImage(rotate = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([600, 800])
  const img = await doc.embedPng(PNG)
  // PDF-Koordinaten: unten links. Bild 100×50 bei x=50, oben bei y=100 (von oben).
  page.drawImage(img, { x: 50, y: 800 - 100 - 50, width: 100, height: 50 })
  if (rotate) page.setRotation({ type: 'degrees', angle: rotate } as never)
  return doc.save()
}

function ref(baseRotation: 0 | 90 = 0, rotation: 0 | 90 = 0): PageRef {
  return {
    id: 'p',
    sourceId: 's',
    sourceIndex: 0,
    box: { x: 0, y: 0, width: 600, height: 800 },
    baseRotation,
    rotation,
    annotations: [],
  }
}

describe('findEmbeddedImages (MuPDF)', () => {
  it('liefert das Bild im angezeigten Seitenraum', async () => {
    const found = await findEmbeddedImages(await pdfWithImage(), ref(), { width: 600, height: 800 })
    expect(found).toHaveLength(1)
    const r = found[0]!.rect
    expect([r.x, r.y, r.width, r.height].map(Math.round)).toEqual([50, 100, 100, 50])
    expect(found[0]).toMatchObject({ kind: 'embedded', label: '1 × 1 px', fullPage: false })
  })

  it('berücksichtigt eine im Editor gedrehte Seite (90° im Uhrzeigersinn)', async () => {
    const found = await findEmbeddedImages(await pdfWithImage(), ref(0, 90), {
      width: 800,
      height: 600,
    })
    const r = found[0]!.rect
    // Nach 90°: x' = H - (y + h) = 800 - 150 = 650, y' = x = 50, Breite/Höhe vertauscht.
    expect([r.x, r.y, r.width, r.height].map(Math.round)).toEqual([650, 50, 50, 100])
  })

  it('erkennt ganzseitige Bilder (Scan)', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 800])
    page.drawImage(await doc.embedPng(PNG), { x: 0, y: 0, width: 600, height: 800 })
    const found = await findEmbeddedImages(await doc.save(), ref(), { width: 600, height: 800 })
    expect(found[0]?.fullPage).toBe(true)
  })
})

describe('detectImageRegions / Hilfen', () => {
  it('rechnet Bildpixel in Seitenkoordinaten um und verwirft Ungültiges', async () => {
    const fetchFn = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            regions: [
              { kind: 'logo', label: 'Logo', box: [100, 200, 300, 400] },
              { kind: 'embedded', label: '', box: [0, 0, 10, 10] },
              { kind: 'photo', box: [1, 2] },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    )
    const out = await detectImageRegions(
      { image: 'x', mediaType: 'image/jpeg', width: 1000, height: 2000 },
      { width: 500, height: 1000 },
      new AbortController().signal,
      fetchFn,
    )
    expect(out).toEqual([
      {
        kind: 'logo',
        label: 'Logo',
        rect: { x: 50, y: 100, width: 100, height: 100 },
        fullPage: false,
      },
      {
        kind: 'other',
        label: 'Bildbereich',
        rect: { x: 0, y: 0, width: 5, height: 5 },
        fullPage: false,
      },
    ])
    expect(String(fetchFn.mock.calls[0]?.[0])).toMatch(/api\/detect-images$/)
  })

  it('padRect bleibt auf der Seite, fitInto zentriert seitenverhältnistreu', () => {
    expect(padRect({ x: 1, y: 1, width: 10, height: 10 }, 3, { width: 12, height: 100 })).toEqual({
      x: 0,
      y: 0,
      width: 12,
      height: 14,
    })
    expect(fitInto({ width: 200, height: 100 }, { x: 0, y: 0, width: 100, height: 100 })).toEqual({
      x: 0,
      y: 25,
      width: 100,
      height: 50,
    })
  })
})
