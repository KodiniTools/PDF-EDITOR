import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { de } from '@/i18n/locales/de'
import { en } from '@/i18n/locales/en'

/** Frisches Modul je Test: Sprache und Listener sind Modulzustand. */
async function load() {
  vi.resetModules()
  return import('@/i18n')
}

function switchInNavigation(locale: string): void {
  // So schaltet nav.html um: erst speichern, dann das Ereignis senden.
  localStorage.setItem('locale', locale)
  window.dispatchEvent(new CustomEvent('locale-changed', { detail: { locale } }))
}

describe('i18n', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('startet ohne gespeicherte Sprache auf Deutsch', async () => {
    const { locale, t } = await load()
    expect(locale.value).toBe('de')
    expect(t('toolbar.open')).toBe('PDF öffnen')
  })

  it('übernimmt die in der Navigation gespeicherte Sprache', async () => {
    localStorage.setItem('locale', 'en')
    const { locale, t, installI18n } = await load()
    installI18n()
    expect(locale.value).toBe('en')
    expect(t('toolbar.open')).toBe('Open PDF')
    expect(document.title).toBe(en['meta.title'])
  })

  it('folgt dem Sprachschalter der Navigation ohne Neuladen', async () => {
    const { locale, t, installI18n } = await load()
    installI18n()
    switchInNavigation('en')
    expect(locale.value).toBe('en')
    expect(t('desk.status', { n: 2, total: 5 })).toBe('Page 2 of 5')

    switchInNavigation('de')
    expect(locale.value).toBe('de')
    expect(t('desk.status', { n: 2, total: 5 })).toBe('Seite 2 von 5')
    expect(document.title).toBe(de['meta.title'])
  })

  it('ignoriert unbekannte Sprachen', async () => {
    const { locale, installI18n } = await load()
    installI18n()
    switchInNavigation('fr')
    expect(locale.value).toBe('de')
  })

  it('übersetzt Tastennamen nur im Englischen', async () => {
    const { keyName, installI18n } = await load()
    installI18n()
    expect(keyName('Strg+Umschalt+Entf')).toBe('Strg+Umschalt+Entf')
    switchInNavigation('en')
    expect(keyName('Strg+Umschalt+Entf')).toBe('Ctrl+Shift+Del')
    expect(keyName('Bild↑')).toBe('PgUp')
  })

  it('hat in beiden Sprachen dieselben Schlüssel und Platzhalter', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort())
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort()
    for (const key of Object.keys(de) as (keyof typeof de)[]) {
      expect(placeholders(en[key])).toEqual(placeholders(de[key]))
      expect(en[key].trim()).not.toBe('')
    }
  })
})
