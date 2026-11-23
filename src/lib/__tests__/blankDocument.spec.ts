import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import { createBlankPdf, isValidPageCount, MAX_BLANK_PAGES } from '@/lib/blankDocument'
import { pageSize } from '@/lib/pageFormats'

describe('createBlankPdf', () => {
  it('erzeugt leere Seiten im gewählten Format', async () => {
    const bytes = await createBlankPdf({ format: 'A4', orientation: 'portrait', pages: 3 }, 'Test')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(3)
    expect(doc.getTitle()).toBe('Test')
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 2)
    expect(doc.getPage(0).getHeight()).toBeCloseTo(841.89, 2)
  })

  it('tauscht Breite und Höhe im Querformat', async () => {
    const bytes = await createBlankPdf({ format: 'A5', orientation: 'landscape', pages: 1 }, 'Q')
    const page = (await PDFDocument.load(bytes)).getPage(0)
    expect([page.getWidth(), page.getHeight()]).toEqual(pageSize('A5', 'landscape'))
    expect(page.getWidth()).toBeGreaterThan(page.getHeight())
  })

  it('lehnt ungültige Seitenzahlen ab', async () => {
    for (const pages of [0, -1, 1.5, MAX_BLANK_PAGES + 1, Number.NaN]) {
      expect(isValidPageCount(pages)).toBe(false)
      await expect(
        createBlankPdf({ format: 'A4', orientation: 'portrait', pages }, 'x'),
      ).rejects.toThrow(RangeError)
    }
    expect(isValidPageCount('')).toBe(false)
    expect(isValidPageCount(1)).toBe(true)
    expect(isValidPageCount(MAX_BLANK_PAGES)).toBe(true)
  })
})
