<script setup lang="ts">
/**
 * Dialog vor dem Export: alle Seiten, nur die in der Seitenleiste markierten oder
 * nur die aktuelle Seite. Die Auswahl gilt nur für die exportierte Datei; das
 * Dokument im Editor bleibt unverändert.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { downloadBytes } from '@/lib/file'
import { formatPageRanges } from '@/lib/pageRanges'
import { useDocumentStore } from '@/stores/document'

type Scope = 'all' | 'marked' | 'current'

const emit = defineEmits<{ close: [] }>()
const store = useDocumentStore()

const markedNumbers = computed(() => store.markedPages.map((p) => store.pages.indexOf(p) + 1))
const scope = ref<Scope>(store.markedPages.length > 0 ? 'marked' : 'all')

const pageIds = computed<string[] | undefined>(() => {
  switch (scope.value) {
    case 'all':
      return undefined
    case 'marked':
      return store.markedPages.map((p) => p.id)
    case 'current':
      return store.selectedPage ? [store.selectedPage.id] : []
    default: {
      const never: never = scope.value
      return never
    }
  }
})
const count = computed(() => pageIds.value?.length ?? store.pages.length)

const fileName = computed(() => {
  const base = store.suggestedFileName.replace(/\.pdf$/i, '')
  if (scope.value === 'all') return `${base}.pdf`
  const numbers = scope.value === 'marked' ? markedNumbers.value : [store.selectedPageIndex + 1]
  return `${base}-seite-${formatPageRanges(numbers).replace(/, /g, '_').replace(/–/g, '-')}.pdf`
})

async function run(): Promise<void> {
  if (store.busy || count.value === 0) return
  try {
    const bytes = await store.exportDocument(pageIds.value)
    downloadBytes(bytes, fileName.value)
    emit('close')
  } catch {
    // Meldung steht in store.error (Banner); Dialog schließen, damit sie sichtbar ist.
    emit('close')
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && !store.busy) emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div
    class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
    @click.self="!store.busy && emit('close')"
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-title"
      class="w-full max-w-md rounded-xl bg-white p-5 text-sm shadow-xl"
      data-testid="export-dialog"
    >
      <h2 id="export-title" class="text-base font-semibold">Exportieren</h2>
      <p class="mt-1 text-gray-600">Welche Seiten sollen in die PDF-Datei?</p>

      <fieldset class="mt-4 space-y-2">
        <legend class="sr-only">Seiten</legend>
        <label class="flex cursor-pointer items-start gap-2">
          <input v-model="scope" type="radio" value="all" class="mt-0.5" data-testid="export-all" />
          <span
            >Alle Seiten <span class="text-gray-500">({{ store.pages.length }})</span></span
          >
        </label>
        <label
          class="flex items-start gap-2"
          :class="store.markedPages.length ? 'cursor-pointer' : 'cursor-not-allowed text-gray-400'"
        >
          <input
            v-model="scope"
            type="radio"
            value="marked"
            class="mt-0.5"
            :disabled="store.markedPages.length === 0"
            data-testid="export-marked"
          />
          <span>
            Nur markierte Seiten
            <span v-if="store.markedPages.length" class="text-gray-500">
              (Seite {{ formatPageRanges(markedNumbers) }})
            </span>
            <span v-else class="block text-xs">
              Keine markiert. Seiten in der Seitenleiste per Häkchen markieren.
            </span>
          </span>
        </label>
        <label class="flex cursor-pointer items-start gap-2">
          <input
            v-model="scope"
            type="radio"
            value="current"
            class="mt-0.5"
            :disabled="!store.selectedPage"
            data-testid="export-current"
          />
          <span>
            Nur aktuelle Seite
            <span class="text-gray-500">(Seite {{ store.selectedPageIndex + 1 }})</span>
          </span>
        </label>
      </fieldset>

      <p class="mt-4 text-xs break-all text-gray-500">Datei: {{ fileName }}</p>

      <div class="mt-5 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-100 disabled:opacity-50"
          :disabled="store.busy"
          @click="emit('close')"
        >
          Abbrechen
        </button>
        <button
          type="button"
          class="rounded-md bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50"
          :disabled="store.busy || count === 0"
          data-testid="export-confirm"
          @click="run"
        >
          {{
            store.busy ? 'Exportiere…' : `${count} ${count === 1 ? 'Seite' : 'Seiten'} exportieren`
          }}
        </button>
      </div>
    </div>
  </div>
</template>
