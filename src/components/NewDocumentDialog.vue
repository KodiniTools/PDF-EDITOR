<script setup lang="ts">
/**
 * Dialog „Neues Dokument“ (öffentliche Variante, ohne KI): leere Seiten im gewählten
 * Format. Das PDF entsteht lokal und wird wie eine geöffnete Datei geladen; ist schon
 * ein Dokument offen, werden die Seiten angehängt (per Rückgängig entfernbar).
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useI18n } from '@/i18n'
import type { MessageKey } from '@/i18n/locales/de'
import { createBlankPdf, isValidPageCount, MAX_BLANK_PAGES } from '@/lib/blankDocument'
import { PAGE_FORMATS, type Orientation, type PageFormat } from '@/lib/pageFormats'
import { useDocumentStore } from '@/stores/document'

const emit = defineEmits<{ close: [] }>()

const store = useDocumentStore()
const { t } = useI18n()

const FORMAT_KEYS: Record<PageFormat, MessageKey> = {
  A4: 'newDoc.format.A4',
  A5: 'newDoc.format.A5',
  A3: 'newDoc.format.A3',
  Letter: 'newDoc.format.Letter',
  Legal: 'newDoc.format.Legal',
}

const format = ref<PageFormat>('A4')
const orientation = ref<Orientation>('portrait')
const pages = ref<number | string>(1)
const creating = ref(false)
const error = ref<string | null>(null)

/** Beim Öffnen festgehalten: Mit offenem Dokument werden Seiten angehängt („Neue Seite“). */
const appending = store.hasDocument

const busy = computed(() => creating.value || store.busy)
const canCreate = computed(() => !busy.value && isValidPageCount(pages.value))

async function create(): Promise<void> {
  const count = pages.value
  if (!canCreate.value || !isValidPageCount(count)) return
  creating.value = true
  error.value = null
  try {
    const title = t('newDoc.fileName')
    const bytes = await createBlankPdf(
      { format: format.value, orientation: orientation.value, pages: count },
      title,
    )
    const file = new File([bytes as BlobPart], `${title}.pdf`, { type: 'application/pdf' })
    const before = store.pages.length
    const result = await store.addFiles([file])
    if (result.added === 0) {
      error.value = result.errors.join('\n') || t('newDoc.failed')
      // Die Meldung steht im Dialog; das Banner dahinter wäre doppelt.
      store.error = null
      return
    }
    // Erste neue Seite anzeigen (auch wenn schon ein Dokument offen war).
    const first = store.pages[before]
    if (first) store.selectPage(first.id)
    emit('close')
  } catch (err) {
    console.error('[pdf-editor] Neues Dokument', err)
    error.value = t('newDoc.failed')
  } finally {
    creating.value = false
  }
}

function close(): void {
  if (!creating.value) emit('close')
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    close()
    return
  }
  if (e.key !== 'Enter' || e.altKey) return
  // Enter auf einem fokussierten Button löst dessen eigene Aktion aus.
  if ((e.target as HTMLElement | null)?.tagName === 'BUTTON') return
  e.preventDefault()
  void create()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="fixed inset-0 z-50 grid place-items-center pdf-control-scrim p-4" @click.self="close">
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-doc-title"
      class="w-full max-w-md rounded-xl pdf-control-dialog pdf-control-surface p-5 text-sm shadow-xl"
      data-testid="new-document-dialog"
    >
      <h2 id="new-doc-title" class="text-base">
        {{ t(appending ? 'newDoc.titleAppend' : 'newDoc.title') }}
      </h2>
      <p class="mt-1 pdf-control-muted">{{ t('newDoc.intro') }}</p>

      <div class="mt-4 grid grid-cols-2 gap-3">
        <label class="flex flex-col gap-1">
          <span class="pdf-control-muted">{{ t('newDoc.format') }}</span>
          <select
            v-model="format"
            class="rounded-md border pdf-control-border px-2 py-1.5"
            data-testid="new-doc-format"
          >
            <option v-for="f in PAGE_FORMATS" :key="f" :value="f">{{ t(FORMAT_KEYS[f]) }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1">
          <span class="pdf-control-muted">{{ t('newDoc.pages') }}</span>
          <input
            v-model.number="pages"
            type="number"
            min="1"
            :max="MAX_BLANK_PAGES"
            step="1"
            class="rounded-md border pdf-control-border px-2 py-1.5"
            data-testid="new-doc-pages"
          />
        </label>
      </div>

      <fieldset class="mt-4">
        <legend class="pdf-control-muted">{{ t('newDoc.orientation') }}</legend>
        <div class="mt-1 flex gap-4">
          <label class="flex cursor-pointer items-center gap-1">
            <input
              v-model="orientation"
              type="radio"
              value="portrait"
              data-testid="new-doc-portrait"
            />
            {{ t('newDoc.portrait') }}
          </label>
          <label class="flex cursor-pointer items-center gap-1">
            <input
              v-model="orientation"
              type="radio"
              value="landscape"
              data-testid="new-doc-landscape"
            />
            {{ t('newDoc.landscape') }}
          </label>
        </div>
      </fieldset>

      <p v-if="!isValidPageCount(pages)" class="mt-3 pdf-control-error" data-testid="new-doc-range">
        {{ t('newDoc.pagesRange', { max: MAX_BLANK_PAGES }) }}
      </p>
      <p v-if="appending" class="mt-3 text-xs pdf-control-muted">
        {{ t('newDoc.appendNote') }}
      </p>
      <p v-if="error" role="alert" class="mt-3 whitespace-pre-line pdf-control-error">
        {{ error }}
      </p>

      <div class="mt-5 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-md border pdf-control-border px-3 py-1.5 pdf-control-hover disabled:opacity-50"
          :disabled="creating"
          @click="close"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          type="button"
          class="rounded-md pdf-control-primary px-3 py-1.5 disabled:opacity-50"
          :disabled="!canCreate"
          data-testid="new-doc-create"
          @click="create"
        >
          {{ creating ? t('newDoc.creating') : t('newDoc.create') }}
        </button>
      </div>
    </div>
  </div>
</template>
