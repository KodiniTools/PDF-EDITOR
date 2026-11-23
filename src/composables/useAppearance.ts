import { onBeforeUnmount, onMounted, ref } from 'vue'

type Appearance = 'light' | 'dark' | 'system'

function storedAppearance(): Appearance {
  try {
    const value = localStorage.getItem('theme')
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

export function useAppearance() {
  const appearance = ref<Appearance>(storedAppearance())
  let systemTheme: MediaQueryList | undefined
  let observer: MutationObserver | undefined

  function applyAppearance() {
    const theme =
      appearance.value === 'system' ? (systemTheme?.matches ? 'light' : 'dark') : appearance.value
    document.documentElement.dataset.theme = theme
  }

  function syncFromNavigation() {
    try {
      const value = localStorage.getItem('theme')
      if (value === 'light' || value === 'dark') appearance.value = value
    } catch {
      // Die Auswahl im Editor bleibt auch ohne Zugriff auf den Speicher nutzbar.
    }
  }

  function setAppearance(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value
    if (value !== 'light' && value !== 'dark' && value !== 'system') return
    appearance.value = value
    try {
      if (value === 'system') localStorage.removeItem('theme')
      else localStorage.setItem('theme', value)
    } catch {
      // Die Auswahl gilt in diesem Fall für die aktuelle Seite.
    }
    applyAppearance()
  }

  onMounted(() => {
    systemTheme =
      typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : undefined
    systemTheme?.addEventListener('change', applyAppearance)
    observer = new MutationObserver(syncFromNavigation)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    applyAppearance()
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    systemTheme?.removeEventListener('change', applyAppearance)
  })

  return { appearance, setAppearance }
}
