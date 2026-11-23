<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'

import NewDocumentDialog from '@/components/NewDocumentDialog.vue'
import { useI18n } from '@/i18n'
import { displaySize, normalizeRotation, TEXT_LINE_HEIGHT } from '@/lib/geometry'
import { IMAGE_ACCEPT, readImageFile } from '@/lib/image'
import { CSS_FONTS, longestLineWidth, minTextWidth } from '@/lib/textLayout'
import { unwrapSoft } from '@/lib/textWrap'
import { useDocumentStore } from '@/stores/document'
import type { FontFamily, TextAlign, Tool } from '@/types/pdf'

const emit = defineEmits<{
  openFiles: [files: File[]]
  export: []
  print: []
  help: []
  editSignature: []
}>()

const store = useDocumentStore()
const { t } = useI18n()
const isPrivate = __PRIVATE__
/** „Neues Dokument“ + KI-Modellauswahl – nur im privaten Build. */
const PrivateToolbar = __PRIVATE__
  ? defineAsyncComponent(() => import('@/private/components/PrivateToolbar.vue'))
  : null
/** Dialog „Neues Dokument“ der öffentlichen Variante (privat: eigener Dialog in PrivateToolbar). */
const showNewDocument = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const imageInput = ref<HTMLInputElement | null>(null)
const scanInput = ref<HTMLInputElement | null>(null)
/** PDFs und Scans/Fotos (werden als A4-Seite übernommen). */
const OPEN_ACCEPT = `application/pdf,.pdf,${IMAGE_ACCEPT}`

/** Bild aus Datei einfügen: zentriert auf der aktuellen Seite, danach verschieb-/skalierbar. */
async function onImageChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // gleiche Datei erneut wählbar
  if (!file) return
  try {
    store.addImage(await readImageFile(file))
  } catch (err) {
    console.error('[pdf-editor] Bild', err)
    store.error =
      err instanceof Error && err.name === 'ImageError' ? err.message : t('error.imageInsertFailed')
  }
}

const deleteLabel = computed(() => {
  switch (store.selectedAnnotation?.kind) {
    case 'image':
      return t('toolbar.deleteImage')
    case 'text':
      return t('toolbar.deleteText')
    default:
      return t('toolbar.delete')
  }
})

/** Werkzeuge in der aktuellen Sprache (`computed`: folgt dem Sprachwechsel). */
const tools = computed<{ id: Tool; label: string; hint: string }[]>(() => [
  { id: 'select', label: t('tool.select'), hint: t('tool.selectHint') },
  { id: 'edit-text', label: t('tool.editText'), hint: t('tool.editTextHint') },
  { id: 'text', label: t('tool.text'), hint: t('tool.textHint') },
  { id: 'highlight', label: t('tool.highlight'), hint: t('tool.highlightHint') },
  { id: 'cover', label: t('tool.cover'), hint: t('tool.coverHint') },
  ...(__PRIVATE__
    ? [
        {
          id: 'redact' as const,
          label: 'Schwärzen',
          hint: 'Bereich aufziehen: Inhalt wird beim Export dauerhaft entfernt (R)',
        },
      ]
    : []),
  { id: 'signature', label: t('tool.signature'), hint: t('tool.signatureHint') },
])

/** Ausgewählte Textannotation, deren Größe/Farbe in der Toolbar geändert wird. */
const selectedText = computed(() => {
  const a = store.selectedAnnotation
  return a?.kind === 'text' ? a : null
})

const selectedFontSize = computed({
  get: () => selectedText.value?.fontSize ?? 0,
  set: (value: number) => {
    const page = store.selectedPage
    const n = Number(value)
    if (!page || !selectedText.value || !Number.isFinite(n) || n < 4 || n > 200) return
    store.updateAnnotation(
      page.id,
      selectedText.value.id,
      { fontSize: n },
      `style:${selectedText.value.id}`,
    )
  },
})

const selectedColor = computed({
  get: () => selectedText.value?.color ?? '#000000',
  set: (value: string) => {
    const page = store.selectedPage
    if (page && selectedText.value) {
      store.updateAnnotation(
        page.id,
        selectedText.value.id,
        { color: value },
        `style:${selectedText.value.id}`,
      )
    }
  },
})

const selectedFont = computed({
  get: () => selectedText.value?.font ?? 'sans',
  set: (value: FontFamily) => {
    const page = store.selectedPage
    if (page && selectedText.value) {
      store.updateAnnotation(
        page.id,
        selectedText.value.id,
        { font: value },
        `style:${selectedText.value.id}`,
      )
    }
  },
})

/** Millimeter je PDF-Punkt (1 pt = 1/72 Zoll). */
const MM_PER_PT = 25.4 / 72
const toMm = (pt: number): number => Math.round(pt * MM_PER_PT * 10) / 10

/** Ausgewähltes Objekt mit einstellbarer Position: Text oder Bild. */
const selectedPositioned = computed(() => {
  const a = store.selectedAnnotation
  return a?.kind === 'text' || a?.kind === 'image' ? a : null
})

/**
 * Setzt die Position der Auswahl (Text oder Bild, in mm ab linker oberer Seitenecke).
 * Das Objekt bleibt auf der Seite; Text wird rechts vom Seiteneditor schmaler umbrochen.
 */
function moveSelected(axis: 'x' | 'y', mm: number | string): void {
  const page = store.selectedPage
  const a = selectedPositioned.value
  const value = typeof mm === 'number' ? mm : Number.NaN
  if (!page || !a || !Number.isFinite(value)) return
  const size = displaySize(page.box, normalizeRotation(page.baseRotation + page.rotation))
  let extent: number
  if (a.kind === 'image') {
    extent = axis === 'x' ? a.width : a.height
  } else if (axis === 'x') {
    const unwrapped = unwrapSoft(a.text, a.softBreaks ?? [])
    extent =
      a.replacesKey === undefined ? minTextWidth(unwrapped, a) : longestLineWidth(unwrapped, a)
  } else {
    extent = a.text.split('\n').length * a.fontSize * TEXT_LINE_HEIGHT
  }
  const limit = (axis === 'x' ? size.width : size.height) - extent
  const next = Math.min(Math.max(0, value / MM_PER_PT), Math.max(0, limit))
  store.updateAnnotation(page.id, a.id, { [axis]: next }, `style:${a.id}`)
}

const selectedX = computed({
  get: () => toMm(selectedPositioned.value?.x ?? 0),
  set: (mm: number | string) => moveSelected('x', mm),
})
const selectedY = computed({
  get: () => toMm(selectedPositioned.value?.y ?? 0),
  set: (mm: number | string) => moveSelected('y', mm),
})

/** Fett/kursiv der Auswahl umschalten bzw. Ausrichtung setzen (ein Undo-Schritt je Text). */
function patchSelectedText(patch: { bold?: boolean; italic?: boolean; align?: TextAlign }): void {
  const page = store.selectedPage
  const a = selectedText.value
  if (page && a) store.updateAnnotation(page.id, a.id, patch, `style:${a.id}`)
}

const alignOptions = computed<{ value: TextAlign; label: string }[]>(() => [
  { value: 'left', label: t('toolbar.alignLeft') },
  { value: 'center', label: t('toolbar.alignCenter') },
  { value: 'right', label: t('toolbar.alignRight') },
])

const fontOptions: { value: FontFamily; label: string }[] = [
  { value: 'sans', label: 'Helvetica' },
  { value: 'serif', label: 'Times' },
  { value: 'mono', label: 'Courier' },
]

/** Ausgewählte Markierung (Farbe nachträglich änderbar). */
const selectedHighlight = computed(() => {
  const a = store.selectedAnnotation
  return a?.kind === 'highlight' ? a : null
})

/**
 * Markierfarbe: gilt für neue Markierungen und wirkt sofort auf die ausgewählte.
 * Das `input`-Ereignis des Farbwählers feuert schon während der Auswahl im Fenster.
 */
const highlightColor = computed({
  get: () => selectedHighlight.value?.color ?? store.highlightColor,
  set: (value: string) => {
    store.highlightColor = value
    const page = store.selectedPage
    if (page && selectedHighlight.value) {
      store.updateAnnotation(
        page.id,
        selectedHighlight.value.id,
        { color: value },
        `style:${selectedHighlight.value.id}`,
      )
    }
  },
})

/** Ausgewählte echte Schwärzung (Farbe nachträglich änderbar). */
const selectedRedaction = computed(() => {
  const a = store.selectedAnnotation
  return a?.kind === 'cover' && a.redact === true ? a : null
})

const redactColor = computed({
  get: () => selectedRedaction.value?.color ?? store.redactColor,
  set: (value: string) => {
    store.redactColor = value
    const page = store.selectedPage
    if (page && selectedRedaction.value) {
      store.updateAnnotation(
        page.id,
        selectedRedaction.value.id,
        { color: value },
        `style:${selectedRedaction.value.id}`,
      )
    }
  },
})

const redactPresets = [
  { color: '#000000', label: 'Schwarz' },
  { color: '#ffffff', label: 'Weiß' },
  { color: '#808080', label: 'Grau' },
]

const coverPresets = computed(() => [
  { color: '#ffffff', label: t('toolbar.white') },
  { color: '#000000', label: t('toolbar.black') },
])

/** Für Tastenkürzel (EditorView): Dateiauswahl öffnen. */
defineExpose({
  openFile: () => fileInput.value?.click(),
  openScan: () => scanInput.value?.click(),
  newDocument: () => {
    if (!isPrivate && !store.busy) showNewDocument.value = true
  },
  openImage: () => {
    if (store.hasDocument) imageInput.value?.click()
  },
})

function onFileChange(e: Event): void {
  const input = e.target as HTMLInputElement
  const files = input.files ? Array.from(input.files) : []
  input.value = '' // gleiche Datei erneut wählbar
  if (files.length > 0) emit('openFiles', files)
}

/** Kontextzeile ohne Inhalt: weder Auswahl noch Werkzeug mit eigenen Einstellungen. */
const TOOLS_WITH_OPTIONS: readonly Tool[] = ['text', 'highlight', 'cover', 'redact', 'signature']
const contextEmpty = computed(
  () => !store.selectedAnnotation && !TOOLS_WITH_OPTIONS.includes(store.tool),
)

function chooseTool(id: Tool): void {
  store.setTool(id)
  if (id === 'signature' && !store.signatureDataUrl) emit('editSignature')
}
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-2 border-b pdf-control-border pdf-control-surface px-3 py-2"
  >
    <button
      type="button"
      class="tb-btn tb-primary"
      :title="t('toolbar.openHint')"
      :disabled="store.busy"
      @click="fileInput?.click()"
    >
      {{ store.hasDocument ? t('toolbar.add') : t('toolbar.open') }}
    </button>
    <button
      type="button"
      class="tb-btn"
      :title="t('toolbar.scanHint')"
      :disabled="store.busy"
      data-testid="scan-button"
      @click="scanInput?.click()"
    >
      {{ t('toolbar.scan') }}
    </button>
    <input
      ref="scanInput"
      type="file"
      :accept="IMAGE_ACCEPT"
      capture="environment"
      multiple
      class="hidden"
      data-testid="scan-input"
      @change="onFileChange"
    />
    <input
      ref="fileInput"
      type="file"
      :accept="OPEN_ACCEPT"
      multiple
      class="hidden"
      data-testid="file-input"
      @change="onFileChange"
    />
    <component :is="PrivateToolbar" v-if="PrivateToolbar" />
    <button
      v-else
      type="button"
      class="tb-btn"
      :title="t(store.hasDocument ? 'toolbar.newPageHint' : 'toolbar.newDocumentHint')"
      :disabled="store.busy"
      data-testid="new-document"
      @click="showNewDocument = true"
    >
      {{ t(store.hasDocument ? 'toolbar.newPage' : 'toolbar.newDocument') }}
    </button>
    <NewDocumentDialog v-if="showNewDocument" @close="showNewDocument = false" />

    <div v-if="store.hasDocument" class="flex flex-wrap items-center gap-2">
      <div class="pdf-tool-group" role="group" :aria-label="t('toolbar.tools')">
        <button
          v-for="item in tools"
          :key="item.id"
          type="button"
          class="pdf-tool-button"
          :title="item.hint"
          :aria-pressed="store.tool === item.id"
          @click="chooseTool(item.id)"
        >
          {{ item.label }}
        </button>
      </div>

      <button
        type="button"
        class="tb-btn"
        :title="t('toolbar.imageHint')"
        :disabled="store.busy"
        data-testid="insert-image"
        @click="imageInput?.click()"
      >
        {{ t('toolbar.image') }}
      </button>
      <input
        ref="imageInput"
        type="file"
        :accept="IMAGE_ACCEPT"
        class="hidden"
        data-testid="image-input"
        @change="onImageChange"
      />
      <div class="flex items-center gap-1 text-sm" role="group" :aria-label="t('toolbar.history')">
        <button
          type="button"
          class="tb-btn"
          :title="t('toolbar.undoHint')"
          :aria-label="t('toolbar.undo')"
          :disabled="!store.canUndo || store.busy"
          data-testid="undo"
          @click="store.undo()"
        >
          ↶
        </button>
        <button
          type="button"
          class="tb-btn"
          :title="t('toolbar.redoHint')"
          :aria-label="t('toolbar.redo')"
          :disabled="!store.canRedo || store.busy"
          data-testid="redo"
          @click="store.redo()"
        >
          ↷
        </button>
      </div>

      <div class="flex items-center gap-1 text-sm">
        <button
          type="button"
          class="tb-btn"
          :title="t('toolbar.zoomOutHint')"
          @click="store.setZoom(store.zoom - 0.25)"
        >
          −
        </button>
        <span class="w-12 text-center tabular-nums">{{ Math.round(store.zoom * 100) }}%</span>
        <button
          type="button"
          class="tb-btn"
          :title="t('toolbar.zoomInHint')"
          @click="store.setZoom(store.zoom + 0.25)"
        >
          +
        </button>
      </div>
    </div>

    <div class="ml-auto flex flex-wrap gap-2">
      <button
        type="button"
        class="tb-btn"
        :title="t('toolbar.shortcutsHint')"
        :aria-label="t('toolbar.shortcuts')"
        data-testid="shortcut-help-button"
        @click="emit('help')"
      >
        ⌨
      </button>
      <button
        v-if="store.hasDocument"
        type="button"
        class="tb-btn"
        :disabled="store.busy"
        @click="store.reset()"
      >
        {{ t('common.close') }}
      </button>
      <button
        v-if="store.hasDocument"
        type="button"
        class="tb-btn"
        :title="t('toolbar.printHint')"
        :disabled="store.busy"
        data-testid="print"
        @click="emit('print')"
      >
        {{ t('toolbar.print') }}
      </button>
      <button
        v-if="store.hasDocument"
        type="button"
        class="tb-btn tb-primary"
        :title="t('toolbar.exportHint')"
        :disabled="store.busy"
        @click="emit('export')"
      >
        {{ store.busy ? t('toolbar.wait') : t('toolbar.export') }}
      </button>
    </div>
    <!-- Kontextzeile: Einstellungen zur Auswahl bzw. zum Werkzeug. Feste Höhe und immer
         vorhanden, damit der Editor beim Ein- und Ausblenden nicht springt. -->
    <div
      v-if="store.hasDocument"
      class="tb-context flex h-11 w-full items-center gap-2 overflow-x-auto overflow-y-hidden"
      data-testid="context-bar"
    >
      <!-- Format des ausgewählten Textes.
           data-text-style-controls: Fokus hier beendet die Textbearbeitung nicht (PageEditor). -->
      <div
        v-if="selectedText"
        class="flex items-center gap-2 text-sm"
        role="group"
        :aria-label="t('toolbar.selectedText')"
        data-text-style-controls
        data-testid="text-format"
      >
        <label class="flex items-center gap-1" :title="t('toolbar.selectedText')">
          {{ t('toolbar.selectionSize') }}
          <input
            v-model.lazy.number="selectedFontSize"
            type="number"
            min="4"
            max="200"
            step="0.5"
            class="w-16 rounded border pdf-control-border px-1 py-0.5"
            data-testid="selected-font-size"
          />
        </label>
        <select
          v-model="selectedFont"
          class="rounded border pdf-control-border px-1 py-0.5"
          :title="t('toolbar.selectionFont')"
          :aria-label="t('toolbar.selectionFont')"
          :style="{ fontFamily: CSS_FONTS[selectedFont] }"
          data-testid="selected-font"
        >
          <!-- Die Schriftauswahl zeigt jede Schrift in sich selbst, nicht in der Oberflächenschrift. -->
          <option
            v-for="f in fontOptions"
            :key="f.value"
            :value="f.value"
            :style="{ fontFamily: CSS_FONTS[f.value] }"
          >
            {{ f.label }}
          </option>
        </select>
        <div class="pdf-tool-group" role="group" :aria-label="t('toolbar.textStyle')">
          <button
            type="button"
            class="pdf-tool-button w-9 font-bold"
            :title="t('toolbar.bold')"
            :aria-label="t('toolbar.bold')"
            :aria-pressed="selectedText.bold === true"
            data-testid="text-bold"
            @click="patchSelectedText({ bold: !selectedText.bold })"
          >
            {{ t('toolbar.boldLetter') }}
          </button>
          <button
            type="button"
            class="pdf-tool-button w-9 italic"
            :title="t('toolbar.italic')"
            :aria-label="t('toolbar.italic')"
            :aria-pressed="selectedText.italic === true"
            data-testid="text-italic"
            @click="patchSelectedText({ italic: !selectedText.italic })"
          >
            {{ t('toolbar.italicLetter') }}
          </button>
        </div>
        <div class="pdf-tool-group" role="group" :aria-label="t('toolbar.align')">
          <button
            v-for="option in alignOptions"
            :key="option.value"
            type="button"
            class="pdf-tool-button grid w-9 place-items-center"
            :title="option.label"
            :aria-label="option.label"
            :aria-pressed="(selectedText.align ?? 'left') === option.value"
            :data-testid="`text-align-${option.value}`"
            @click="patchSelectedText({ align: option.value })"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">
              <rect x="1" y="2" width="14" height="1.6" />
              <rect
                :x="option.value === 'left' ? 1 : option.value === 'center' ? 4 : 7"
                y="5.5"
                width="8"
                height="1.6"
              />
              <rect x="1" y="9" width="14" height="1.6" />
              <rect
                :x="option.value === 'left' ? 1 : option.value === 'center' ? 4 : 7"
                y="12.5"
                width="8"
                height="1.6"
              />
            </svg>
          </button>
        </div>
        <input
          v-model="selectedColor"
          type="color"
          class="h-7 w-8"
          :title="t('toolbar.selectionTextColor')"
          :aria-label="t('toolbar.selectionTextColor')"
          data-testid="selected-text-color"
        />
      </div>

      <!-- Position (X/Y) der Auswahl: erscheint nur, solange ein Text oder Bild ausgewählt ist. -->
      <div
        v-if="selectedPositioned"
        class="flex items-center gap-2 text-sm"
        role="group"
        :aria-label="t('toolbar.position')"
        :title="t('toolbar.positionHint')"
        data-text-style-controls
        data-testid="position-controls"
      >
        <label class="flex items-center gap-1">
          X
          <input
            v-model.number="selectedX"
            type="number"
            min="0"
            step="1"
            class="w-16 rounded border pdf-control-border px-1 py-0.5"
            :aria-label="t('toolbar.positionX')"
            data-testid="position-x"
          />
        </label>
        <label class="flex items-center gap-1">
          Y
          <input
            v-model.number="selectedY"
            type="number"
            min="0"
            step="1"
            class="w-16 rounded border pdf-control-border px-1 py-0.5"
            :aria-label="t('toolbar.positionY')"
            data-testid="position-y"
          />
        </label>
        <span class="pdf-control-muted">mm</span>
      </div>

      <button
        v-if="store.selectedAnnotation"
        type="button"
        class="tb-btn pdf-control-error"
        :title="t('toolbar.deleteHint')"
        data-testid="delete-annotation"
        @click="store.removeSelectedAnnotation()"
      >
        {{ deleteLabel }}
      </button>

      <label v-if="!selectedText && store.tool === 'text'" class="flex items-center gap-1 text-sm">
        {{ t('toolbar.size') }}
        <input
          v-model.number="store.fontSize"
          type="number"
          min="6"
          max="96"
          class="w-16 rounded border pdf-control-border px-1 py-0.5"
        />
        <input
          v-model="store.textColor"
          type="color"
          class="h-7 w-8"
          :title="t('toolbar.textColor')"
        />
      </label>
      <label
        v-if="store.tool === 'highlight' || selectedHighlight"
        class="flex items-center gap-1 text-sm"
      >
        {{ selectedHighlight ? t('toolbar.selectionColor') : t('toolbar.color') }}
        <input
          v-model="highlightColor"
          type="color"
          class="h-7 w-8"
          :title="
            selectedHighlight ? t('toolbar.selectedHighlightColor') : t('toolbar.highlightColor')
          "
          data-testid="highlight-color"
        />
      </label>
      <div
        v-if="store.tool === 'cover'"
        class="flex items-center gap-1 text-sm"
        :title="t('toolbar.coverHint')"
      >
        <button
          v-for="p in coverPresets"
          :key="p.color"
          type="button"
          class="tb-btn"
          :class="{ 'ring-2 pdf-control-accent-ring': store.coverColor === p.color }"
          @click="store.coverColor = p.color"
        >
          {{ p.label }}
        </button>
        <input
          v-model="store.coverColor"
          type="color"
          class="h-7 w-8"
          :title="t('toolbar.coverColor')"
        />
        <span class="text-xs pdf-control-warning">{{ t('toolbar.coverNote') }}</span>
      </div>
      <div
        v-if="isPrivate && (store.tool === 'redact' || selectedRedaction)"
        class="flex items-center gap-1 text-sm"
        title="Text, Grafik, Bildpixel, Kommentare und Formularfelder unter der Fläche werden beim Export entfernt; Metadaten ebenfalls."
        data-testid="redact-colors"
      >
        <button
          v-for="p in redactPresets"
          :key="p.color"
          type="button"
          class="tb-btn"
          :class="{ 'ring-2 pdf-control-accent-ring': redactColor === p.color }"
          @click="redactColor = p.color"
        >
          {{ p.label }}
        </button>
        <input v-model="redactColor" type="color" class="h-7 w-8" title="Farbe der Schwärzung" />
        <span class="text-xs pdf-control-error">echt – wirkt beim Export</span>
      </div>
      <button
        v-if="store.tool === 'signature'"
        type="button"
        class="tb-btn"
        :title="t('toolbar.signatureNewHint')"
        @click="emit('editSignature')"
      >
        {{ t('toolbar.signatureNew') }}
      </button>

      <span v-if="contextEmpty" class="text-sm pdf-control-muted" data-testid="context-hint">
        {{ t('toolbar.contextHint') }}
      </span>
    </div>
  </div>
</template>

<style scoped>
@reference 'tailwindcss';

.tb-btn {
  @apply rounded-md border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50;
}

/* Kontextzeile: einzeilig, schmale Fenster scrollen waagrecht statt umzubrechen. */
.tb-context > * {
  @apply shrink-0 whitespace-nowrap;
}
.tb-context .pdf-tool-group {
  @apply flex-nowrap;
}
</style>
