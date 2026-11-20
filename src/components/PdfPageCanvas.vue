<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

import { renderPage } from '@/services/pdfRenderer'
import type { Rotation } from '@/types/pdf'

const props = defineProps<{
  sourceId: string
  pageIndex: number
  rotation: Rotation
  scale: number
}>()

const emit = defineEmits<{ error: [message: string] }>()

const canvas = ref<HTMLCanvasElement | null>(null)
let controller: AbortController | null = null
// pdf.js erlaubt pro Canvas nur einen laufenden Render-Vorgang → Aufrufe serialisieren.
let pending: Promise<void> = Promise.resolve()

function scheduleRender(): void {
  controller?.abort()
  const ctrl = new AbortController()
  controller = ctrl
  pending = pending
    .catch(() => undefined)
    .then(async () => {
      const el = canvas.value
      if (!el || ctrl.signal.aborted) return
      try {
        await renderPage(el, {
          sourceId: props.sourceId,
          pageIndex: props.pageIndex,
          rotation: props.rotation,
          scale: props.scale,
          signal: ctrl.signal,
        })
      } catch (err) {
        console.error('[pdf-editor] Rendern fehlgeschlagen', err)
        emit('error', 'Seite konnte nicht angezeigt werden.')
      }
    })
}

watch(
  () => [props.sourceId, props.pageIndex, props.rotation, props.scale, canvas.value] as const,
  () => scheduleRender(),
  { immediate: true, flush: 'post' },
)

onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <canvas ref="canvas" class="block bg-white" />
</template>
