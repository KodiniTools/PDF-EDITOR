<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

import PdfPageCanvas from '@/components/PdfPageCanvas.vue'
import { HIGHLIGHT_OPACITY } from '@/services/pdfExport'
import { displaySize, normalizeRotation, TEXT_LINE_HEIGHT } from '@/lib/geometry'
import { useDocumentStore } from '@/stores/document'
import type { Annotation, PageRef } from '@/types/pdf'

const props = defineProps<{ page: PageRef }>()
const emit = defineEmits<{ requestSignature: [] }>()

const store = useDocumentStore()

const MIN_SIZE = 4
const SIGNATURE_WIDTH = 160

const rotation = computed(() => normalizeRotation(props.page.baseRotation + props.page.rotation))
const size = computed(() => displaySize(props.page.box, rotation.value))
const zoom = computed(() => store.zoom)

const overlay = ref<HTMLElement | null>(null)
const editingId = ref<string | null>(null)
const renderError = ref<string | null>(null)

interface DragState {
  mode: 'move' | 'resize' | 'create'
  pointerId: number
  startX: number
  startY: number
  annotationId: string | null
  orig: { x: number; y: number; width: number; height: number }
}
const drag = ref<DragState | null>(null)
const preview = ref<{ x: number; y: number; width: number; height: number } | null>(null)

const cursor = computed(() => {
  switch (store.tool) {
    case 'text':
      return 'cursor-text'
    case 'highlight':
    case 'signature':
      return 'cursor-crosshair'
    case 'select':
      return 'cursor-default'
    default: {
      const exhaustive: never = store.tool
      return String(exhaustive)
    }
  }
})

/** Pointer-Position in Seitenpunkten (angezeigter Raum). */
function toPagePoint(e: PointerEvent): { x: number; y: number } {
  const rect = overlay.value?.getBoundingClientRect()
  if (!rect) return { x: 0, y: 0 }
  return {
    x: clamp((e.clientX - rect.left) / zoom.value, 0, size.value.width),
    y: clamp((e.clientY - rect.top) / zoom.value, 0, size.value.height),
  }
}

/** Schriftgröße aus der Toolbar, abgesichert gegen leere/ungültige Eingaben. */
function effectiveFontSize(): number {
  const n = Number(store.fontSize)
  return Number.isFinite(n) && n > 0 ? clamp(n, 6, 96) : 14
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), Math.max(min, max))
}

function boxOf(a: Annotation): { x: number; y: number; width: number; height: number } {
  if (a.kind === 'text') {
    const lines = a.text.split('\n')
    const longest = Math.max(1, ...lines.map((l) => l.length))
    return {
      x: a.x,
      y: a.y,
      width: longest * a.fontSize * 0.55,
      height: lines.length * a.fontSize * TEXT_LINE_HEIGHT,
    }
  }
  return { x: a.x, y: a.y, width: a.width, height: a.height }
}

function loadImageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 })
    img.onerror = () => reject(new Error('Bild konnte nicht geladen werden'))
    img.src = dataUrl
  })
}

async function placeSignature(at: { x: number; y: number }): Promise<void> {
  const dataUrl = store.signatureDataUrl
  if (!dataUrl) {
    emit('requestSignature')
    return
  }
  try {
    const natural = await loadImageSize(dataUrl)
    const width = Math.min(SIGNATURE_WIDTH, size.value.width)
    const height = (width * natural.height) / natural.width
    store.addAnnotation(props.page.id, {
      kind: 'image',
      dataUrl,
      width,
      height,
      x: clamp(at.x - width / 2, 0, size.value.width - width),
      y: clamp(at.y - height / 2, 0, size.value.height - height),
    })
    store.setTool('select')
  } catch (err) {
    console.error('[pdf-editor] Signatur', err)
    store.error = 'Signatur konnte nicht eingefügt werden.'
  }
}

async function startTextEdit(id: string): Promise<void> {
  editingId.value = id
  store.selectedAnnotationId = id
  await nextTick()
  const el = overlay.value?.querySelector<HTMLTextAreaElement>(`textarea[data-id="${id}"]`)
  el?.focus()
}

function onOverlayPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  const p = toPagePoint(e)
  stopEditing()
  store.selectedAnnotationId = null

  switch (store.tool) {
    case 'text': {
      const id = store.addAnnotation(props.page.id, {
        kind: 'text',
        text: '',
        fontSize: effectiveFontSize(),
        color: store.textColor,
        x: p.x,
        y: clamp(p.y - (effectiveFontSize() * TEXT_LINE_HEIGHT) / 2, 0, size.value.height),
      })
      if (id) void startTextEdit(id)
      e.preventDefault()
      return
    }
    case 'highlight': {
      overlay.value?.setPointerCapture(e.pointerId)
      drag.value = {
        mode: 'create',
        pointerId: e.pointerId,
        startX: p.x,
        startY: p.y,
        annotationId: null,
        orig: { x: p.x, y: p.y, width: 0, height: 0 },
      }
      preview.value = { x: p.x, y: p.y, width: 0, height: 0 }
      return
    }
    case 'signature':
      void placeSignature(p)
      return
    case 'select':
      return
    default: {
      const exhaustive: never = store.tool
      throw new Error(`Unbekanntes Werkzeug ${String(exhaustive)}`)
    }
  }
}

function onAnnotationPointerDown(e: PointerEvent, a: Annotation, mode: 'move' | 'resize'): void {
  if (e.button !== 0 || editingId.value === a.id) return
  stopEditing()
  e.stopPropagation()
  e.preventDefault()
  store.selectedAnnotationId = a.id
  const p = toPagePoint(e)
  overlay.value?.setPointerCapture(e.pointerId)
  drag.value = {
    mode,
    pointerId: e.pointerId,
    startX: p.x,
    startY: p.y,
    annotationId: a.id,
    orig: boxOf(a),
  }
}

function onPointerMove(e: PointerEvent): void {
  const d = drag.value
  if (!d || d.pointerId !== e.pointerId) return
  const p = toPagePoint(e)
  const dx = p.x - d.startX
  const dy = p.y - d.startY

  if (d.mode === 'create') {
    preview.value = {
      x: Math.min(d.startX, p.x),
      y: Math.min(d.startY, p.y),
      width: Math.abs(dx),
      height: Math.abs(dy),
    }
    return
  }
  if (!d.annotationId) return
  const a = props.page.annotations.find((x) => x.id === d.annotationId)
  if (!a) return

  if (d.mode === 'move') {
    store.updateAnnotation(props.page.id, a.id, {
      x: clamp(d.orig.x + dx, 0, size.value.width - Math.min(d.orig.width, size.value.width)),
      y: clamp(d.orig.y + dy, 0, size.value.height - Math.min(d.orig.height, size.value.height)),
    })
    return
  }
  // resize
  if (a.kind === 'text') return
  let width = clamp(d.orig.width + dx, MIN_SIZE, size.value.width - d.orig.x)
  let height = clamp(d.orig.height + dy, MIN_SIZE, size.value.height - d.orig.y)
  if (a.kind === 'image') {
    // Seitenverhältnis beibehalten
    const ratio = d.orig.height / d.orig.width
    height = width * ratio
    if (d.orig.y + height > size.value.height) {
      height = size.value.height - d.orig.y
      width = height / ratio
    }
  }
  store.updateAnnotation(props.page.id, a.id, { width, height })
}

function onPointerUp(e: PointerEvent): void {
  const d = drag.value
  if (!d || d.pointerId !== e.pointerId) return
  if (overlay.value?.hasPointerCapture(e.pointerId)) {
    overlay.value.releasePointerCapture(e.pointerId)
  }
  if (d.mode === 'create' && preview.value) {
    const r = preview.value
    if (r.width >= MIN_SIZE && r.height >= MIN_SIZE) {
      store.addAnnotation(props.page.id, { kind: 'highlight', color: store.highlightColor, ...r })
    }
  }
  drag.value = null
  preview.value = null
}

/**
 * Beendet die Textbearbeitung und entfernt leere Textannotationen.
 * Wird explizit aufgerufen, weil ein per v-if entferntes Textfeld kein blur auslöst.
 */
function stopEditing(): void {
  const id = editingId.value
  editingId.value = null
  if (!id) return
  const a = props.page.annotations.find((x) => x.id === id)
  if (a?.kind === 'text' && a.text.trim() === '') {
    store.removeAnnotation(props.page.id, a.id)
  }
}

function finishTextEdit(a: Annotation): void {
  if (editingId.value === a.id) stopEditing()
}

function onTextInput(a: Annotation, e: Event): void {
  const value = (e.target as HTMLTextAreaElement).value
  store.updateAnnotation(props.page.id, a.id, { text: value })
}

onBeforeUnmount(stopEditing)

function px(v: number): string {
  return `${v * zoom.value}px`
}
</script>

<template>
  <div
    class="relative inline-block shadow-lg"
    :style="{ width: px(size.width), height: px(size.height) }"
  >
    <PdfPageCanvas
      :source-id="page.sourceId"
      :page-index="page.sourceIndex"
      :rotation="rotation"
      :scale="zoom"
      @error="renderError = $event"
    />
    <p v-if="renderError" class="absolute inset-0 grid place-items-center text-sm text-red-600">
      {{ renderError }}
    </p>

    <div
      ref="overlay"
      class="absolute inset-0 touch-none select-none"
      :class="cursor"
      data-testid="overlay"
      @pointerdown="onOverlayPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <template v-for="a in page.annotations" :key="a.id">
        <!-- Markierung -->
        <div
          v-if="a.kind === 'highlight'"
          class="absolute cursor-move"
          :class="{
            'outline-2 outline-blue-500 outline-dashed': store.selectedAnnotationId === a.id,
          }"
          :style="{
            left: px(a.x),
            top: px(a.y),
            width: px(a.width),
            height: px(a.height),
            backgroundColor: a.color,
            opacity: HIGHLIGHT_OPACITY,
          }"
          @pointerdown="onAnnotationPointerDown($event, a, 'move')"
        />

        <!-- Bild / Signatur -->
        <div
          v-else-if="a.kind === 'image'"
          class="absolute cursor-move"
          :class="{
            'outline-2 outline-blue-500 outline-dashed': store.selectedAnnotationId === a.id,
          }"
          :style="{ left: px(a.x), top: px(a.y), width: px(a.width), height: px(a.height) }"
          @pointerdown="onAnnotationPointerDown($event, a, 'move')"
        >
          <img
            :src="a.dataUrl"
            alt="Signatur"
            class="pointer-events-none h-full w-full"
            draggable="false"
          />
        </div>

        <!-- Text -->
        <div
          v-else
          class="absolute"
          :class="{
            'outline-2 outline-blue-500 outline-dashed': store.selectedAnnotationId === a.id,
            'cursor-move': editingId !== a.id,
          }"
          :style="{
            left: px(a.x),
            top: px(a.y),
            color: a.color,
            fontSize: px(a.fontSize),
            lineHeight: String(TEXT_LINE_HEIGHT),
            fontFamily: 'Helvetica, Arial, sans-serif',
          }"
          @pointerdown="onAnnotationPointerDown($event, a, 'move')"
          @dblclick.stop="startTextEdit(a.id)"
        >
          <textarea
            v-if="editingId === a.id"
            :data-id="a.id"
            :value="a.text"
            class="block resize-none overflow-hidden border-0 bg-white/70 p-0 outline-none [field-sizing:content]"
            :style="{ minWidth: '6em', font: 'inherit', color: 'inherit', lineHeight: 'inherit' }"
            aria-label="Annotationstext"
            @input="onTextInput(a, $event)"
            @blur="finishTextEdit(a)"
            @keydown.esc="($event.target as HTMLTextAreaElement).blur()"
            @pointerdown.stop
          />
          <span v-else class="block whitespace-pre">{{ a.text }}</span>
        </div>

        <!-- Resize-Griff -->
        <div
          v-if="a.kind !== 'text' && store.selectedAnnotationId === a.id"
          class="absolute h-3 w-3 cursor-se-resize rounded-sm border border-white bg-blue-600"
          :style="{
            left: `calc(${px(a.x + a.width)} - 6px)`,
            top: `calc(${px(a.y + a.height)} - 6px)`,
          }"
          title="Größe ändern"
          @pointerdown="onAnnotationPointerDown($event, a, 'resize')"
        />
      </template>

      <div
        v-if="preview"
        class="pointer-events-none absolute border border-yellow-600"
        :style="{
          left: px(preview.x),
          top: px(preview.y),
          width: px(preview.width),
          height: px(preview.height),
          backgroundColor: store.highlightColor,
          opacity: HIGHLIGHT_OPACITY,
        }"
      />
    </div>
  </div>
</template>
