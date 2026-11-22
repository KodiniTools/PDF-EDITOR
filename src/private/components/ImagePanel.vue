<script setup lang="ts">
/**
 * Reiter „Bilder“ (privater Build): Bilder der aktuellen Seite finden (eingebettet:
 * ohne KI; Scans/Logos/Stempel: mit Claude), dann löschen oder ersetzen.
 */
import { computed, ref, watch } from 'vue'

import { IMAGE_ACCEPT } from '@/lib/image'
import { useDocumentStore } from '@/stores/document'

import { KIND_LABELS } from '../images/detect'
import { modelLabel } from '../models'
import { useImagesStore, type ImageItem } from '../stores/images'
import { useModelStore } from '../stores/model'

/** Nur wenn der Reiter sichtbar ist, automatisch suchen (lädt MuPDF). */
const props = defineProps<{ active: boolean }>()

const doc = useDocumentStore()
const images = useImagesStore()
const models = useModelStore()
const fileInput = ref<HTMLInputElement | null>(null)
const replacing = ref<ImageItem | null>(null)

const page = computed(() => doc.selectedPage)
const list = computed(() => (page.value ? images.forPage(page.value.id) : []))
const scanned = computed(() => !!page.value && images.scanned.includes(page.value.id))
const onlyFullPage = computed(
  () => list.value.length > 0 && list.value.every((i) => i.source === 'pdf' && i.fullPage),
)

// Seite wechseln/drehen: automatisch (ohne KI, ohne Kosten) nach eingebetteten Bildern suchen.
watch(
  () => [props.active, page.value?.id, page.value?.rotation] as const,
  ([active, id], old) => {
    if (id && old && old[1] === id && old[2] !== page.value?.rotation) images.forget(id)
    if (active && page.value && !scanned.value) void images.scan(page.value)
  },
  { immediate: true },
)

watch(
  () => doc.hasDocument,
  (has) => {
    if (!has) images.clear()
  },
)

function size(i: ImageItem): string {
  return `${Math.round(i.rect.width)} × ${Math.round(i.rect.height)} pt`
}

function remove(i: ImageItem): void {
  if (page.value) images.remove(page.value, i)
}

function pickReplacement(i: ImageItem): void {
  replacing.value = i
  fileInput.value?.click()
}

async function onFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const target = replacing.value
  replacing.value = null
  if (file && target && page.value) await images.replace(page.value, target, file)
}
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col" data-testid="image-panel">
    <div class="space-y-2 border-b border-gray-200 p-3">
      <p class="text-gray-600">
        Eingebettete Bilder der Seite werden automatisch gefunden. Für Scans, Logos, Stempel und
        Unterschriften: „Mit KI suchen“ (Seitenbild an Claude,
        {{ modelLabel(models.selected) }}).
      </p>
      <div class="flex gap-2">
        <button
          type="button"
          class="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-100 disabled:opacity-50"
          :disabled="!page || !!images.busy"
          data-testid="images-scan"
          title="Neu suchen (Strg+Umschalt+Enter)"
          data-shortcut="secondary"
          @click="page && images.scan(page)"
        >
          Neu suchen
        </button>
        <button
          type="button"
          class="rounded-md bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50"
          :disabled="!page || !!images.busy"
          data-testid="images-ai"
          title="Mit KI suchen (Strg+Enter)"
          data-shortcut="primary"
          @click="page && images.scanWithAi(page)"
        >
          Mit KI suchen
        </button>
      </div>
      <p v-if="images.busy === 'ai'" class="flex items-center justify-between text-blue-700">
        <span>Claude sucht Bildbereiche…</span>
        <button type="button" class="underline" @click="images.cancel()">Abbrechen</button>
      </p>
      <p v-else-if="images.busy === 'pdf'" class="text-blue-700">Suche Bilder…</p>
      <p v-if="images.error" role="alert" class="text-red-700">{{ images.error }}</p>
    </div>

    <div class="min-h-0 flex-1 overflow-auto p-3">
      <p v-if="scanned && list.length === 0 && !images.busy" class="text-gray-500">
        Keine Bilder auf dieser Seite gefunden.
      </p>
      <p v-if="onlyFullPage" class="mb-2 text-amber-700">
        Die Seite ist ein ganzseitiges Bild (Scan). Für einzelne Bereiche darin „Mit KI suchen“.
      </p>
      <ul class="space-y-2">
        <li
          v-for="(i, n) in list"
          :key="i.id"
          class="rounded-md border p-2"
          :class="images.hoverId === i.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'"
          data-testid="image-item"
          @mouseenter="images.hoverId = i.id"
          @mouseleave="images.hoverId = null"
        >
          <div class="flex items-baseline justify-between gap-2">
            <span class="font-medium">
              {{ n + 1 }}. {{ i.fullPage ? 'Ganzseitiges Bild' : KIND_LABELS[i.kind] }}
            </span>
            <span class="text-xs text-gray-500">{{ i.source === 'ai' ? 'KI' : 'PDF' }}</span>
          </div>
          <p class="text-xs text-gray-600">{{ i.label }} · {{ size(i) }}</p>
          <div class="mt-2 flex gap-2">
            <button
              type="button"
              class="rounded border border-red-300 px-2 py-0.5 text-red-700 hover:bg-red-50"
              data-testid="image-remove"
              @click="remove(i)"
            >
              Löschen
            </button>
            <button
              type="button"
              class="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-100"
              data-testid="image-replace"
              @click="pickReplacement(i)"
            >
              Ersetzen…
            </button>
          </div>
        </li>
      </ul>
      <p v-if="list.length > 0" class="mt-3 text-xs text-gray-500">
        Gelöschte Bereiche erscheinen weiß und werden beim Export echt entfernt. Rückgängig (Strg+Z)
        stellt sie wieder her.
        <template v-if="list.some((i) => i.source === 'ai')">
          KI-Bereiche sind Schätzungen; die weiße Fläche lässt sich wie jede Schwärzung verschieben
          und in der Größe ändern.
        </template>
      </p>
      <input
        ref="fileInput"
        type="file"
        :accept="IMAGE_ACCEPT"
        class="hidden"
        data-testid="image-replace-input"
        @change="onFile"
      />
    </div>
  </section>
</template>
