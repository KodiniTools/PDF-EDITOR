/**
 * Sprachumschaltung der öffentlichen Variante, synchron mit der globalen
 * KodiniTools-Navigation (wie bei den anderen Tools):
 * - gewählte Sprache steht in `localStorage.locale` (`de` | `en`, Standard `de`),
 * - die Navigation meldet einen Wechsel über das Fenster-Ereignis `locale-changed`.
 *
 * Die private Variante hat keine Navigation und bleibt deutsch.
 */
import { readonly, ref } from 'vue'

import { de, type MessageKey } from './locales/de'
import { en } from './locales/en'

export type Locale = 'de' | 'en'
export type { MessageKey }

const STORAGE_KEY = 'locale'
const MESSAGES: Record<Locale, Record<MessageKey, string>> = { de, en }

function isLocale(value: unknown): value is Locale {
  return value === 'de' || value === 'en'
}

function storedLocale(): Locale {
  if (__PRIVATE__) return 'de'
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return isLocale(value) ? value : 'de'
  } catch {
    return 'de'
  }
}

const current = ref<Locale>(storedLocale())

/** Aktuelle Sprache (reaktiv, nur lesend). */
export const locale = readonly(current)

/**
 * Übersetzt einen Schlüssel. Liest die reaktive Sprache, Templates und
 * `computed` aktualisieren sich deshalb beim Sprachwechsel von selbst.
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const text = MESSAGES[current.value][key] ?? de[key] ?? key
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

/** Tastennamen der Kürzel-Übersicht und Tooltips, deutsch → englisch. */
const KEY_NAMES_EN: [RegExp, string][] = [
  [/Strg/g, 'Ctrl'],
  [/Umschalt/g, 'Shift'],
  [/Entf/g, 'Del'],
  [/Bild↑/g, 'PgUp'],
  [/Bild↓/g, 'PgDn'],
  [/Pos1/g, 'Home'],
  [/Ende/g, 'End'],
  [/Pfeil/g, 'Arrow'],
]

/** Beschriftung einer Taste in der aktuellen Sprache, z. B. `Strg+O` → `Ctrl+O`. */
export function keyName(key: string): string {
  if (current.value === 'de') return key
  return KEY_NAMES_EN.reduce(
    (name, [pattern, replacement]) => name.replace(pattern, replacement),
    key,
  )
}

/** Seitentitel, Beschreibung und `lang` der App an die Sprache anpassen. */
function applyToDocument(): void {
  if (__PRIVATE__ || typeof document === 'undefined') return
  document.title = t('meta.title')
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'))
  document.getElementById('app')?.setAttribute('lang', current.value)
}

function setLocale(value: unknown): void {
  if (__PRIVATE__ || !isLocale(value) || value === current.value) return
  current.value = value
  applyToDocument()
}

let installed = false

/**
 * Einmal beim Start aufrufen: folgt ab dann dem Sprachschalter der Navigation
 * (`locale-changed`) und Änderungen aus anderen Tabs (`storage`).
 */
export function installI18n(): void {
  if (installed || __PRIVATE__ || typeof window === 'undefined') return
  installed = true
  window.addEventListener('locale-changed', (event) => {
    const detail = (event as CustomEvent<{ locale?: unknown } | null>).detail
    setLocale(detail?.locale ?? storedLocale())
  })
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) setLocale(storedLocale())
  })
  current.value = storedLocale()
  applyToDocument()
}

export function useI18n() {
  return { t, locale, keyName }
}
