<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'

import PdfPageCanvas from '@/components/PdfPageCanvas.vue'
import { useI18n } from '@/i18n'
import { HIGHLIGHT_OPACITY } from '@/services/pdfExport'
import { displaySize, normalizeRotation, TEXT_LINE_HEIGHT } from '@/lib/geometry'
import type { TextLine } from '@/lib/textLines'
import {
  CSS_FONTS,
  longestLineWidth,
  minTextWidth,
  reflowText,
  sameBreaks,
  type Reflow,
} from '@/lib/textLayout'
import { adjustSoftBreaks, caretAfterWrap, unwrapSoft } from '@/lib/textWrap'
import { getTextLines } from '@/services/pdfRenderer'
import { useDocumentStore } from '@/stores/document'
import type { Annotation, PageRef, TextAnnotation } from '@/types/pdf'

const props = defineProps<{ page: PageRef }>()
const emit = defineEmits<{ requestSignature: [] }>()

const store = useDocumentStore()
const { t } = useI18n()

const MIN_SIZE = 4
/** Bis zu dieser Zeigerbewegung (Bildschirmpixel) gilt ein Drücken als Klick. */
const CLICK_TOLERANCE_PX = 3
const SIGNATURE_WIDTH = 160
/** Darstellung echter Schwärzungen im Editor: halbtransparent, damit man sieht, was entfernt wird. */
function redactPreview(color: string): string {
  return `color-mix(in srgb, ${color} 60%, transparent)`
}

/** KI-Vorschläge auf der Seite – nur im privaten Build (fällt sonst beim Bauen weg). */
const SuggestionOverlay = __PRIVATE__
  ? defineAsyncComponent(() => import('@/private/components/SuggestionOverlay.vue'))
  : null
/** Vorschau ausgefüllter Formularfelder – nur im privaten Build. */
const FormOverlay = __PRIVATE__
  ? defineAsyncComponent(() => import('@/private/components/FormOverlay.vue'))
  : null
/** Gefundene Bilder (Werkzeug „Bilder“) – nur im privaten Build. */
const ImageOverlay = __PRIVATE__
  ? defineAsyncComponent(() => import('@/private/components/ImageOverlay.vue'))
  : null
const rotation = computed(() => normalizeRotation(props.page.baseRotation + props.page.rotation))
const size = computed(() => displaySize(props.page.box, rotation.value))
const zoom = computed(() => store.zoom)

const overlay = ref<HTMLElement | null>(null)

/** Position des Löschen-Knopfs: Flächen/Bilder rechts oben, Text links neben der ersten Zeile. */
function deleteHandleStyle(a: Annotation): Record<string, string> {
  if (a.kind === 'text') return { left: `calc(${px(a.x)} - 24px)`, top: px(a.y) }
  return { left: `calc(${px(a.x + a.width)} - 10px)`, top: `calc(${px(a.y)} - 10px)` }
}
const editingId = ref<string | null>(null)
/** Undo-Gruppe der laufenden Textbearbeitung (Tippen = ein Schritt). */
let editGroup: string | null = null
const renderError = ref<string | null>(null)

interface DragState {
  mode: 'move' | 'resize' | 'create'
  /** Bei mode 'create': welche Fläche entsteht. */
  createKind?: 'highlight' | 'cover' | 'redact'
  pointerId: number
  startX: number
  startY: number
  annotationId: string | null
  /** Undo-Gruppe: eine Zieh-Bewegung = ein Schritt. */
  group: string
  /** Wurde der Zeiger merklich bewegt? (Sonst war es ein Klick.) */
  moved: boolean
  orig: { x: number; y: number; width: number; height: number }
}
const drag = ref<DragState | null>(null)
const preview = ref<{ x: number; y: number; width: number; height: number } | null>(null)

const cursor = computed(() => {
  switch (store.tool) {
    case 'text':
      return 'cursor-text'
    case 'highlight':
    case 'cover':
    case 'redact':
    case 'signature':
      return 'cursor-crosshair'
    case 'select':
    case 'edit-text':
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
    store.error = t('error.signatureFailed')
  }
}

async function startTextEdit(id: string, group?: string): Promise<void> {
  if (editingId.value === id) return
  editingId.value = id
  editGroup = group ?? store.newGroup('edit')
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
      const group = store.newGroup('edit')
      const id = store.addAnnotation(
        props.page.id,
        {
          kind: 'text',
          text: '',
          fontSize: effectiveFontSize(),
          color: store.textColor,
          x: p.x,
          y: clamp(p.y - (effectiveFontSize() * TEXT_LINE_HEIGHT) / 2, 0, size.value.height),
        },
        group,
      )
      if (id) void startTextEdit(id, group)
      e.preventDefault()
      return
    }
    case 'highlight':
    case 'cover':
    case 'redact': {
      overlay.value?.setPointerCapture(e.pointerId)
      drag.value = {
        mode: 'create',
        createKind: store.tool,
        group: '',
        moved: false,
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
    case 'edit-text':
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
    group: store.newGroup('drag'),
    moved: false,
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
  if (Math.hypot(dx, dy) * zoom.value > CLICK_TOLERANCE_PX) d.moved = true

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

  if (d.mode === 'move' && a.kind === 'text') {
    // Text darf überall auf die Seite: rechts wird er schmaler umbrochen statt blockiert.
    const unwrapped = unwrapSoft(a.text, a.softBreaks ?? [])
    const keep =
      a.replacesKey === undefined ? minTextWidth(unwrapped, a) : longestLineWidth(unwrapped, a)
    const x = clamp(d.orig.x + dx, 0, size.value.width - Math.min(keep, size.value.width))
    const r = reflow(a, a.text, a.softBreaks ?? [], x)
    const text = r?.text ?? a.text
    const height = text.split('\n').length * a.fontSize * TEXT_LINE_HEIGHT
    const y = clamp(d.orig.y + dy, 0, size.value.height - Math.min(height, size.value.height))
    const changed = r && (r.text !== a.text || !sameBreaks(a.softBreaks, r.softBreaks))
    store.updateAnnotation(
      props.page.id,
      a.id,
      changed ? { x, y, text: r.text, softBreaks: r.softBreaks } : { x, y },
      d.group,
    )
    return
  }
  if (d.mode === 'move') {
    store.updateAnnotation(
      props.page.id,
      a.id,
      {
        x: clamp(d.orig.x + dx, 0, size.value.width - Math.min(d.orig.width, size.value.width)),
        y: clamp(d.orig.y + dy, 0, size.value.height - Math.min(d.orig.height, size.value.height)),
      },
      d.group,
    )
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
  store.updateAnnotation(props.page.id, a.id, { width, height }, d.group)
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
      if (d.createKind === 'cover') {
        store.addAnnotation(props.page.id, { kind: 'cover', color: store.coverColor, ...r })
      } else if (d.createKind === 'redact') {
        store.addAnnotation(props.page.id, {
          kind: 'cover',
          redact: true,
          color: store.redactColor,
          ...r,
        })
      } else {
        store.addAnnotation(props.page.id, { kind: 'highlight', color: store.highlightColor, ...r })
      }
    }
  }
  drag.value = null
  preview.value = null
  // Klick ohne Bewegung erzeugt so keinen leeren Undo-Schritt.
  store.closeHistoryGroup()
  // Text-Werkzeug: Klick (ohne Ziehen) auf einen eingefügten Text öffnet ihn zum Bearbeiten.
  if (d.mode === 'move' && !d.moved && store.tool === 'text' && d.annotationId) {
    const a = props.page.annotations.find((x) => x.id === d.annotationId)
    if (a?.kind === 'text') void startTextEdit(a.id)
  }
}

// ---- Zeilenumbruch eingefügter Texte --------------------------------------
/** Umbruch am rechten Rand dieser Seite, siehe `reflowText`. */
function reflow(
  a: TextAnnotation,
  text?: string,
  softBreaks?: readonly number[],
  x?: number,
): Reflow | null {
  return reflowText(a, {
    pageWidth: size.value.width,
    ...(text !== undefined ? { text } : {}),
    ...(softBreaks !== undefined ? { softBreaks } : {}),
    ...(x !== undefined ? { x } : {}),
  })
}

/** Übernimmt einen neuen Umbruch, falls er vom gespeicherten Stand abweicht. */
function applyReflow(a: TextAnnotation, group?: string): void {
  const r = reflow(a)
  if (!r || (r.text === a.text && sameBreaks(a.softBreaks, r.softBreaks))) return
  store.updateAnnotation(props.page.id, a.id, { text: r.text, softBreaks: r.softBreaks }, group)
}

/**
 * Größe, Schrift, Schnitt (fett/kursiv) oder X-Position in der Werkzeugleiste geändert: bereits umbrochene Texte neu umbrechen
 * (gleiche Undo-Gruppe wie die Änderung selbst).
 */
watch(
  () =>
    props.page.annotations
      .map((a) =>
        a.kind === 'text'
          ? `${a.id}:${a.x}:${a.fontSize}:${a.font ?? ''}:${a.bold === true}:${a.italic === true}`
          : '',
      )
      .join('|'),
  () => {
    for (const a of props.page.annotations) {
      if (a.kind === 'text' && a.softBreaks !== undefined) applyReflow(a, `style:${a.id}`)
    }
  },
)

/**
 * Beendet die Textbearbeitung und entfernt leere Textannotationen.
 * Wird explizit aufgerufen, weil ein per v-if entferntes Textfeld kein blur auslöst.
 */
function stopEditing(): void {
  const id = editingId.value
  const group = editGroup ?? undefined
  editingId.value = null
  editGroup = null
  if (!id) return
  const a = props.page.annotations.find((x) => x.id === id)
  if (a?.kind === 'text' && a.text.trim() === '') {
    store.removeAnnotation(props.page.id, a.id, group)
  } else if (a?.kind === 'text') {
    // Auffangnetz, z. B. nach Eingabe per IME oder für ältere, zu lange Texte.
    applyReflow(a, group)
  }
  // Leere Bearbeitung (nichts getippt) hinterlässt keinen Undo-Schritt.
  store.closeHistoryGroup()
}

/**
 * Bedienelemente, die den gerade bearbeiteten Text formatieren (Größe, Schrift, Farbe
 * in der Werkzeugleiste). Wechselt der Fokus dorthin, bleibt die Bearbeitung offen –
 * sonst würde ein neues, noch leeres Textfeld beim Klick auf die Schriftauswahl gelöscht.
 */
const STYLE_CONTROLS = '[data-text-style-controls]'

function keepsEditing(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest(STYLE_CONTROLS)) return true
  return (
    target instanceof HTMLTextAreaElement &&
    target.dataset.id === editingId.value &&
    overlay.value?.contains(target) === true
  )
}

function finishTextEdit(a: Annotation, e?: FocusEvent): void {
  if (editingId.value !== a.id) return
  if (keepsEditing(e?.relatedTarget ?? null)) return
  stopEditing()
}

/** Fokus verlässt die Format-Bedienelemente: Bearbeitung beenden, außer es geht zurück ins Textfeld. */
function onDocumentFocusOut(e: FocusEvent): void {
  if (!editingId.value) return
  if (!(e.target instanceof Element) || !e.target.closest(STYLE_CONTROLS)) return
  if (keepsEditing(e.relatedTarget)) return
  stopEditing()
}

onMounted(() => document.addEventListener('focusout', onDocumentFocusOut))
onBeforeUnmount(() => document.removeEventListener('focusout', onDocumentFocusOut))
// Werkzeugwechsel per Tastenkürzel beendet die Bearbeitung ebenfalls.
// `sync`, damit ein direkt folgender Klick nicht das dabei neu angelegte Textfeld trifft.
watch(() => store.tool, stopEditing, { flush: 'sync' })

function onTextInput(a: Annotation, e: Event): void {
  if (a.kind !== 'text') return
  const el = e.target as HTMLTextAreaElement
  let value = el.value
  let softBreaks = adjustSoftBreaks(a.text, value, a.softBreaks ?? [])
  // Während einer IME-Eingabe den Text nicht verändern (Umbruch folgt beim Beenden).
  const composing = e instanceof InputEvent && e.isComposing
  const r = composing ? null : reflow(a, value, softBreaks)
  if (r) {
    if (r.text !== value) {
      const caret = caretAfterWrap(el.selectionStart ?? value.length, r)
      el.value = r.text
      el.setSelectionRange(caret, caret)
    }
    value = r.text
    softBreaks = r.softBreaks
  }
  const patch = a.replacesKey === undefined ? { text: value, softBreaks } : { text: value }
  store.updateAnnotation(props.page.id, a.id, patch, editGroup ?? undefined)
}

onBeforeUnmount(stopEditing)

// ---- Vorhandenen Text bearbeiten ------------------------------------------
const textLines = ref<TextLine[]>([])
const textLinesState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
let textLinesRequest = 0

watch(
  () => [store.tool, props.page.sourceId, props.page.sourceIndex, rotation.value] as const,
  async ([tool, sourceId, sourceIndex, rot]) => {
    if (tool !== 'edit-text') return
    const request = ++textLinesRequest
    textLinesState.value = 'loading'
    try {
      const lines = await getTextLines(sourceId, sourceIndex, rot)
      if (request !== textLinesRequest) return // veraltete Antwort
      textLines.value = lines
      textLinesState.value = 'ready'
    } catch (err) {
      if (request !== textLinesRequest) return
      console.error('[pdf-editor] Texterkennung fehlgeschlagen', err)
      textLines.value = []
      textLinesState.value = 'error'
    }
  },
  { immediate: true },
)

/** Abdeckungen ersetzter Zeilen („Text bearbeiten“): deckend, ohne Schwärzungsrahmen. */
/** Deckend dargestellte Schwärzung: ersetzte Textzeile oder gelöschtes Bild. */
function solidCover(a: Annotation): boolean {
  return textCovers.value.has(a.id) || (a.kind === 'cover' && a.solid === true)
}

const textCovers = computed(
  () =>
    new Set(
      props.page.annotations.flatMap((a) => (a.kind === 'text' && a.coverId ? [a.coverId] : [])),
    ),
)

/** Zeilen, die noch nicht ersetzt wurden. */
const editableLines = computed(() => {
  const replaced = new Set(
    props.page.annotations.flatMap((a) =>
      a.kind === 'text' && a.replacesKey ? [a.replacesKey] : [],
    ),
  )
  return textLines.value.filter((l) => !replaced.has(l.key))
})

function onLinePointerDown(e: PointerEvent, line: TextLine): void {
  if (e.button !== 0) return
  e.stopPropagation()
  e.preventDefault()
  stopEditing()
  const group = store.newGroup('edit')
  const id = store.replaceTextLine(props.page.id, line, group)
  if (id) void startTextEdit(id, group)
}

function px(v: number): string {
  return `${v * zoom.value}px`
}
</script>

<template>
  <div
    class="pdf-document-page relative inline-block"
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
      <!-- Erkannte Textzeilen (Werkzeug „Text bearbeiten“) -->
      <template v-if="store.tool === 'edit-text'">
        <div
          v-for="line in editableLines"
          :key="line.key"
          class="absolute cursor-text rounded-sm outline-1 outline-blue-400/40 hover:bg-blue-500/15 hover:outline-blue-500"
          :style="{
            left: px(line.x - 1),
            top: px(line.top - 1),
            width: px(line.width + 2),
            height: px(line.height + 2),
          }"
          :title="t('editor.editLine', { text: line.text })"
          data-testid="text-line"
          @pointerdown="onLinePointerDown($event, line)"
        />
      </template>

      <template v-for="a in page.annotations" :key="a.id">
        <!-- Abdeckung / echte Schwärzung -->
        <div
          v-if="a.kind === 'cover'"
          class="absolute cursor-move"
          :class="{
            'outline-2 outline-blue-500 outline-dashed': store.selectedAnnotationId === a.id,
            'outline-1 outline-red-600':
              a.redact && !solidCover(a) && store.selectedAnnotationId !== a.id,
          }"
          :style="{
            left: px(a.x),
            top: px(a.y),
            width: px(a.width),
            height: px(a.height),
            backgroundColor: a.redact && !solidCover(a) ? redactPreview(a.color) : a.color,
          }"
          :title="
            a.redact
              ? textCovers.has(a.id)
                ? 'Ersetzte Zeile: wird beim Export echt entfernt'
                : a.solid
                  ? 'Gelöschter Bereich: wird beim Export echt entfernt'
                  : 'Echte Schwärzung: Inhalt wird beim Export entfernt'
              : undefined
          "
          :data-testid="a.redact && !solidCover(a) ? 'redaction' : undefined"
          @pointerdown="onAnnotationPointerDown($event, a, 'move')"
        />

        <!-- Markierung -->
        <div
          v-else-if="a.kind === 'highlight'"
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
            :alt="t('editor.imageAlt')"
            class="pointer-events-none h-full w-full"
            draggable="false"
          />
        </div>

        <!-- Text -->
        <div
          v-else-if="a.kind === 'text'"
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
            fontFamily: CSS_FONTS[a.font ?? 'sans'],
            fontWeight: a.bold ? 'bold' : 'normal',
            fontStyle: a.italic ? 'italic' : 'normal',
            textAlign: a.align ?? 'left',
          }"
          @pointerdown="onAnnotationPointerDown($event, a, 'move')"
          @dblclick.stop="startTextEdit(a.id)"
        >
          <textarea
            v-if="editingId === a.id"
            :data-id="a.id"
            :value="a.text"
            wrap="off"
            class="block resize-none overflow-hidden border-0 bg-white/70 p-0 whitespace-pre outline-none [field-sizing:content]"
            :style="{
              minWidth: '6em',
              font: 'inherit',
              color: 'inherit',
              lineHeight: 'inherit',
              textAlign: 'inherit',
            }"
            :aria-label="t('editor.annotationText')"
            @input="onTextInput(a, $event)"
            @blur="finishTextEdit(a, $event)"
            @keydown.esc="($event.target as HTMLTextAreaElement).blur()"
            @pointerdown.stop
          />
          <span v-else class="block whitespace-pre">{{ a.text }}</span>
        </div>

        <!-- Löschen-Knopf an der ausgewählten Annotation -->
        <button
          v-if="store.selectedAnnotationId === a.id && editingId !== a.id"
          type="button"
          class="absolute z-10 grid h-5 w-5 place-items-center rounded-full border border-white bg-red-600 text-xs leading-none text-white shadow hover:bg-red-700"
          :style="deleteHandleStyle(a)"
          :title="t('editor.deleteHint')"
          :aria-label="t('editor.deleteSelection')"
          data-testid="annotation-delete"
          @pointerdown.stop
          @click.stop="store.removeAnnotation(page.id, a.id)"
        >
          ✕
        </button>

        <!-- Resize-Griff -->
        <div
          v-if="a.kind !== 'text' && store.selectedAnnotationId === a.id"
          class="absolute h-3 w-3 cursor-se-resize rounded-sm border border-white bg-blue-600"
          :style="{
            left: `calc(${px(a.x + a.width)} - 6px)`,
            top: `calc(${px(a.y + a.height)} - 6px)`,
          }"
          :title="t('editor.resize')"
          @pointerdown="onAnnotationPointerDown($event, a, 'resize')"
        />
      </template>

      <component :is="FormOverlay" v-if="FormOverlay" :page="page" :zoom="zoom" />
      <component :is="SuggestionOverlay" v-if="SuggestionOverlay" :page="page" :zoom="zoom" />
      <component :is="ImageOverlay" v-if="ImageOverlay" :page="page" :zoom="zoom" />
      <div
        v-if="preview"
        class="pointer-events-none absolute border border-yellow-600"
        :style="{
          left: px(preview.x),
          top: px(preview.y),
          width: px(preview.width),
          height: px(preview.height),
          backgroundColor:
            drag?.createKind === 'redact'
              ? redactPreview(store.redactColor)
              : drag?.createKind === 'cover'
                ? store.coverColor
                : store.highlightColor,
          opacity: drag?.createKind === 'highlight' ? HIGHLIGHT_OPACITY : 1,
        }"
      />

      <p
        v-if="
          store.tool === 'edit-text' &&
          textLinesState !== 'loading' &&
          textLinesState !== 'idle' &&
          textLines.length === 0
        "
        class="pointer-events-none absolute inset-x-4 top-4 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800 shadow"
      >
        {{
          textLinesState === 'error'
            ? 'Text konnte nicht erkannt werden.'
            : 'Auf dieser Seite wurde kein bearbeitbarer Text gefunden (z. B. eingescanntes Dokument).'
        }}
      </p>
    </div>
  </div>
</template>
