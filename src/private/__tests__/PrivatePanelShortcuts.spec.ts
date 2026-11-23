import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import PrivatePanel from '@/private/components/PrivatePanel.vue'
import { useDocumentStore } from '@/stores/document'

enableAutoUnmount(afterEach)

vi.mock('@/services/pdfRenderer', () => ({
  openDocument: async () => [],
  closeDocument: async () => undefined,
  renderPage: async () => undefined,
  getTextLines: async () => [],
}))

const clicks = vi.hoisted(() => ({ list: [] as string[] }))

// Echte Panels ziehen pdf.js nach (DOMMatrix fehlt in jsdom); ersetzt durch panelStub.
vi.mock('@/private/components/RedactionPanel.vue', () => ({ default: { render: () => null } }))
vi.mock('@/private/components/AskPanel.vue', () => ({ default: { render: () => null } }))
vi.mock('@/private/components/FormPanel.vue', () => ({ default: { render: () => null } }))
vi.mock('@/private/components/ImagePanel.vue', () => ({ default: { render: () => null } }))
vi.mock('@/private/components/TextPanel.vue', () => ({ default: { render: () => null } }))

/** Ersatz für einen Reiter: Buttons mit data-shortcut wie in den echten Panels. */
function panelStub(name: string) {
  return defineComponent({
    setup: () => () =>
      h('div', [
        ...(['primary', 'secondary', 'apply'] as const).map((kind) =>
          h('button', {
            type: 'button',
            'data-shortcut': kind,
            onClick: () => clicks.list.push(`${name}:${kind}`),
          }),
        ),
        h('textarea'),
      ]),
  })
}

function mountPanel() {
  clicks.list = []
  return mount(PrivatePanel, {
    attachTo: document.body,
    global: {
      stubs: {
        RedactionPanel: panelStub('redact'),
        AskPanel: panelStub('ask'),
        FormPanel: panelStub('form'),
        ImagePanel: panelStub('images'),
        TextPanel: panelStub('text'),
      },
    },
  })
}

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = window) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(e)
  return e
}

describe('PrivatePanel – Tastenkürzel', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('öffnet den Reiter „Text“, sobald ein eingefügter Text ausgewählt wird', async () => {
    const w = mountPanel()
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
    const selected = (id: string) =>
      w.get(`[data-testid="private-tab-${id}"]`).attributes('aria-selected')

    // Eine Markierung auszuwählen wechselt den Reiter nicht.
    store.selectedAnnotationId = store.addAnnotation('p1', {
      kind: 'highlight',
      x: 1,
      y: 1,
      width: 10,
      height: 10,
      color: '#ffff00',
    })
    await flushPromises()
    expect(selected('redact')).toBe('true')

    store.selectedAnnotationId = store.addAnnotation('p1', {
      kind: 'text',
      text: 'Hallo',
      fontSize: 14,
      color: '#000000',
      x: 10,
      y: 10,
    })
    await flushPromises()
    expect(selected('text')).toBe('true')

    // Der Nutzer kann danach frei wechseln; derselbe Text holt den Reiter nicht zurück.
    press('1')
    await flushPromises()
    expect(selected('redact')).toBe('true')
  })
  it('wechselt Reiter mit 1–5 und löst die Aktionen des sichtbaren Reiters aus', async () => {
    const w = mountPanel()
    press('3')
    await flushPromises()
    expect(w.get('[data-testid="private-tab-form"]').attributes('aria-selected')).toBe('true')

    expect(press('Enter', { ctrlKey: true }).defaultPrevented).toBe(true)
    press('Enter', { ctrlKey: true, shiftKey: true })
    press('Enter', { ctrlKey: true, altKey: true })
    expect(clicks.list).toEqual(['form:primary', 'form:secondary', 'form:apply'])
  })

  it('springt mit 5 in das Textfeld des Reiters „Text“', async () => {
    const w = mountPanel()
    press('5')
    await flushPromises()
    expect(w.get('[data-testid="private-tab-text"]').attributes('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(w.get('#private-panel-text textarea').element)
  })

  it('springt mit 2 in das Fragefeld', async () => {
    const w = mountPanel()
    press('2')
    await flushPromises()
    expect(document.activeElement).toBe(w.get('#private-panel-ask textarea').element)
  })

  it('ignoriert Zifferntasten beim Tippen und Strg+Enter aus fremden Textfeldern', async () => {
    const w = mountPanel()
    const outside = document.createElement('textarea')
    document.body.appendChild(outside)
    press('4', {}, outside)
    press('Enter', { ctrlKey: true }, outside)
    await flushPromises()
    expect(w.get('[data-testid="private-tab-redact"]').attributes('aria-selected')).toBe('true')
    expect(clicks.list).toEqual([])
    outside.remove()
  })

  it('wirkt nicht bei offenem Dialog', () => {
    mountPanel()
    const modal = document.createElement('div')
    modal.setAttribute('aria-modal', 'true')
    document.body.appendChild(modal)
    press('Enter', { ctrlKey: true })
    expect(clicks.list).toEqual([])
    modal.remove()
  })
})
