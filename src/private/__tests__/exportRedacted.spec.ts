// @vitest-environment node
import * as mupdf from 'mupdf'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import { exportWithRedactions, hasRedactions } from '@/private/redaction/exportRedacted'
import type { PageRef } from '@/types/pdf'

async function source(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const label of ['Seite1', 'Seite2']) {
    const page = doc.addPage([600, 800])
    // angezeigter Raum (ungedreht): Grundlinie y = 800 - 700 = 100
    page.drawText(`GEHEIM ${label}`, { x: 100, y: 700, size: 20, font })
    page.drawText('OFFEN', { x: 100, y: 400, size: 20, font })
  }
  return doc.save()
}

function texts(bytes: Uint8Array): { text: string; rotation: number }[] {
  const doc = new mupdf.PDFDocument(bytes)
  try {
    const out = []
    for (let i = 0; i < doc.countPages(); i++) {
      const page = doc.loadPage(i)
      out.push({
        text: page.toStructuredText('preserve-whitespace').asText(),
        rotation: page.getObject().getInheritable('Rotate').asNumber() || 0,
      })
    }
    return out
  } finally {
    doc.destroy()
  }
}

function page(id: string, sourceIndex: number, extra: Partial<PageRef> = {}): PageRef {
  return {
    id,
    sourceId: 's1',
    sourceIndex,
    box: { x: 0, y: 0, width: 600, height: 800 },
    baseRotation: 0,
    rotation: 0,
    annotations: [],
    ...extra,
  }
}

describe('exportWithRedactions', () => {
  it('exportiert ohne Schwärzungen unverändert über pdf-lib', async () => {
    const pages = [page('a', 0)]
    expect(hasRedactions(pages)).toBe(false)
    const { bytes, report } = await exportWithRedactions(new Map([['s1', await source()]]), pages)
    expect(report).toBeNull()
    expect(texts(bytes)[0]!.text).toContain('GEHEIM')
  })

  it('schwärzt echt, behält Reihenfolge/Drehung und zeichnet Annotationen darüber', async () => {
    const pages: PageRef[] = [
      // Seite 2 zuerst, ohne Schwärzung
      page('b', 1),
      // Seite 1, vom Nutzer um 90° gedreht: angezeigter Raum 800×600.
      // Text „GEHEIM Seite1“ liegt ungedreht bei x 100–260, y 80–105 →
      // nach 90° im Uhrzeigersinn bei x = 800 − y, y = x.
      page('a', 0, {
        rotation: 90,
        annotations: [
          {
            id: 'r',
            kind: 'cover',
            redact: true,
            color: '#000000',
            x: 690,
            y: 95,
            width: 30,
            height: 180,
          },
          {
            id: 't',
            kind: 'text',
            text: 'Hinweis',
            fontSize: 12,
            color: '#ff0000',
            x: 650,
            y: 300,
          },
        ],
      }),
    ]
    const { bytes, report } = await exportWithRedactions(new Map([['s1', await source()]]), pages)

    expect(report?.areas).toBe(1)
    const [first, second] = texts(bytes)
    expect(first!.text).toContain('GEHEIM Seite2')
    expect(second!.rotation).toBe(90)
    expect(second!.text).not.toContain('GEHEIM')
    expect(second!.text).toContain('OFFEN')
    expect(second!.text).toContain('Hinweis')
  })

  it('füllt Formularfelder aus, nachdem Felder in geschwärzten Bereichen entfernt wurden', async () => {
    const d = await PDFDocument.create()
    const p = d.addPage([600, 800])
    const form = d.getForm()
    form.createTextField('name').addToPage(p, { x: 100, y: 700, width: 200, height: 20 })
    form.createTextField('iban').addToPage(p, { x: 100, y: 600, width: 200, height: 20 })
    const src = await d.save()
    const pages = [
      page('a', 0, {
        annotations: [
          // Feld „iban“: PDF y 600–620 → angezeigt 180–200
          {
            id: 'r',
            kind: 'cover',
            redact: true,
            color: '#000000',
            x: 90,
            y: 175,
            width: 230,
            height: 30,
          },
        ],
      }),
    ]
    const formValues = [
      new Map<string, string | boolean>([
        ['name', 'Max Mustermann'],
        ['iban', 'DE89370400440532013000'],
      ]),
    ]
    const { bytes } = await exportWithRedactions(new Map([['s1', src]]), pages, { formValues })
    const text = texts(bytes)[0]!.text
    expect(text).toContain('Max Mustermann')
    expect(text).not.toContain('DE89')
  })

  it('füllt Formulare auch ohne Schwärzungen aus', async () => {
    const d = await PDFDocument.create()
    const p = d.addPage([600, 800])
    d.getForm().createTextField('name').addToPage(p, { x: 100, y: 700, width: 200, height: 20 })
    const { bytes, report } = await exportWithRedactions(
      new Map([['s1', await d.save()]]),
      [page('a', 0)],
      { formValues: [new Map([['name', 'Erika']])] },
    )
    expect(report).toBeNull()
    expect(texts(bytes)[0]!.text).toContain('Erika')
  })
})
