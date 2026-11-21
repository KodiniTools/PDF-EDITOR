import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TextLine } from '@/lib/textLines'
import { nearbyLabel } from '@/private/forms/labels'
import { useFormStore } from '@/private/stores/forms'
import type { RawFormField } from '@/services/pdfRenderer'
import { useDocumentStore } from '@/stores/document'

const { suggestApi } = vi.hoisted(() => ({
  suggestApi: vi.fn<typeof import('@/private/forms/api').requestFormSuggestions>(),
}))

function line(text: string, x: number, top: number, width: number): TextLine {
  return {
    key: text,
    text,
    x,
    top,
    width,
    height: 10,
    baseline: top + 8,
    fontSize: 10,
    font: 'sans',
    segments: [],
  }
}

function raw(extra: Partial<RawFormField>): RawFormField {
  return {
    name: 'x',
    type: 'text',
    rect: [100, 690, 300, 710],
    alternativeText: '',
    value: '',
    options: [],
    onValue: '',
    multiline: false,
    maxLength: 0,
    readOnly: false,
    ...extra,
  }
}

vi.mock('@/services/pdfRenderer', () => ({
  openDocument: async () => [],
  closeDocument: async () => undefined,
  renderPage: async () => undefined,
  getTextLines: async () => [
    {
      ...line('Herr Frau', 120, 187, 80),
      segments: [
        { start: 0, end: 4, x: 120, width: 25 },
        { start: 5, end: 9, x: 170, width: 25 },
      ],
    },
    line('Name, Vorname:', 10, 92, 80),
    line('Bitte in Druckschrift', 10, 20, 100),
  ],
  getFormFields: async (_s: string, index: number): Promise<RawFormField[]> =>
    index === 0
      ? [
          raw({ name: 'person.name', alternativeText: 'Name' }),
          raw({
            name: 'ok',
            type: 'checkbox',
            rect: [100, 650, 115, 665],
            value: 'Off',
            onValue: 'Yes',
          }),
          raw({
            name: 'anrede',
            type: 'radio',
            rect: [100, 600, 115, 615],
            onValue: '0',
            value: 'Off',
          }),
          raw({
            name: 'anrede',
            type: 'radio',
            rect: [150, 600, 165, 615],
            onValue: '1',
            value: 'Off',
          }),
          raw({
            name: 'land',
            type: 'combo',
            options: ['DE', 'AT'],
            value: 'DE',
            rect: [100, 550, 200, 570],
          }),
          raw({ name: 'liste', type: 'listbox' }),
          raw({ name: 'amt', readOnly: true }),
        ]
      : [],
}))
vi.mock('@/private/forms/api', () => ({ requestFormSuggestions: suggestApi }))

function setup() {
  const doc = useDocumentStore()
  for (const [id, sourceIndex] of [
    ['p1', 0],
    ['p2', 1],
  ] as const) {
    doc.pages.push({
      id,
      sourceId: 's',
      sourceIndex,
      box: { x: 0, y: 0, width: 600, height: 800 },
      baseRotation: 0,
      rotation: 0,
      annotations: [],
    })
  }
  return { doc, forms: useFormStore() }
}

describe('nearbyLabel', () => {
  it('nimmt Text links daneben, sonst darüber', () => {
    const rect = { x: 100, y: 90, width: 200, height: 20 }
    expect(nearbyLabel(rect, [line('Name:', 10, 95, 60), line('Kopf', 100, 70, 50)])).toBe('Name:')
    expect(nearbyLabel(rect, [line('Kopf', 100, 75, 50)])).toBe('Kopf')
    expect(nearbyLabel(rect, [line('weit weg', 100, 10, 50)])).toBe('')
    // Zeile reicht über das Feld hinaus: nur der Teil links davon
    const merged = {
      ...line('Anrede: Herr Frau', 10, 95, 300),
      segments: [
        { start: 0, end: 7, x: 10, width: 50 },
        { start: 8, end: 12, x: 120, width: 25 },
        { start: 13, end: 17, x: 170, width: 25 },
      ],
    }
    expect(nearbyLabel(rect, [merged])).toBe('Anrede:')
  })
})

describe('useFormStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    suggestApi.mockReset()
    try {
      localStorage.clear()
    } catch {
      // ignorieren
    }
  })

  it('erkennt unterstützte Felder mit Beschriftung und fasst Radio-Gruppen zusammen', async () => {
    const { forms } = setup()
    await forms.detect()
    expect(forms.fields.map((f) => [f.name, f.kind])).toEqual([
      ['person.name', 'text'],
      ['ok', 'checkbox'],
      ['anrede', 'radio'],
      ['land', 'choice'],
    ])
    const name = forms.fields[0]!
    expect(name.label).toBe('Name')
    expect(name.context).toBe('Name, Vorname:')
    expect(forms.fields[2]!.options).toEqual(['0', '1'])
    expect(forms.fields[2]!.optionLabels).toEqual({ '0': 'Herr', '1': 'Frau' })
    expect(forms.fields[2]!.widgets.get('p1')).toHaveLength(2)
    expect(forms.fields[1]!.original).toBe(false)
    expect(forms.fields[3]!.original).toBe('DE')
    expect(forms.unsupported).toBe(2)
  })

  it('merkt nur geänderte Werte und liefert sie je Seite für den Export', async () => {
    const { doc, forms } = setup()
    await forms.detect()
    const [name, ok, anrede, land] = forms.fields
    forms.setValue(name!, 'Max')
    forms.setValue(ok!, true)
    forms.setValue(anrede!, '1')
    forms.setValue(land!, 'DE') // = Original → keine Änderung
    expect(forms.changedCount).toBe(3)
    const out = forms.valuesForExport(doc.pages)
    expect([...out[0]!]).toEqual([
      ['person.name', 'Max'],
      ['ok', true],
      ['anrede', '1'],
    ])
    expect(out[1]!.size).toBe(0)
    forms.resetValues()
    expect(forms.valuesForExport(doc.pages)).toEqual([])
  })

  it('holt Vorschläge mit Feldbeschreibung und Formulartext und übernimmt sie', async () => {
    const { forms } = setup()
    await forms.detect()
    expect(forms.storeProfile('Max Mustermann, verheiratet')).toBe(true)
    suggestApi.mockResolvedValue([
      { id: 'f1', value: 'Mustermann, Max', reason: 'Stammdaten' },
      { id: 'f2', value: 'true', reason: '' },
      { id: 'f3', value: 'Frau', reason: '' },
      { id: 'f4', value: 'DE', reason: 'unverändert' },
      { id: 'f99', value: 'x', reason: '' },
    ])
    await forms.suggest()
    const [input] = suggestApi.mock.calls[0]!
    expect(input.profile).toBe('Max Mustermann, verheiratet')
    expect(input.fields[0]).toEqual({
      id: 'f1',
      type: 'text',
      label: 'Name',
      context: 'Name, Vorname:',
      page: 1,
    })
    expect(input.fields[2]).toMatchObject({ type: 'radio', options: ['Herr', 'Frau'] })
    expect(input.pages).toEqual([
      { page: 1, lines: ['Herr Frau', 'Name, Vorname:', 'Bitte in Druckschrift'] },
    ])
    expect(forms.suggestionCount).toBe(3) // „DE“ entspricht schon dem Wert
    forms.applyAllSuggestions()
    expect(forms.valueOf(forms.fields[0]!)).toBe('Mustermann, Max')
    expect(forms.valueOf(forms.fields[1]!)).toBe(true)
    expect(forms.valueOf(forms.fields[2]!)).toBe('1') // Beschriftung → Exportwert
    expect(forms.suggestionCount).toBe(0)
  })

  it('meldet Backend-Fehler und leert alles beim Schließen', async () => {
    const { doc, forms } = setup()
    await forms.detect()
    forms.storeProfile('x')
    const { SuggestApiError } = await import('@/private/suggestions/api')
    suggestApi.mockRejectedValue(new SuggestApiError('Die KI ist gerade ausgelastet.', 429))
    await forms.suggest()
    expect(forms.error).toMatch(/ausgelastet/)
    expect(forms.busy).toBe(false)
    forms.setValue(forms.fields[0]!, 'A')
    doc.pages.splice(0)
    await new Promise((r) => setTimeout(r, 0))
    expect(forms.fields).toHaveLength(0)
    expect(forms.changedCount).toBe(0)
  })
})
