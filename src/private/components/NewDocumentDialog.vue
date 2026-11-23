<script setup lang="ts">
/**
 * Dialog „Neues Dokument“: Format, Ausrichtung und optional eine Beschreibung,
 * aus der Claude (im gewählten Modell) den Inhalt erzeugt. Ohne Beschreibung
 * entstehen leere Seiten – lokal, ohne KI-Anfrage.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useDocumentStore } from '@/stores/document'

import { MAX_PROMPT_LENGTH } from '../generate/api'
import { MAX_EMPTY_PAGES } from '../generate/render'
import { FORMAT_LABELS, PAGE_FORMATS, type Orientation, type PageFormat } from '../generate/types'
import { modelLabel } from '../models'
import { LANGUAGE_LABELS, type RewriteLanguage } from '../rewrite/api'
import { useGenerateStore } from '../stores/generate'
import { useModelStore } from '../stores/model'

const emit = defineEmits<{ close: [] }>()

const doc = useDocumentStore()
const gen = useGenerateStore()
const models = useModelStore()

/** Beim Öffnen festgehalten: Mit offenem Dokument werden Seiten angehängt („Neue Seite“). */
const appending = doc.hasDocument

const format = ref<PageFormat>('A4')
const orientation = ref<Orientation>('portrait')
const pages = ref(1)
const language = ref<RewriteLanguage>('de')
const prompt = ref('')

const useAi = computed(() => prompt.value.trim().length > 0)
const tooLong = computed(() => prompt.value.length > MAX_PROMPT_LENGTH)
const canCreate = computed(
  () =>
    !gen.busy &&
    !tooLong.value &&
    (useAi.value ||
      (Number.isInteger(pages.value) && pages.value >= 1 && pages.value <= MAX_EMPTY_PAGES)),
)

const EXAMPLES = [
  'Leere Rechnungsvorlage mit Platzhaltern für Absender, Empfänger, Positionstabelle und Summen',
  'Anmeldeformular für einen Workshop mit Feldern für Name, Kontakt und Unterschrift',
  'Einseitiges Besprechungsprotokoll mit Tabelle für Aufgaben, Verantwortliche und Termine',
]

async function create(): Promise<void> {
  if (!canCreate.value) return
  const ok = useAi.value
    ? await gen.createWithAi({
        prompt: prompt.value.trim(),
        format: format.value,
        orientation: orientation.value,
        language: language.value,
      })
    : await gen.createEmpty({
        format: format.value,
        orientation: orientation.value,
        pages: pages.value,
      })
  if (ok) emit('close')
}

function close(): void {
  gen.cancel()
  gen.error = null
  emit('close')
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') close()
  else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    void create()
  }
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
      class="w-full max-w-lg rounded-xl pdf-control-dialog pdf-control-surface p-5 text-sm shadow-xl"
      data-testid="new-document-dialog"
    >
      <h2 id="new-doc-title" class="text-base font-semibold">
        {{ appending ? 'Neue Seite' : 'Neues Dokument' }}
      </h2>
      <p v-if="appending" class="mt-1 text-xs pdf-control-muted" data-testid="new-doc-append-note">
        Die neuen Seiten werden an das geöffnete Dokument angehängt.
      </p>

      <div class="mt-4 grid grid-cols-2 gap-3">
        <label class="flex flex-col gap-1">
          <span class="pdf-control-muted">Format</span>
          <select
            v-model="format"
            class="rounded-md border pdf-control-border px-2 py-1.5"
            data-testid="new-doc-format"
          >
            <option v-for="f in PAGE_FORMATS" :key="f" :value="f">{{ FORMAT_LABELS[f] }}</option>
          </select>
        </label>
        <fieldset class="flex flex-col gap-1">
          <legend class="mb-1 pdf-control-muted">Ausrichtung</legend>
          <div class="flex gap-3 py-1.5">
            <label class="flex items-center gap-1">
              <input v-model="orientation" type="radio" value="portrait" /> Hoch
            </label>
            <label class="flex items-center gap-1">
              <input
                v-model="orientation"
                type="radio"
                value="landscape"
                data-testid="new-doc-landscape"
              />
              Quer
            </label>
          </div>
        </fieldset>
      </div>

      <label class="mt-4 flex flex-col gap-1">
        <span class="pdf-control-muted">
          Inhalt mit KI (optional) – leer lassen für leere Seiten
        </span>
        <textarea
          v-model="prompt"
          rows="4"
          :maxlength="MAX_PROMPT_LENGTH + 1"
          class="rounded-md border pdf-control-border px-2 py-1.5"
          placeholder="z. B. Leere Rechnungsvorlage mit Positionstabelle"
          data-testid="new-doc-prompt"
        ></textarea>
      </label>
      <p v-if="tooLong" class="mt-1 pdf-control-error">
        Höchstens {{ MAX_PROMPT_LENGTH }} Zeichen.
      </p>
      <div v-if="!prompt" class="mt-2 flex flex-wrap gap-1">
        <button
          v-for="ex in EXAMPLES"
          :key="ex"
          type="button"
          class="rounded-full pdf-control-raised px-2 py-0.5 text-xs pdf-control-muted pdf-control-hover"
          :title="ex"
          @click="prompt = ex"
        >
          {{ ex.split(' mit ')[0] }}
        </button>
      </div>

      <div class="mt-4 grid grid-cols-2 gap-3">
        <label v-if="useAi" class="flex flex-col gap-1">
          <span class="pdf-control-muted">Sprache</span>
          <select
            v-model="language"
            class="rounded-md border pdf-control-border px-2 py-1.5"
            data-testid="new-doc-language"
          >
            <option v-for="(label, id) in LANGUAGE_LABELS" :key="id" :value="id">
              {{ label }}
            </option>
          </select>
        </label>
        <label v-else class="flex flex-col gap-1">
          <span class="pdf-control-muted">Seiten</span>
          <input
            v-model.number="pages"
            type="number"
            min="1"
            :max="MAX_EMPTY_PAGES"
            class="rounded-md border pdf-control-border px-2 py-1.5"
            data-testid="new-doc-pages"
          />
        </label>
        <div v-if="useAi" class="flex flex-col gap-1">
          <span class="pdf-control-muted">Modell (Abrechnung)</span>
          <span class="py-1.5 font-medium" data-testid="new-doc-model">
            {{ modelLabel(models.selected) }}
          </span>
        </div>
      </div>

      <p v-if="doc.hasDocument" class="mt-3 pdf-control-muted">
        Die neuen Seiten werden an das geöffnete Dokument angehängt.
      </p>
      <p v-if="useAi" class="mt-1 pdf-control-muted">
        Die Beschreibung wird an Claude gesendet; der Text wird mit Standardschrift gesetzt und
        lässt sich danach wie gewohnt bearbeiten.
      </p>
      <p v-if="gen.error" role="alert" class="mt-3 whitespace-pre-line pdf-control-error">
        {{ gen.error }}
      </p>

      <div class="mt-5 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-md border pdf-control-border px-3 py-1.5 pdf-control-hover"
          @click="close"
        >
          {{ gen.busy ? 'Abbrechen' : 'Schließen' }}
        </button>
        <button
          type="button"
          class="rounded-md pdf-control-primary px-3 py-1.5 disabled:opacity-50"
          :disabled="!canCreate"
          data-testid="new-doc-create"
          title="Erstellen (Strg+Enter)"
          @click="create"
        >
          <template v-if="gen.busy">{{ useAi ? 'Claude schreibt…' : 'Erstelle…' }}</template>
          <template v-else>{{ useAi ? 'Mit KI erstellen' : 'Leer erstellen' }}</template>
        </button>
      </div>
    </div>
  </div>
</template>
