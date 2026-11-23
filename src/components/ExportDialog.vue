<script setup lang="ts">
/**
 * Dialog vor Export bzw. Druck: alle Seiten, nur die in der Seitenleiste markierten
 * oder nur die aktuelle Seite. Die Auswahl gilt nur für die Ausgabe; das Dokument im
 * Editor bleibt unverändert. Gedruckt wird die exportierte PDF (mit allen Änderungen).
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { downloadBytes } from '@/lib/file'
import { formatPageRanges } from '@/lib/pageRanges'
import { printImages, renderForPrint } from '@/lib/print'
import { useDocumentStore } from '@/stores/document'

type Scope = 'all' | 'marked' | 'current'

const props = withDefaults(defineProps<{ mode?: 'export' | 'print' }>(), { mode: 'export' })
const emit = defineEmits<{ close: [] }>()
const printing = ref(false)
const busy = computed(() => store.busy || printing.value)
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

const buttonLabel = computed(() => {
  if (printing.value || (store.busy && props.mode === 'print')) return 'Bereite Druck vor…'
  if (store.busy) return 'Exportiere…'
  const pages = `${count.value} ${count.value === 1 ? 'Seite' : 'Seiten'}`
  return props.mode === 'print' ? `${pages} drucken` : `${pages} exportieren`
})

async function run(): Promise<void> {
  if (busy.value || count.value === 0) return
  let bytes: Uint8Array
  try {
    bytes = await store.exportDocument(pageIds.value)
  } catch {
    // Meldung steht in store.error (Banner); Dialog schließen, damit sie sichtbar ist.
    emit('close')
    return
  }
  if (props.mode === 'export') {
    downloadBytes(bytes, fileName.value)
    emit('close')
    return
  }
  printing.value = true
  try {
    const urls = await renderForPrint(bytes)
    emit('close')
    await printImages(urls)
  } catch (err) {
    console.error('[pdf-editor] Drucken fehlgeschlagen', err)
    store.error = 'Drucken fehlgeschlagen. Alternativ exportieren und die PDF drucken.'
    emit('close')
  } finally {
    printing.value = false
  }
}

const SCOPE_KEYS: Record<string, Scope> = { '1': 'all', '2': 'marked', '3': 'current' }

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && !busy.value) {
    emit('close')
    return
  }
  if (e.ctrlKey || e.metaKey || e.altKey || busy.value) return
  if (e.key === 'Enter') {
    // Enter auf einem fokussierten Button löst dessen eigene Aktion aus.
    if ((e.target as HTMLElement | null)?.tagName === 'BUTTON') return
    e.preventDefault()
    void run()
    return
  }
  const next = SCOPE_KEYS[e.key]
  if (next === 'marked' && store.markedPages.length === 0) return
  if (next === 'current' && !store.selectedPage) return
  if (next) scope.value = next
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div
    class="fixed inset-0 z-50 grid place-items-center pdf-control-scrim p-4"
    @click.self="!busy && emit('close')"
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-title"
      class="w-full max-w-md rounded-xl pdf-control-dialog pdf-control-surface p-5 text-sm shadow-xl"
      data-testid="export-dialog"
    >
      <h2 id="export-title" class="text-base font-semibold">
        {{ mode === 'print' ? 'Drucken' : 'Exportieren' }}
      </h2>
      <p class="mt-1 pdf-control-muted">
        Welche Seiten sollen {{ mode === 'print' ? 'gedruckt werden' : 'in die PDF-Datei' }}?
      </p>

      <fieldset class="mt-4 space-y-2">
        <legend class="sr-only">Seiten</legend>
        <label class="flex cursor-pointer items-start gap-2">
          <input v-model="scope" type="radio" value="all" class="mt-0.5" data-testid="export-all" />
          <span
            >Alle Seiten <span class="pdf-control-muted">({{ store.pages.length }})</span></span
          >
        </label>
        <label
          class="flex items-start gap-2"
          :class="
            store.markedPages.length ? 'cursor-pointer' : 'cursor-not-allowed pdf-control-muted'
          "
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
            <span v-if="store.markedPages.length" class="pdf-control-muted">
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
            <span class="pdf-control-muted">(Seite {{ store.selectedPageIndex + 1 }})</span>
          </span>
        </label>
      </fieldset>

      <p v-if="mode === 'export'" class="mt-4 text-xs break-all pdf-control-muted">
        Datei: {{ fileName }}
      </p>
      <p v-else class="mt-4 text-xs pdf-control-muted">
        Gedruckt wird mit allen Änderungen. Drucker, Papierformat und Ausrichtung wählst du danach
        im Druckdialog des Browsers.
      </p>

      <div class="mt-5 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-md border pdf-control-border px-3 py-1.5 pdf-control-hover disabled:opacity-50"
          :disabled="busy"
          @click="emit('close')"
        >
          Abbrechen
        </button>
        <button
          type="button"
          class="rounded-md pdf-control-primary px-3 py-1.5 disabled:opacity-50"
          :disabled="busy || count === 0"
          data-testid="export-confirm"
          @click="run"
        >
          {{ buttonLabel }}
        </button>
      </div>
    </div>
  </div>
</template>
