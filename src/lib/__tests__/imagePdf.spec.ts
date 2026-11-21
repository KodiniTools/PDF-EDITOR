import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import { imageToPdf, imageTypeOf, looksLikeImage } from '@/lib/imagePdf'

// 1×1-PNG (weiß)
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'

describe('Scan/Foto als PDF-Seite', () => {
  it('erkennt Bilder an Typ oder Signatur', () => {
    expect(looksLikeImage('image/jpeg', new Uint8Array())).toBe(true)
    expect(looksLikeImage('', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true)
    expect(looksLikeImage('', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(true)
    expect(looksLikeImage('', new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe(true)
    expect(looksLikeImage('', new TextEncoder().encode('hallo welt'))).toBe(false)
    expect(imageTypeOf(new File(['x'], 'Scan.JPG'))).toBe('image/jpeg')
    expect(imageTypeOf(new File(['x'], 'a.txt'))).toBe('')
  })

  it('legt hochformatige Bilder auf A4 hoch, breite auf A4 quer, eingepasst', async () => {
    const portrait = await PDFDocument.load(
      await imageToPdf({ dataUrl: PNG_1PX, width: 2480, height: 3508 }),
    )
    const p = portrait.getPage(0)
    expect([Math.round(p.getWidth()), Math.round(p.getHeight())]).toEqual([595, 842])
    const landscape = await PDFDocument.load(
      await imageToPdf({ dataUrl: PNG_1PX, width: 4000, height: 1000 }),
    )
    const q = landscape.getPage(0)
    expect([Math.round(q.getWidth()), Math.round(q.getHeight())]).toEqual([842, 595])
  })
})
