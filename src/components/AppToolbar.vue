<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'

import { IMAGE_ACCEPT, readImageFile } from '@/lib/image'
import { useDocumentStore } from '@/stores/document'
import type { FontFamily, Tool } from '@/types/pdf'

const emit = defineEmits<{
  openFiles: [files: File[]]
  export: []
  editSignature: []
}>()

const store = useDocumentStore()
const isPrivate = __PRIVATE__
/** „Neues Dokument“ + KI-Modellauswahl – nur im privaten Build. */
const PrivateToolbar = __PRIVATE__
  ? defineAsyncComponent(() => import('@/private/components/PrivateToolbar.vue'))
  : null
const fileInput = ref<HTMLInputElement | null>(null)
const imageInput = ref<HTMLInputElement | null>(null)

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
      err instanceof Error && err.name === 'ImageError'
        ? err.message
        : 'Das Bild konnte nicht eingefügt werden.'
  }
}

const deleteLabel = computed(() => {
  switch (store.selectedAnnotation?.kind) {
    case 'image':
      return 'Bild löschen'
    case 'text':
      return 'Text löschen'
    default:
      return 'Löschen'
  }
})

const tools: { id: Tool; label: string; hint: string }[] = [
  { id: 'select', label: 'Auswählen', hint: 'Annotationen verschieben (V)' },
  {
    id: 'edit-text',
    label: 'Text bearbeiten',
    hint: 'Vorhandene Textzeile anklicken, um sie zu ändern (E)',
  },
  { id: 'text', label: 'Text', hint: 'Klicken, um Text einzufügen (T)' },
  { id: 'highlight', label: 'Markieren', hint: 'Bereich aufziehen (H)' },
  { id: 'cover', label: 'Abdecken', hint: 'Bereich weiß/schwarz abdecken (A)' },
  ...(__PRIVATE__
    ? [
        {
          id: 'redact' as const,
          label: 'Schwärzen',
          hint: 'Bereich aufziehen: Inhalt wird beim Export dauerhaft entfernt (R)',
        },
      ]
    : []),
  { id: 'signature', label: 'Signatur', hint: 'Klicken, um Signatur zu platzieren (S)' },
]

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

const fontOptions: { value: FontFamily; label: string }[] = [
  { value: 'sans', label: 'Helvetica' },
  { value: 'serif', label: 'Times' },
  { value: 'mono', label: 'Courier' },
]

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

const coverPresets = [
  { color: '#ffffff', label: 'Weiß' },
  { color: '#000000', label: 'Schwarz' },
]

function onFileChange(e: Event): void {
  const input = e.target as HTMLInputElement
  const files = input.files ? Array.from(input.files) : []
  input.value = '' // gleiche Datei erneut wählbar
  if (files.length > 0) emit('openFiles', files)
}

function chooseTool(id: Tool): void {
  store.setTool(id)
  if (id === 'signature' && !store.signatureDataUrl) emit('editSignature')
}
</script>

<template>
  <header class="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
    <h1 class="mr-2 font-semibold text-gray-800">
      PDF-Editor<span v-if="isPrivate" class="ml-1 text-xs font-normal text-red-700">privat</span>
    </h1>

    <button
      type="button"
      class="tb-btn tb-primary"
      :disabled="store.busy"
      @click="fileInput?.click()"
    >
      {{ store.hasDocument ? 'PDF hinzufügen' : 'PDF öffnen' }}
    </button>
    <input
      ref="fileInput"
      type="file"
      accept="application/pdf,.pdf"
      multiple
      class="hidden"
      data-testid="file-input"
      @change="onFileChange"
    />
    <component :is="PrivateToolbar" v-if="PrivateToolbar" />

    <div v-if="store.hasDocument" class="flex flex-wrap items-center gap-2">
      <div
        class="flex overflow-hidden rounded-md border border-gray-300"
        role="group"
        aria-label="Werkzeuge"
      >
        <button
          v-for="t in tools"
          :key="t.id"
          type="button"
          class="px-3 py-1.5 text-sm"
          :class="store.tool === t.id ? 'bg-blue-600 text-white' : 'bg-white hover:bg-gray-100'"
          :title="t.hint"
          :aria-pressed="store.tool === t.id"
          @click="chooseTool(t.id)"
        >
          {{ t.label }}
        </button>
      </div>

      <button
        type="button"
        class="tb-btn"
        title="Bild (PNG, JPEG, WebP, GIF) auf der aktuellen Seite einfügen"
        :disabled="store.busy"
        data-testid="insert-image"
        @click="imageInput?.click()"
      >
        Bild
      </button>
      <input
        ref="imageInput"
        type="file"
        :accept="IMAGE_ACCEPT"
        class="hidden"
        data-testid="image-input"
        @change="onImageChange"
      />
      <button
        v-if="store.selectedAnnotation"
        type="button"
        class="tb-btn text-red-700"
        title="Ausgewähltes Element löschen (Entf)"
        data-testid="delete-annotation"
        @click="store.removeSelectedAnnotation()"
      >
        {{ deleteLabel }}
      </button>

      <label v-if="selectedText" class="flex items-center gap-1 text-sm" title="Ausgewählter Text">
        Auswahl: Größe
        <input
          v-model.lazy.number="selectedFontSize"
          type="number"
          min="4"
          max="200"
          step="0.5"
          class="w-16 rounded border border-gray-300 px-1 py-0.5"
          data-testid="selected-font-size"
        />
        <select
          v-model="selectedFont"
          class="rounded border border-gray-300 px-1 py-0.5"
          title="Schrift der Auswahl"
        >
          <option v-for="f in fontOptions" :key="f.value" :value="f.value">{{ f.label }}</option>
        </select>
        <input v-model="selectedColor" type="color" class="h-7 w-8" title="Textfarbe der Auswahl" />
      </label>
      <label v-else-if="store.tool === 'text'" class="flex items-center gap-1 text-sm">
        Größe
        <input
          v-model.number="store.fontSize"
          type="number"
          min="6"
          max="96"
          class="w-16 rounded border border-gray-300 px-1 py-0.5"
        />
        <input v-model="store.textColor" type="color" class="h-7 w-8" title="Textfarbe" />
      </label>
      <label v-if="store.tool === 'highlight'" class="flex items-center gap-1 text-sm">
        Farbe
        <input v-model="store.highlightColor" type="color" class="h-7 w-8" title="Markierfarbe" />
      </label>
      <div
        v-if="store.tool === 'cover'"
        class="flex items-center gap-1 text-sm"
        title="Deckt nur optisch ab: der Inhalt darunter bleibt in der PDF auslesbar."
      >
        <button
          v-for="p in coverPresets"
          :key="p.color"
          type="button"
          class="tb-btn"
          :class="{ 'ring-2 ring-blue-500': store.coverColor === p.color }"
          @click="store.coverColor = p.color"
        >
          {{ p.label }}
        </button>
        <input v-model="store.coverColor" type="color" class="h-7 w-8" title="Abdeckfarbe" />
        <span class="text-xs text-amber-700">nur optisch</span>
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
          :class="{ 'ring-2 ring-blue-500': redactColor === p.color }"
          @click="redactColor = p.color"
        >
          {{ p.label }}
        </button>
        <input v-model="redactColor" type="color" class="h-7 w-8" title="Farbe der Schwärzung" />
        <span class="text-xs text-red-700">echt – wirkt beim Export</span>
      </div>
      <button
        v-if="store.tool === 'signature'"
        type="button"
        class="tb-btn"
        @click="emit('editSignature')"
      >
        Signatur neu
      </button>

      <div class="flex items-center gap-1 text-sm" role="group" aria-label="Verlauf">
        <button
          type="button"
          class="tb-btn"
          title="Rückgängig (Strg+Z)"
          aria-label="Rückgängig"
          :disabled="!store.canUndo || store.busy"
          data-testid="undo"
          @click="store.undo()"
        >
          ↶
        </button>
        <button
          type="button"
          class="tb-btn"
          title="Wiederholen (Strg+Y / Strg+Umschalt+Z)"
          aria-label="Wiederholen"
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
          title="Verkleinern"
          @click="store.setZoom(store.zoom - 0.25)"
        >
          −
        </button>
        <span class="w-12 text-center tabular-nums">{{ Math.round(store.zoom * 100) }}%</span>
        <button
          type="button"
          class="tb-btn"
          title="Vergrößern"
          @click="store.setZoom(store.zoom + 0.25)"
        >
          +
        </button>
      </div>
    </div>

    <div class="ml-auto flex gap-2">
      <button
        v-if="store.hasDocument"
        type="button"
        class="tb-btn"
        :disabled="store.busy"
        @click="store.reset()"
      >
        Schließen
      </button>
      <button
        v-if="store.hasDocument"
        type="button"
        class="tb-btn tb-primary"
        :disabled="store.busy"
        @click="emit('export')"
      >
        {{ store.busy ? 'Bitte warten…' : 'Exportieren' }}
      </button>
    </div>
  </header>
</template>

<style scoped>
@reference 'tailwindcss';

.tb-btn {
  @apply rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50;
}
.tb-primary {
  @apply border-blue-600 bg-blue-600 text-white hover:bg-blue-700;
}
</style>
