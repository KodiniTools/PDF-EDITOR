import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent, h } from 'vue'

import { routes } from '@/router'
import LandingView from '@/views/LandingView.vue'

/** Router mit den echten (öffentlichen) Routen; der Editor wird nicht geladen. */
function makeRouter() {
  const EditorStub = defineComponent({ name: 'EditorStub', render: () => h('div', 'editor') })
  return createRouter({
    history: createMemoryHistory(),
    routes: routes.map((r) =>
      r.name === 'editor' ? { path: r.path, name: r.name, component: EditorStub } : r,
    ),
  })
}

afterEach(() => document.documentElement.classList.remove('pdf-landing-active'))

describe('Routen (öffentlich)', () => {
  it('zeigt unter / die Startseite und unter /app den Editor', async () => {
    const router = makeRouter()
    await router.push('/')
    expect(router.currentRoute.value.name).toBe('landing')
    await router.push('/app')
    expect(router.currentRoute.value.name).toBe('editor')
  })

  it('leitet unbekannte Pfade auf die Startseite', async () => {
    const router = makeRouter()
    await router.push('/gibt-es-nicht')
    expect(router.currentRoute.value.name).toBe('landing')
  })
})

describe('LandingView', () => {
  it('verlinkt Startseite und Editor', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(LandingView, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.get('h1').text()).toBe('PDF-Editor')
    expect(wrapper.get('.landing-title-pdf').text()).toBe('PDF-')
    expect(wrapper.get('.landing-tab[aria-current="page"]').text()).toBe('Startseite')
    expect(wrapper.get('[data-testid="landing-cta"]').attributes('href')).toBe('/app')
    expect(wrapper.get('[data-testid="landing-tab-editor"]').attributes('href')).toBe('/app')
    expect(wrapper.findAll('.landing-card')).toHaveLength(3)
    wrapper.unmount()
  })

  it('lässt die Seite nur solange als Ganzes scrollen, wie sie angezeigt wird', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(LandingView, { global: { plugins: [router] } })
    expect(document.documentElement.classList.contains('pdf-landing-active')).toBe(true)
    wrapper.unmount()
    expect(document.documentElement.classList.contains('pdf-landing-active')).toBe(false)
  })
})
