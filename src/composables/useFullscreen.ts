import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/** Safari kennt bis Version 16.3 nur die Varianten mit Präfix. */
interface FullscreenDocument extends Document {
  webkitFullscreenEnabled?: boolean
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}
interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void
}

const EVENTS = ['fullscreenchange', 'webkitfullscreenchange'] as const

/**
 * Vollbildmodus des Browsers für ein Element (hier: der ganze Editor).
 * `supported` ist falsch, wo der Browser kein Element-Vollbild anbietet (z. B. iPhone).
 */
export function useFullscreen(target: Ref<HTMLElement | null>) {
  const doc = document as FullscreenDocument
  const supported = ref(doc.fullscreenEnabled === true || doc.webkitFullscreenEnabled === true)
  const active = ref(false)

  function current(): Element | null {
    return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null
  }

  function sync(): void {
    active.value = target.value !== null && current() === target.value
  }

  async function toggle(): Promise<void> {
    const el = target.value as FullscreenElement | null
    if (!supported.value || !el) return
    try {
      if (current()) {
        await (doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.())
      } else {
        await (el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.())
      }
    } catch (err) {
      // Vom Browser abgelehnt (z. B. durch eine Richtlinie): Der Editor bleibt normal nutzbar.
      console.warn('[pdf-editor] Vollbild', err)
    } finally {
      sync()
    }
  }

  onMounted(() => {
    for (const name of EVENTS) document.addEventListener(name, sync)
    sync()
  })
  onBeforeUnmount(() => {
    for (const name of EVENTS) document.removeEventListener(name, sync)
  })

  return { supported, active, toggle }
}
