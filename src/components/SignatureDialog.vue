<script setup lang="ts">
import { onMounted, ref } from 'vue'

const emit = defineEmits<{ save: [dataUrl: string]; cancel: [] }>()

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

const canvas = ref<HTMLCanvasElement | null>(null)
const dialog = ref<HTMLDialogElement | null>(null)
const hasStrokes = ref(false)
const uploadError = ref<string | null>(null)
let drawing = false
let last: { x: number; y: number } | null = null

onMounted(() => {
  // Erst öffnen, sonst ist das Canvas noch unsichtbar (clientWidth = 0).
  // showModal fehlt in manchen Testumgebungen → Fallback auf nicht-modales Öffnen.
  const d = dialog.value
  if (d && typeof d.showModal === 'function') d.showModal()
  else if (d) d.open = true

  const el = canvas.value
  if (!el) return
  const dpr = window.devicePixelRatio || 1
  el.width = Math.max(1, el.clientWidth * dpr)
  el.height = Math.max(1, el.clientHeight * dpr)
  const ctx = el.getContext('2d')
  if (ctx) {
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0b1f5c'
  }
})

function point(e: PointerEvent): { x: number; y: number } {
  const r = canvas.value?.getBoundingClientRect()
  return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
}

function onDown(e: PointerEvent): void {
  drawing = true
  last = point(e)
  canvas.value?.setPointerCapture(e.pointerId)
}

function onMove(e: PointerEvent): void {
  if (!drawing || !last) return
  const ctx = canvas.value?.getContext('2d')
  if (!ctx) return
  const p = point(e)
  ctx.beginPath()
  ctx.moveTo(last.x, last.y)
  ctx.lineTo(p.x, p.y)
  ctx.stroke()
  last = p
  hasStrokes.value = true
}

function onUp(): void {
  drawing = false
  last = null
}

function clear(): void {
  const el = canvas.value
  el?.getContext('2d')?.clearRect(0, 0, el.width, el.height)
  hasStrokes.value = false
}

/** Schneidet transparente Ränder ab, damit die Signatur eng anliegt. */
function trimmedDataUrl(source: HTMLCanvasElement): string {
  const ctx = source.getContext('2d')
  if (!ctx) return source.toDataURL('image/png')
  const { width, height } = source
  const data = ctx.getImageData(0, 0, width, height).data
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) > 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return source.toDataURL('image/png')
  const pad = 4
  const x = Math.max(0, minX - pad)
  const y = Math.max(0, minY - pad)
  const w = Math.min(width, maxX + pad + 1) - x
  const h = Math.min(height, maxY + pad + 1) - y
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  out.getContext('2d')?.drawImage(source, x, y, w, h, 0, 0, w, h)
  return out.toDataURL('image/png')
}

function save(): void {
  if (!canvas.value || !hasStrokes.value) return
  emit('save', trimmedDataUrl(canvas.value))
}

function onUpload(e: Event): void {
  uploadError.value = null
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!['image/png', 'image/jpeg'].includes(file.type)) {
    uploadError.value = 'Nur PNG oder JPEG.'
    return
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    uploadError.value = 'Bild ist zu groß (max. 5 MB).'
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    if (typeof reader.result === 'string') emit('save', reader.result)
  }
  reader.onerror = () => (uploadError.value = 'Bild konnte nicht gelesen werden.')
  reader.readAsDataURL(file)
}
</script>

<template>
  <dialog
    ref="dialog"
    class="m-auto w-[min(92vw,560px)] rounded-xl p-0 shadow-2xl backdrop:bg-black/40"
    aria-labelledby="sig-title"
    @cancel.prevent="emit('cancel')"
  >
    <div class="space-y-3 p-5">
      <h2 id="sig-title" class="text-lg font-semibold">Signatur erstellen</h2>
      <p class="text-sm text-gray-600">
        Mit Maus, Stift oder Finger zeichnen – oder ein Bild hochladen.
      </p>
      <canvas
        ref="canvas"
        class="h-48 w-full touch-none rounded-lg border border-dashed border-gray-400 bg-gray-50"
        data-testid="signature-canvas"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
      />
      <p v-if="uploadError" class="text-sm text-red-600">{{ uploadError }}</p>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex gap-2">
          <button type="button" class="btn" @click="clear">Leeren</button>
          <label class="btn cursor-pointer">
            Bild hochladen
            <input type="file" accept="image/png,image/jpeg" class="sr-only" @change="onUpload" />
          </label>
        </div>
        <div class="flex gap-2">
          <button type="button" class="btn" @click="emit('cancel')">Abbrechen</button>
          <button type="button" class="btn btn-primary" :disabled="!hasStrokes" @click="save">
            Übernehmen
          </button>
        </div>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
@reference 'tailwindcss';

.btn {
  @apply rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50;
}
.btn-primary {
  @apply border-blue-600 bg-blue-600 text-white hover:bg-blue-700;
}
</style>
