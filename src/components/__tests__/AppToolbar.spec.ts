import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AppToolbar from '@/components/AppToolbar.vue'
import { useDocumentStore } from '@/stores/document'

vi.mock('@/services/pdfRenderer', () => ({
  openDocument: async () => [],
  closeDocument: async () => undefined,
  renderPage: async () => undefined,
  getTextLines: async () => [],
}))

describe('AppToolbar', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('zeigt ohne Dokument nur „PDF öffnen“', () => {
    const wrapper = mount(AppToolbar)
    expect(wrapper.text()).toContain('PDF öffnen')
    expect(wrapper.text()).not.toContain('Exportieren')
  })

  it('gibt ausgewählte Dateien weiter', async () => {
    const wrapper = mount(AppToolbar)
    const input = wrapper.get('[data-testid="file-input"]')
    const file = new File(['%PDF-'], 'a.pdf', { type: 'application/pdf' })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    expect(wrapper.emitted('openFiles')?.[0]).toEqual([[file]])
  })

  it('fordert beim Signatur-Werkzeug ohne Signatur den Dialog an', async () => {
    const store = useDocumentStore()
    store.pages.push({
      id: 'p',
      sourceId: 's',
      sourceIndex: 0,
      box: { x: 0, y: 0, width: 100, height: 100 },
      baseRotation: 0,
      rotation: 0,
      annotations: [],
    })
    const wrapper = mount(AppToolbar)
    const btn = wrapper.findAll('button').find((b) => b.text() === 'Signatur')
    await btn!.trigger('click')
    expect(store.tool).toBe('signature')
    expect(wrapper.emitted('editSignature')).toHaveLength(1)
  })

  it('zeigt im öffentlichen Build kein Schwärzen-Werkzeug', () => {
    const store = useDocumentStore()
    store.pages.push({
      id: 'p',
      sourceId: 's',
      sourceIndex: 0,
      box: { x: 0, y: 0, width: 100, height: 100 },
      baseRotation: 0,
      rotation: 0,
      annotations: [],
    })
    const wrapper = mount(AppToolbar)
    expect(wrapper.text()).toContain('Abdecken')
    expect(wrapper.text()).not.toContain('Schwärzen')
    expect(wrapper.text()).not.toContain('privat')
  })

  it('ändert die Farbe der ausgewählten Markierung sofort', async () => {
    const store = useDocumentStore()
    store.pages.push({
      id: 'p',
      sourceId: 's',
      sourceIndex: 0,
      box: { x: 0, y: 0, width: 100, height: 100 },
      baseRotation: 0,
      rotation: 0,
      annotations: [],
    })
    store.selectedPageId = 'p'
    const id = store.addAnnotation('p', {
      kind: 'highlight',
      color: '#facc15',
      x: 1,
      y: 1,
      width: 10,
      height: 10,
    })
    const wrapper = mount(AppToolbar)
    // Ohne Auswahl und ohne Markier-Werkzeug gibt es keinen Farbwähler.
    store.selectedAnnotationId = null
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="highlight-color"]').exists()).toBe(false)

    store.selectedAnnotationId = id
    await wrapper.vm.$nextTick()
    const input = wrapper.get('[data-testid="highlight-color"]')
    expect((input.element as HTMLInputElement).value).toBe('#facc15')

    // `input` feuert schon während der Auswahl im Farbfenster.
    await input.setValue('#00ff00')
    expect(store.pages[0]!.annotations[0]).toMatchObject({ kind: 'highlight', color: '#00ff00' })
    expect(store.highlightColor).toBe('#00ff00')

    // Mehrere Farbwechsel sind ein einziger Undo-Schritt.
    await input.setValue('#0000ff')
    store.undo()
    expect(store.pages[0]!.annotations[0]).toMatchObject({ color: '#facc15' })
  })

  it('schaltet Fett und Kursiv um und setzt die Ausrichtung des ausgewählten Textes', async () => {
    const store = useDocumentStore()
    store.pages.push({
      id: 'p',
      sourceId: 's',
      sourceIndex: 0,
      box: { x: 0, y: 0, width: 600, height: 800 },
      baseRotation: 0,
      rotation: 0,
      annotations: [],
    })
    store.selectedPageId = 'p'
    const wrapper = mount(AppToolbar)
    // Ohne ausgewählten Text gibt es die Formatleiste nicht.
    expect(wrapper.find('[data-testid="text-format"]').exists()).toBe(false)

    const id = store.addAnnotation('p', {
      kind: 'text',
      text: 'Hallo',
      fontSize: 14,
      color: '#000000',
      x: 10,
      y: 10,
    })
    store.selectedAnnotationId = id
    await wrapper.vm.$nextTick()
    const current = () => store.pages[0]!.annotations[0]!
    const format = wrapper.get('[data-testid="text-format"]')
    // Fokus in dieser Gruppe beendet die Textbearbeitung nicht (siehe PageEditor).
    expect(format.attributes('data-text-style-controls')).toBeDefined()

    const bold = wrapper.get('[data-testid="text-bold"]')
    expect(bold.attributes('aria-pressed')).toBe('false')
    await bold.trigger('click')
    expect(current()).toMatchObject({ bold: true })
    expect(bold.attributes('aria-pressed')).toBe('true')
    await wrapper.get('[data-testid="text-italic"]').trigger('click')
    expect(current()).toMatchObject({ bold: true, italic: true })
    await bold.trigger('click')
    expect(current()).toMatchObject({ bold: false, italic: true })

    expect(wrapper.get('[data-testid="text-align-left"]').attributes('aria-pressed')).toBe('true')
    await wrapper.get('[data-testid="text-align-center"]').trigger('click')
    expect(current()).toMatchObject({ align: 'center' })
    await wrapper.get('[data-testid="text-align-right"]').trigger('click')
    expect(current()).toMatchObject({ align: 'right' })
    expect(wrapper.get('[data-testid="text-align-right"]').attributes('aria-pressed')).toBe('true')

    // Alle Formatänderungen an einem Text sind ein Undo-Schritt.
    store.undo()
    expect(current()).not.toHaveProperty('align')
    expect(current()).not.toHaveProperty('bold')
  })

  it('setzt die Position des ausgewählten Textes über die Felder X und Y (mm)', async () => {
    const store = useDocumentStore()
    store.pages.push({
      id: 'p',
      sourceId: 's',
      sourceIndex: 0,
      box: { x: 0, y: 0, width: 595.28, height: 841.89 },
      baseRotation: 0,
      rotation: 0,
      annotations: [],
    })
    store.selectedPageId = 'p'
    store.selectedAnnotationId = store.addAnnotation('p', {
      kind: 'text',
      text: 'Hallo',
      fontSize: 14,
      color: '#000000',
      x: 72,
      y: 144,
    })
    const wrapper = mount(AppToolbar)
    const current = () => store.pages[0]!.annotations[0]!
    const x = wrapper.get<HTMLInputElement>('[data-testid="selected-text-x"]')
    const y = wrapper.get<HTMLInputElement>('[data-testid="selected-text-y"]')
    // 72 pt = 25,4 mm; 144 pt = 50,8 mm.
    expect(x.element.value).toBe('25.4')
    expect(y.element.value).toBe('50.8')

    await x.setValue('100')
    await y.setValue('20')
    expect(current().x).toBeCloseTo((100 * 72) / 25.4, 3)
    expect(current().y).toBeCloseTo((20 * 72) / 25.4, 3)

    // Außerhalb der Seite: der Text bleibt vollständig auf dem Blatt.
    await x.setValue('500')
    await y.setValue('999')
    expect(current().x).toBeLessThan(595.28)
    expect(current().x).toBeGreaterThan(500)
    expect(current().y).toBeCloseTo(841.89 - 14 * 1.2, 0)
    await x.setValue('-5')
    expect(current().x).toBe(0)

    // Leere oder ungültige Eingabe ändert nichts.
    await x.setValue('')
    expect(current().x).toBe(0)

    // Alle Schritte zusammen sind ein Undo-Schritt.
    store.undo()
    expect(current()).toMatchObject({ x: 72, y: 144 })
  })
})
