import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PageEditor from '@/components/PageEditor.vue'
import { useDocumentStore } from '@/stores/document'

vi.mock('@/services/pdfRenderer', () => ({
  openDocument: async () => [],
  closeDocument: async () => undefined,
  renderPage: async () => undefined,
  getTextLines: async () => [],
}))

function setup() {
  const store = useDocumentStore()
  store.pages.push({
    id: 'p1',
    sourceId: 's',
    sourceIndex: 0,
    box: { x: 0, y: 0, width: 600, height: 800 },
    baseRotation: 0,
    rotation: 0,
    annotations: [],
  })
  store.selectedPageId = 'p1'
  const wrapper = mount(PageEditor, { props: { page: store.pages[0]! }, attachTo: document.body })
  return { store, wrapper }
}

describe('PageEditor', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('legt mit dem Text-Werkzeug eine Annotation an und verwirft sie leer', async () => {
    const { store, wrapper } = setup()
    store.setTool('text')
    const overlay = wrapper.get('[data-testid="overlay"]')

    await overlay.trigger('pointerdown', { button: 0, clientX: 10, clientY: 10 })
    await flushPromises()
    expect(store.pages[0]!.annotations).toHaveLength(1)
    expect(wrapper.find('textarea').exists()).toBe(true)

    // Klick an anderer Stelle: leere Annotation wird entfernt, neue entsteht.
    await overlay.trigger('pointerdown', { button: 0, clientX: 50, clientY: 50 })
    await flushPromises()
    expect(store.pages[0]!.annotations).toHaveLength(1)

    await wrapper.get('textarea').setValue('Hallo')
    expect(store.pages[0]!.annotations[0]).toMatchObject({ kind: 'text', text: 'Hallo' })
    wrapper.unmount()
  })

  it('behält ein neues, leeres Textfeld beim Klick auf die Schriftauswahl', async () => {
    const { store, wrapper } = setup()
    // Stellvertreter für die Format-Bedienelemente der Werkzeugleiste.
    const controls = document.createElement('label')
    controls.setAttribute('data-text-style-controls', '')
    const fontSelect = document.createElement('select')
    controls.append(fontSelect)
    const elsewhere = document.createElement('button')
    document.body.append(controls, elsewhere)

    store.setTool('text')
    await wrapper
      .get('[data-testid="overlay"]')
      .trigger('pointerdown', { button: 0, clientX: 10, clientY: 10 })
    await flushPromises()
    const id = store.pages[0]!.annotations[0]!.id

    // Fokus wechselt in die Schriftauswahl: Annotation und Textfeld bleiben.
    await wrapper.get('textarea').trigger('blur', { relatedTarget: fontSelect })
    expect(store.pages[0]!.annotations).toHaveLength(1)
    expect(wrapper.find('textarea').exists()).toBe(true)

    // Die Schrift lässt sich ändern, solange das Feld noch leer ist.
    store.updateAnnotation('p1', id, { font: 'serif' })
    expect(store.pages[0]!.annotations[0]).toMatchObject({ kind: 'text', font: 'serif' })

    // Zurück ins Textfeld: Bearbeitung läuft weiter.
    fontSelect.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: wrapper.get('textarea').element }),
    )
    await flushPromises()
    expect(wrapper.find('textarea').exists()).toBe(true)

    // Fokus verlässt die Bedienelemente woandershin: leeres Feld wird wie bisher verworfen.
    fontSelect.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: elsewhere }),
    )
    await flushPromises()
    expect(store.pages[0]!.annotations).toHaveLength(0)

    controls.remove()
    elsewhere.remove()
    wrapper.unmount()
  })

  it('verwirft ein leeres Textfeld weiterhin, wenn der Fokus woandershin wechselt', async () => {
    const { store, wrapper } = setup()
    store.setTool('text')
    await wrapper
      .get('[data-testid="overlay"]')
      .trigger('pointerdown', { button: 0, clientX: 10, clientY: 10 })
    await flushPromises()
    await wrapper.get('textarea').trigger('blur')
    expect(store.pages[0]!.annotations).toHaveLength(0)
    wrapper.unmount()
  })

  it('bricht zu lange Zeilen beim Tippen fest um und behält die Umbrüche nach dem Bearbeiten', async () => {
    const { store, wrapper } = setup()
    store.setTool('text')
    await wrapper
      .get('[data-testid="overlay"]')
      .trigger('pointerdown', { button: 0, clientX: 10, clientY: 10 })
    await flushPromises()

    const long = Array.from({ length: 40 }, (_, i) => `Wort${i}`).join(' ')
    await wrapper.get('textarea').setValue(long)
    const typed = store.pages[0]!.annotations[0]
    if (typed?.kind !== 'text') throw new Error('Textannotation fehlt')
    const lines = typed.text.split('\n')
    expect(lines.length).toBeGreaterThan(1)
    // Nur Leerzeichen wurden zu Umbrüchen: der Inhalt bleibt gleich.
    expect(typed.text.replace(/\n/g, ' ')).toBe(long)
    // Schätzbreite ohne Canvas: 0,55 × Schriftgröße je Zeichen; Seite ist 600 pt breit.
    for (const line of lines) expect(line.length * typed.fontSize * 0.55).toBeLessThanOrEqual(600)
    // Das Textfeld zeigt denselben Text (kein weicher Umbruch).
    expect(wrapper.get('textarea').element.value).toBe(typed.text)
    expect(wrapper.get('textarea').attributes('wrap')).toBe('off')

    await wrapper.get('textarea').trigger('blur')
    const after = store.pages[0]!.annotations[0]
    expect(after).toMatchObject({ kind: 'text', text: typed.text })
    expect(wrapper.find('span.whitespace-pre').text()).toContain('Wort39')
    wrapper.unmount()
  })

  it('bricht einen vorhandenen, zu langen Text beim Beenden der Bearbeitung um', async () => {
    const { store, wrapper } = setup()
    const long = Array.from({ length: 40 }, (_, i) => `Wort${i}`).join(' ')
    const id = store.addAnnotation('p1', {
      kind: 'text',
      text: long,
      fontSize: 14,
      color: '#000000',
      x: 10,
      y: 10,
    })
    await flushPromises()
    await wrapper.get('span.whitespace-pre').trigger('dblclick')
    await flushPromises()
    await wrapper.get('textarea').trigger('blur')
    const a = store.pages[0]!.annotations.find((x) => x.id === id)
    if (a?.kind !== 'text') throw new Error('Textannotation fehlt')
    expect(a.text.split('\n').length).toBeGreaterThan(1)
    expect(a.text.replace(/\n/g, ' ')).toBe(long)
    wrapper.unmount()
  })

  it('öffnet im Text-Werkzeug einen eingefügten Text per Klick, im Verschieben-Werkzeug nicht', async () => {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>
    proto.setPointerCapture ??= () => undefined
    proto.releasePointerCapture ??= () => undefined
    proto.hasPointerCapture ??= () => false
    const { store, wrapper } = setup()
    store.addAnnotation('p1', {
      kind: 'text',
      text: 'Zeile 1\nZeile 2',
      fontSize: 14,
      color: '#000000',
      x: 100,
      y: 100,
    })
    await flushPromises()
    const overlay = wrapper.get('[data-testid="overlay"]')
    const click = async () => {
      await wrapper
        .get('span.whitespace-pre')
        .trigger('pointerdown', { button: 0, pointerId: 1, clientX: 105, clientY: 105 })
      await overlay.trigger('pointerup', { pointerId: 1, clientX: 105, clientY: 105 })
      await flushPromises()
    }

    // Verschieben: Klick wählt nur aus.
    await click()
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(store.selectedAnnotation).toMatchObject({ kind: 'text' })

    // Text-Werkzeug: Klick öffnet die Bearbeitung, Umbrüche bleiben erhalten.
    store.setTool('text')
    await click()
    expect(wrapper.get('textarea').element.value).toBe('Zeile 1\nZeile 2')
    expect(store.pages[0]!.annotations).toHaveLength(1)
    expect(store.canUndo).toBe(true)

    await wrapper.get('textarea').trigger('blur')
    expect(store.pages[0]!.annotations[0]).toMatchObject({ text: 'Zeile 1\nZeile 2', x: 100 })
    wrapper.unmount()
  })

  it('öffnet die Bearbeitung nicht, wenn der Text im Text-Werkzeug gezogen wird', async () => {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>
    proto.setPointerCapture ??= () => undefined
    proto.releasePointerCapture ??= () => undefined
    proto.hasPointerCapture ??= () => false
    const { store, wrapper } = setup()
    store.addAnnotation('p1', {
      kind: 'text',
      text: 'Ziehen',
      fontSize: 14,
      color: '#000000',
      x: 100,
      y: 100,
    })
    store.setTool('text')
    await flushPromises()
    const overlay = wrapper.get('[data-testid="overlay"]')
    await wrapper
      .get('span.whitespace-pre')
      .trigger('pointerdown', { button: 0, pointerId: 1, clientX: 105, clientY: 105 })
    await overlay.trigger('pointermove', { pointerId: 1, clientX: 145, clientY: 125 })
    await overlay.trigger('pointerup', { pointerId: 1, clientX: 145, clientY: 125 })
    await flushPromises()
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(store.pages[0]!.annotations[0]).toMatchObject({ x: 140, y: 120 })
    wrapper.unmount()
  })

  it('lässt langen Text frei verschieben und bricht ihn dabei neu um', async () => {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>
    proto.setPointerCapture ??= () => undefined
    proto.releasePointerCapture ??= () => undefined
    proto.hasPointerCapture ??= () => false
    const { store, wrapper } = setup()
    store.setTool('text')
    const overlay = wrapper.get('[data-testid="overlay"]')
    await overlay.trigger('pointerdown', { button: 0, clientX: 0, clientY: 20 })
    await flushPromises()
    const long = Array.from({ length: 60 }, (_, i) => `Wort${i}`).join(' ')
    await wrapper.get('textarea').setValue(`${long}\nZweiter Absatz`)
    await wrapper.get('textarea').trigger('blur')
    store.setTool('select')
    await flushPromises()

    const current = () => {
      const a = store.pages[0]!.annotations[0]
      if (a?.kind !== 'text') throw new Error('Textannotation fehlt')
      return a
    }
    const fits = () => {
      const a = current()
      for (const line of a.text.split('\n')) {
        expect(a.x + line.length * a.fontSize * 0.55).toBeLessThanOrEqual(600)
      }
    }
    const linesAtLeft = current().text.split('\n').length
    expect(current().x).toBe(0)
    fits()

    // Nach rechts ziehen: früher blockiert, jetzt schmaler umbrochen.
    await wrapper
      .get('span.whitespace-pre')
      .trigger('pointerdown', { button: 0, pointerId: 1, clientX: 5, clientY: 25 })
    await overlay.trigger('pointermove', { pointerId: 1, clientX: 305, clientY: 125 })
    expect(current().x).toBe(300)
    expect(current().text.split('\n').length).toBeGreaterThan(linesAtLeft)
    fits()
    // Der Inhalt bleibt gleich, der von Hand gesetzte Umbruch auch.
    expect(current().text.endsWith('\nZweiter Absatz')).toBe(true)
    expect(current().text.replace(/\n/g, ' ')).toBe(`${long} Zweiter Absatz`)

    // Zurück nach links: wieder die ursprünglichen Zeilen.
    await overlay.trigger('pointermove', { pointerId: 1, clientX: 5, clientY: 125 })
    await overlay.trigger('pointerup', { pointerId: 1, clientX: 5, clientY: 125 })
    expect(current().x).toBe(0)
    expect(current().y).toBeGreaterThan(100)
    expect(current().text.split('\n').length).toBe(linesAtLeft)

    // Verschieben ist ein Undo-Schritt.
    store.undo()
    expect(current().y).toBeLessThan(30)
    wrapper.unmount()
  })

  it('bricht umbrochenen Text neu um, wenn die Schrift größer wird', async () => {
    const { store, wrapper } = setup()
    store.setTool('text')
    await wrapper
      .get('[data-testid="overlay"]')
      .trigger('pointerdown', { button: 0, clientX: 10, clientY: 10 })
    await flushPromises()
    const long = Array.from({ length: 40 }, (_, i) => `Wort${i}`).join(' ')
    await wrapper.get('textarea').setValue(long)
    await wrapper.get('textarea').trigger('blur')
    const a = store.pages[0]!.annotations[0]!
    if (a.kind !== 'text') throw new Error('Textannotation fehlt')
    const original = a.text
    const before = original.split('\n').length

    store.updateAnnotation('p1', a.id, { fontSize: 28 }, `style:${a.id}`)
    await flushPromises()
    const after = store.pages[0]!.annotations[0]!
    if (after.kind !== 'text') throw new Error('Textannotation fehlt')
    expect(after.text.split('\n').length).toBeGreaterThan(before)
    for (const line of after.text.split('\n')) {
      expect(after.x + line.length * 28 * 0.55).toBeLessThanOrEqual(600)
    }
    // Größe und neuer Umbruch sind zusammen ein Undo-Schritt.
    store.undo()
    expect(store.pages[0]!.annotations[0]).toMatchObject({ fontSize: 14, text: original })
    wrapper.unmount()
  })

  it('zeigt Fett, Kursiv und Ausrichtung an und bricht fetten Text neu um', async () => {
    const { store, wrapper } = setup()
    store.setTool('text')
    await wrapper
      .get('[data-testid="overlay"]')
      .trigger('pointerdown', { button: 0, clientX: 10, clientY: 10 })
    await flushPromises()
    const long = Array.from({ length: 40 }, (_, i) => `Wort${i}`).join(' ')
    await wrapper.get('textarea').setValue(long)
    await wrapper.get('textarea').trigger('blur')
    const a = store.pages[0]!.annotations[0]!
    if (a.kind !== 'text') throw new Error('Textannotation fehlt')
    const before = a.text

    store.updateAnnotation(
      'p1',
      a.id,
      { bold: true, italic: true, align: 'right' },
      `style:${a.id}`,
    )
    await flushPromises()
    const style = (wrapper.get('span.whitespace-pre').element.parentElement as HTMLElement).style
    expect(style.fontWeight).toBe('bold')
    expect(style.fontStyle).toBe('italic')
    expect(style.textAlign).toBe('right')

    // Fett läuft breiter: der Text wird neu umbrochen und passt weiter auf die Seite.
    const after = store.pages[0]!.annotations[0]!
    if (after.kind !== 'text') throw new Error('Textannotation fehlt')
    expect(after.text).not.toBe(before)
    expect(after.text.replace(/\n/g, ' ')).toBe(long)
    for (const line of after.text.split('\n')) {
      expect(after.x + line.length * 14 * 0.6).toBeLessThanOrEqual(600)
    }
    wrapper.unmount()
  })

  it('bricht den Text neu um, wenn die X-Position von außen geändert wird', async () => {
    const { store, wrapper } = setup()
    store.setTool('text')
    await wrapper
      .get('[data-testid="overlay"]')
      .trigger('pointerdown', { button: 0, clientX: 0, clientY: 10 })
    await flushPromises()
    const long = Array.from({ length: 40 }, (_, i) => `Wort${i}`).join(' ')
    await wrapper.get('textarea').setValue(long)
    await wrapper.get('textarea').trigger('blur')
    const a = store.pages[0]!.annotations[0]!
    if (a.kind !== 'text') throw new Error('Textannotation fehlt')
    const before = a.text.split('\n').length

    // So setzt die Werkzeugleiste die Position (Feld X).
    store.updateAnnotation('p1', a.id, { x: 300 }, `style:${a.id}`)
    await flushPromises()
    const after = store.pages[0]!.annotations[0]!
    if (after.kind !== 'text') throw new Error('Textannotation fehlt')
    expect(after.text.split('\n').length).toBeGreaterThan(before)
    for (const line of after.text.split('\n')) {
      expect(300 + line.length * 14 * 0.55).toBeLessThanOrEqual(600)
    }
    store.undo()
    expect(store.pages[0]!.annotations[0]).toMatchObject({ x: 0 })
    wrapper.unmount()
  })

  it('ignoriert Klicks im Auswahl-Werkzeug', async () => {
    const { store, wrapper } = setup()
    await wrapper.get('[data-testid="overlay"]').trigger('pointerdown', { button: 0 })
    expect(store.pages[0]!.annotations).toHaveLength(0)
    wrapper.unmount()
  })

  it('legt mit dem Schwärzen-Werkzeug eine echte Schwärzung an', async () => {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>
    proto.setPointerCapture ??= () => undefined
    proto.releasePointerCapture ??= () => undefined
    proto.hasPointerCapture ??= () => false
    const { store, wrapper } = setup()
    store.setTool('redact')
    const overlay = wrapper.get('[data-testid="overlay"]')

    await overlay.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 20 })
    await overlay.trigger('pointermove', { pointerId: 1, clientX: 110, clientY: 40 })
    await overlay.trigger('pointerup', { pointerId: 1, clientX: 110, clientY: 40 })

    expect(store.pages[0]!.annotations).toHaveLength(1)
    expect(store.pages[0]!.annotations[0]).toMatchObject({
      kind: 'cover',
      redact: true,
      color: '#000000',
      x: 10,
      y: 20,
      width: 100,
      height: 20,
    })
    expect(wrapper.find('[data-testid="redaction"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
