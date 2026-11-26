import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import PageThumbnail from '@/components/PageThumbnail.vue'
import { HIGHLIGHT_OPACITY } from '@/services/pdfExport'
import type { Annotation, PageRef } from '@/types/pdf'

vi.mock('@/services/pdfRenderer', () => ({
  renderPage: async () => undefined,
}))

function page(annotations: Annotation[], rotation: PageRef['rotation'] = 0): PageRef {
  return {
    id: 'p1',
    sourceId: 's',
    sourceIndex: 0,
    box: { x: 0, y: 0, width: 600, height: 800 },
    baseRotation: 0,
    rotation,
    annotations,
  }
}

/** Montiert die Miniatur und wartet, bis sie (ohne IntersectionObserver sofort) sichtbar ist. */
async function mountThumb(p: PageRef) {
  const wrapper = mount(PageThumbnail, {
    props: { page: p, index: 0, total: 1, selected: false, marked: false },
  })
  await flushPromises()
  return wrapper
}

const IMG = 'data:image/png;base64,iVBORw0KGgo='

describe('PageThumbnail', () => {
  it('zeigt ohne Annotationen nur die Seite', async () => {
    const wrapper = await mountThumb(page([]))
    expect(wrapper.find('canvas').exists()).toBe(true)
    expect(wrapper.find('[data-testid="annotation-preview"]').exists()).toBe(false)
  })

  it('zeigt hinzugefügten Text, Bild, Markierung und Abdeckung in der Miniatur', async () => {
    const wrapper = await mountThumb(
      page([
        { id: 't', kind: 'text', x: 200, y: 100, text: 'avocado', fontSize: 24, color: '#112233' },
        { id: 'i', kind: 'image', x: 150, y: 200, width: 200, height: 130, dataUrl: IMG },
        { id: 'h', kind: 'highlight', x: 10, y: 20, width: 30, height: 40, color: '#ffff00' },
        {
          id: 'c',
          kind: 'cover',
          x: 50,
          y: 60,
          width: 70,
          height: 80,
          color: '#000000',
          redact: true,
        },
      ]),
    )
    const layer = wrapper.get('[data-testid="annotation-preview"]')
    expect(layer.attributes('viewBox')).toBe('0 0 600 800')

    const text = layer.get('[data-kind="text"]')
    expect(text.text()).toBe('avocado')
    expect(text.attributes('style')).toContain('left: 200px')
    expect(text.attributes('style')).toContain('font-size: 24px')

    const img = layer.get('img[data-kind="image"]')
    expect(img.attributes('src')).toBe(IMG)
    expect(img.attributes('style')).toContain('width: 200px')

    const highlight = layer.get('[data-kind="highlight"]')
    expect(highlight.attributes('style')).toContain(`opacity: ${HIGHLIGHT_OPACITY}`)

    // Schwärzungen sind im Export deckend, nicht halbtransparent wie im Editor.
    const cover = layer.get('[data-kind="cover"]')
    expect(cover.attributes('style')).not.toContain('color-mix')
    expect(cover.attributes('style')).not.toContain('opacity')
  })

  it('nutzt bei gedrehter Seite die angezeigte Seitengröße', async () => {
    const wrapper = await mountThumb(
      page([{ id: 'h', kind: 'highlight', x: 0, y: 0, width: 5, height: 5, color: '#ff0' }], 90),
    )
    expect(wrapper.get('[data-testid="annotation-preview"]').attributes('viewBox')).toBe(
      '0 0 800 600',
    )
  })

  it('aktualisiert die Miniatur, wenn im Editor Elemente hinzukommen', async () => {
    // Wie im Store: dieselbe reaktive Seite wird in-place verändert.
    const p = reactive(page([]))
    const wrapper = await mountThumb(p)
    p.annotations.push({
      id: 't',
      kind: 'text',
      x: 0,
      y: 0,
      text: 'neu',
      fontSize: 12,
      color: '#000',
    })
    await nextTick()
    expect(wrapper.get('[data-kind="text"]').text()).toBe('neu')
  })
})
