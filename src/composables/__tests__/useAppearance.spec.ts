import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'

import { useAppearance } from '@/composables/useAppearance'

type Api = ReturnType<typeof useAppearance>

function mountHost() {
  let api: Api | undefined
  const Host = defineComponent({
    setup() {
      api = useAppearance()
      return () => h('div')
    },
  })
  const wrapper = mount(Host)
  if (!api) throw new Error('useAppearance wurde nicht initialisiert')
  return { wrapper, api }
}

/** Entspricht dem change-Ereignis der Auswahl „Darstellung“. */
function choose(api: Api, value: string) {
  const select = document.createElement('select')
  select.append(new Option(value, value))
  select.value = value
  select.addEventListener('change', api.setAppearance)
  select.dispatchEvent(new Event('change'))
}

describe('useAppearance', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })
  afterEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('startet ohne gespeicherte Wahl mit „System“ und setzt data-theme', () => {
    const { wrapper, api } = mountHost()
    expect(api.appearance.value).toBe('system')
    expect(['light', 'dark']).toContain(document.documentElement.dataset.theme)
    wrapper.unmount()
  })

  it('übernimmt die gespeicherte Wahl der globalen Navigation', () => {
    localStorage.setItem('theme', 'light')
    const { wrapper, api } = mountHost()
    expect(api.appearance.value).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    wrapper.unmount()
  })

  it('speichert eine feste Wahl und löscht sie bei „System“', () => {
    const { wrapper, api } = mountHost()
    choose(api, 'dark')
    expect(api.appearance.value).toBe('dark')
    expect(localStorage.getItem('theme')).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')

    choose(api, 'system')
    expect(api.appearance.value).toBe('system')
    expect(localStorage.getItem('theme')).toBeNull()
    wrapper.unmount()
  })

  it('ignoriert unbekannte Werte', () => {
    const { wrapper, api } = mountHost()
    choose(api, 'sepia')
    expect(api.appearance.value).toBe('system')
    expect(localStorage.getItem('theme')).toBeNull()
    wrapper.unmount()
  })

  it('folgt dem Theme-Schalter der globalen Navigation', async () => {
    const { wrapper, api } = mountHost()
    // So schaltet nav.html um: erst speichern, dann data-theme setzen.
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'
    localStorage.setItem('theme', next)
    document.documentElement.setAttribute('data-theme', next)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(api.appearance.value).toBe(next)
    wrapper.unmount()
  })
})
