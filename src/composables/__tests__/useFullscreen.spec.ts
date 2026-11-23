import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'

import { useFullscreen } from '../useFullscreen'

function setDoc(props: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(document, key, { configurable: true, writable: true, value })
  }
}

function mountHost() {
  let api!: ReturnType<typeof useFullscreen>
  const Host = defineComponent({
    setup() {
      const el = ref<HTMLElement | null>(null)
      api = useFullscreen(el)
      return () => h('div', { ref: el })
    },
  })
  const wrapper = mount(Host, { attachTo: document.body })
  return { wrapper, api: () => api }
}

afterEach(() => {
  setDoc({ fullscreenEnabled: undefined, fullscreenElement: null, exitFullscreen: undefined })
  document.body.innerHTML = ''
})

describe('useFullscreen', () => {
  it('meldet fehlende Unterstützung und tut dann nichts', async () => {
    setDoc({ fullscreenEnabled: false, fullscreenElement: null })
    const { wrapper, api } = mountHost()
    const request = vi.fn<() => Promise<void>>()
    ;(wrapper.element as HTMLElement).requestFullscreen = request
    expect(api().supported.value).toBe(false)
    await api().toggle()
    expect(request).not.toHaveBeenCalled()
    expect(api().active.value).toBe(false)
  })

  it('schaltet das Vollbild ein und aus und folgt dem Ereignis des Browsers', async () => {
    setDoc({ fullscreenEnabled: true, fullscreenElement: null })
    const { wrapper, api } = mountHost()
    const el = wrapper.element as HTMLElement
    el.requestFullscreen = vi.fn<() => Promise<void>>(() => {
      setDoc({ fullscreenElement: el })
      return Promise.resolve()
    })
    const exit = vi.fn<() => Promise<void>>(() => {
      setDoc({ fullscreenElement: null })
      return Promise.resolve()
    })
    setDoc({ exitFullscreen: exit })

    await api().toggle()
    expect(el.requestFullscreen).toHaveBeenCalledOnce()
    expect(api().active.value).toBe(true)

    await api().toggle()
    expect(exit).toHaveBeenCalledOnce()
    expect(api().active.value).toBe(false)

    // Esc oder F11: der Browser beendet das Vollbild selbst und meldet es per Ereignis.
    setDoc({ fullscreenElement: el })
    document.dispatchEvent(new Event('fullscreenchange'))
    expect(api().active.value).toBe(true)
    setDoc({ fullscreenElement: null })
    document.dispatchEvent(new Event('fullscreenchange'))
    expect(api().active.value).toBe(false)
  })

  it('bleibt nutzbar, wenn der Browser das Vollbild ablehnt', async () => {
    setDoc({ fullscreenEnabled: true, fullscreenElement: null })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { wrapper, api } = mountHost()
    ;(wrapper.element as HTMLElement).requestFullscreen = vi.fn<() => Promise<void>>(() =>
      Promise.reject(new Error('denied')),
    )
    await expect(api().toggle()).resolves.toBeUndefined()
    expect(api().active.value).toBe(false)
    warn.mockRestore()
  })
})
