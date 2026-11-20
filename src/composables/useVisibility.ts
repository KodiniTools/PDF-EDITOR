import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * Wird `true`, sobald das Element (annähernd) sichtbar ist, und bleibt dann `true`.
 * Ohne IntersectionObserver (z. B. jsdom) sofort `true`.
 */
export function useVisibleOnce(
  target: Ref<HTMLElement | null>,
  rootMargin = '200px',
): Ref<boolean> {
  const visible = ref(false)
  let observer: IntersectionObserver | null = null

  onMounted(() => {
    if (typeof IntersectionObserver === 'undefined' || !target.value) {
      visible.value = true
      return
    }
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          visible.value = true
          observer?.disconnect()
          observer = null
        }
      },
      { rootMargin },
    )
    observer.observe(target.value)
  })

  onBeforeUnmount(() => observer?.disconnect())
  return visible
}
