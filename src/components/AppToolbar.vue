<script setup lang="ts">
import { ref } from 'vue'

import { useDocumentStore } from '@/stores/document'
import type { Tool } from '@/types/pdf'

const emit = defineEmits<{
  openFiles: [files: File[]]
  export: []
  editSignature: []
}>()

const store = useDocumentStore()
const fileInput = ref<HTMLInputElement | null>(null)

const tools: { id: Tool; label: string; hint: string }[] = [
  { id: 'select', label: 'Auswählen', hint: 'Annotationen verschieben (V)' },
  { id: 'text', label: 'Text', hint: 'Klicken, um Text einzufügen (T)' },
  { id: 'highlight', label: 'Markieren', hint: 'Bereich aufziehen (H)' },
  { id: 'signature', label: 'Signatur', hint: 'Klicken, um Signatur zu platzieren (S)' },
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
    <h1 class="mr-2 font-semibold text-gray-800">PDF-Editor</h1>

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

      <label v-if="store.tool === 'text'" class="flex items-center gap-1 text-sm">
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
      <button
        v-if="store.tool === 'signature'"
        type="button"
        class="tb-btn"
        @click="emit('editSignature')"
      >
        Signatur neu
      </button>

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
