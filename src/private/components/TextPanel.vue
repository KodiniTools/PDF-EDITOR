<script setup lang="ts">
/**
 * Reiter „Text“ der privaten Seitenleiste: den auf der Seite ausgewählten, eingefügten
 * Text in Ruhe bearbeiten und mit KI umschreiben (Korrigieren, Kürzen, förmlicher/
 * einfacher, übersetzen). Das KI-Ergebnis erscheint als Vorschau und wird erst per
 * „Übernehmen“ eingesetzt (ein Undo-Schritt). Auf der Seite selbst liegt nichts mehr.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { displaySize, normalizeRotation } from '@/lib/geometry'
import { reflowText } from '@/lib/textLayout'
import { unwrapSoft } from '@/lib/textWrap'
import {
  LANGUAGE_LABELS,
  MAX_REWRITE_LENGTH,
  MODE_LABELS,
  requestRewrite,
  type RewriteLanguage,
  type RewriteMode,
} from '@/private/rewrite/api'
import { unsupportedChars } from '@/private/rewrite/winAnsi'
import { SuggestApiError } from '@/private/suggestions/api'
import { useDocumentStore } from '@/stores/document'
import type { TextAnnotation } from '@/types/pdf'

const store = useDocumentStore()

/** Auf der aktuellen Seite ausgewählter Text. */
const annotation = computed<TextAnnotation | null>(() => {
  const a = store.selectedAnnotation
  return a?.kind === 'text' ? a : null
})

const pageWidth = computed(() => {
  const page = store.selectedPage
  if (!page) return 0
  return displaySize(page.box, normalizeRotation(page.baseRotation + page.rotation)).width
})

/** Text ohne die automatischen Umbrüche des Editors (so wird er bearbeitet und gesendet). */
const sourceText = computed(() => {
  const a = annotation.value
  return a ? unwrapSoft(a.text, a.softBreaks ?? []) : ''
})

const busy = ref(false)
const error = ref<string | null>(null)
const result = ref<{ text: string; source: string } | null>(null)
let controller: AbortController | null = null
/** Undo-Gruppe der laufenden Bearbeitung im Feld (Tippen = ein Schritt). */
let editGroup: string | null = null

const LANGUAGE_KEY = 'pdf-editor-privat:zielsprache'
function storedLanguage(): RewriteLanguage {
  try {
    const v = localStorage.getItem(LANGUAGE_KEY)
    if (v && v in LANGUAGE_LABELS) return v as RewriteLanguage
  } catch {
    // ohne Speicher: Standard
  }
  return 'en'
}
/** Zielsprache; die letzte Wahl wird gemerkt. */
const language = ref<RewriteLanguage>(storedLanguage())
watch(language, (code) => {
  try {
    localStorage.setItem(LANGUAGE_KEY, code)
  } catch {
    // ohne Speicher: gilt bis zum Neuladen
  }
})

const MODES = Object.entries(MODE_LABELS) as [Exclude<RewriteMode, 'translate'>, string][]
const LANGUAGES = Object.entries(LANGUAGE_LABELS) as [RewriteLanguage, string][]

const tooLong = computed(() => sourceText.value.length > MAX_REWRITE_LENGTH)
const canRun = computed(() => !busy.value && !tooLong.value && sourceText.value.trim() !== '')
const unsupported = computed(() => (result.value ? unsupportedChars(result.value.text) : []))

/** Setzt den Text der Annotation und bricht ihn am Seitenrand um. */
function setText(a: TextAnnotation, text: string, group?: string): void {
  const page = store.selectedPage
  if (!page) return
  const r = reflowText(a, { pageWidth: pageWidth.value, text, softBreaks: [] })
  store.updateAnnotation(
    page.id,
    a.id,
    r ? { text: r.text, softBreaks: r.softBreaks } : { text },
    group,
  )
}

function onInput(e: Event): void {
  const a = annotation.value
  if (!a) return
  editGroup ??= store.newGroup('edit')
  setText(a, (e.target as HTMLTextAreaElement).value, editGroup)
}

/** Bearbeitung beendet: Undo-Schritt abschließen; ein geleerter Text wird entfernt. */
function onBlur(): void {
  const a = annotation.value
  const page = store.selectedPage
  if (a && page && a.text.trim() === '') {
    store.removeAnnotation(page.id, a.id, editGroup ?? undefined)
  }
  editGroup = null
  store.closeHistoryGroup()
}

function cancel(): void {
  controller?.abort()
  controller = null
  busy.value = false
}

async function run(mode: RewriteMode): Promise<void> {
  const a = annotation.value
  if (!a || !canRun.value) return
  const source = sourceText.value
  cancel()
  controller = new AbortController()
  const { signal } = controller
  busy.value = true
  error.value = null
  result.value = null
  try {
    const text = await requestRewrite(
      {
        text: source,
        mode,
        ...(mode === 'translate' ? { language: language.value } : {}),
        singleLine: a.replacesKey !== undefined,
      },
      signal,
    )
    if (signal.aborted) return
    result.value = { text, source }
  } catch (err) {
    if (signal.aborted) return
    console.error('[pdf-editor] Umschreiben fehlgeschlagen', err)
    error.value = err instanceof SuggestApiError ? err.message : 'Umschreiben fehlgeschlagen.'
  } finally {
    if (controller?.signal === signal) {
      controller = null
      busy.value = false
    }
  }
}

function apply(): void {
  const a = annotation.value
  if (!a || !result.value) return
  // Eigener Undo-Schritt, getrennt von einer laufenden Bearbeitung im Feld.
  editGroup = null
  store.closeHistoryGroup()
  setText(a, result.value.text)
  store.closeHistoryGroup()
  result.value = null
}

// Anderer Text ausgewählt → laufende Anfrage und Vorschau gehören nicht mehr dazu.
watch(
  () => annotation.value?.id,
  () => {
    cancel()
    result.value = null
    error.value = null
    editGroup = null
  },
)

/**
 * Kürzel, auch während getippt wird: Alt+1–4 Modi, Alt+5 Übersetzen, Alt+Enter
 * übernehmen, Alt+⌫ verwerfen/abbrechen. e.code, weil Alt+Ziffer auf dem Mac
 * Sonderzeichen liefert.
 */
function onKey(e: KeyboardEvent): void {
  if (!annotation.value) return
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
  const modeIndex = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code)
  if (modeIndex >= 0) {
    const mode = MODES[modeIndex]?.[0]
    if (mode) void run(mode)
  } else if (e.code === 'Digit5') {
    void run('translate')
  } else if (e.key === 'Enter') {
    apply()
  } else if (e.key === 'Backspace') {
    if (busy.value) cancel()
    else result.value = null
  } else {
    return
  }
  e.preventDefault()
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  cancel()
})
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col overflow-auto p-3" data-testid="text-panel">
    <p v-if="!annotation" class="pdf-control-muted" data-testid="text-panel-empty">
      Kein Text ausgewählt. Einen eingefügten Text auf der Seite anklicken (Werkzeug „Verschieben“
      oder „Text“), dann lässt er sich hier bearbeiten und mit KI umschreiben.
    </p>

    <template v-else>
      <label class="flex flex-col gap-1">
        <span>Ausgewählter Text</span>
        <textarea
          :value="sourceText"
          rows="8"
          class="resize-y rounded-md border pdf-control-border px-2 py-1.5"
          data-testid="text-panel-input"
          @input="onInput"
          @blur="onBlur"
        ></textarea>
      </label>
      <p class="mt-1 text-xs pdf-control-muted">
        Der Text wird auf der Seite automatisch am rechten Rand umbrochen. Enter setzt einen festen
        Umbruch.
      </p>
      <p v-if="tooLong" class="mt-1 pdf-control-warning">
        Text zu lang für die KI (höchstens {{ MAX_REWRITE_LENGTH }} Zeichen).
      </p>

      <h3 class="mt-4">Mit KI umschreiben</h3>
      <p class="mt-1 text-xs pdf-control-muted">
        Der Text wird dafür an Claude (Anthropic) gesendet.
      </p>
      <div class="mt-2 grid grid-cols-2 gap-2">
        <button
          v-for="([mode, label], index) in MODES"
          :key="mode"
          type="button"
          class="pn-btn"
          :disabled="!canRun"
          :data-testid="`assist-${mode}`"
          :title="`${label} (Alt+${index + 1})`"
          @click="run(mode)"
        >
          {{ label }}
        </button>
      </div>
      <div class="mt-2 flex gap-2">
        <select
          v-model="language"
          class="min-w-0 flex-1 rounded-md border pdf-control-border px-2 py-1.5"
          aria-label="Zielsprache"
          :disabled="busy"
          data-testid="assist-language"
        >
          <option v-for="[code, label] in LANGUAGES" :key="code" :value="code">
            {{ label }}
          </option>
        </select>
        <button
          type="button"
          class="pn-btn"
          :disabled="!canRun"
          data-testid="assist-translate"
          title="Übersetzen (Alt+5)"
          @click="run('translate')"
        >
          Übersetzen
        </button>
      </div>

      <div v-if="busy" class="mt-3 flex items-center justify-between gap-3 pdf-control-info">
        <span>Claude formuliert…</span>
        <button type="button" class="underline" @click="cancel">Abbrechen</button>
      </div>
      <p v-if="error" role="alert" class="mt-3 pdf-control-error">{{ error }}</p>

      <div v-if="result" class="mt-3 border-t pdf-control-border pt-3">
        <h3>Vorschlag</h3>
        <p
          class="mt-1 max-h-60 overflow-auto rounded-md pdf-control-raised px-2 py-1.5 whitespace-pre-wrap"
          data-testid="assist-result"
        >
          {{ result.text }}
        </p>
        <p v-if="unsupported.length > 0" class="mt-1 pdf-control-warning">
          Nicht in der PDF-Schrift enthalten, wird im Export zu „?“: {{ unsupported.join(' ') }}
        </p>
        <p v-if="result.source !== sourceText" class="mt-1 pdf-control-warning">
          Der Text wurde inzwischen geändert – Übernehmen ersetzt ihn trotzdem.
        </p>
        <div class="mt-2 flex justify-end gap-2">
          <button type="button" class="pn-btn" title="Verwerfen (Alt+⌫)" @click="result = null">
            Verwerfen
          </button>
          <button
            type="button"
            class="pn-btn pn-primary"
            data-shortcut="apply"
            data-testid="assist-apply"
            title="Übernehmen (Alt+Enter)"
            @click="apply"
          >
            Übernehmen
          </button>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
@reference 'tailwindcss';

.pn-btn {
  @apply rounded-md border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50;
}
</style>
