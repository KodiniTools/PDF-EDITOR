<script setup lang="ts">
/**
 * KI-Leiste unter einem ausgewählten Textfeld (nur privater Build): Korrigieren,
 * Kürzen, förmlicher/einfacher formulieren, übersetzen. Das Ergebnis erscheint als
 * Vorschau und wird erst per „Übernehmen“ eingesetzt (ein Undo-Schritt).
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { TEXT_LINE_HEIGHT } from '@/lib/geometry'
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

const props = defineProps<{ pageId: string; annotation: TextAnnotation; zoom: number }>()

const store = useDocumentStore()
const busy = ref(false)
const error = ref<string | null>(null)
const result = ref<{ text: string; source: string } | null>(null)
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
const languageMenu = ref(false)
function chooseLanguage(code: RewriteLanguage): void {
  language.value = code
  languageMenu.value = false
  try {
    localStorage.setItem(LANGUAGE_KEY, code)
  } catch {
    // ohne Speicher: gilt bis zum Neuladen
  }
}
let controller: AbortController | null = null

const MODES = Object.entries(MODE_LABELS) as [Exclude<RewriteMode, 'translate'>, string][]
const LANGUAGES = Object.entries(LANGUAGE_LABELS) as [RewriteLanguage, string][]

const style = computed(() => {
  const a = props.annotation
  const lines = Math.max(1, a.text.split('\n').length)
  return {
    left: `${a.x * props.zoom}px`,
    top: `${(a.y + a.fontSize * TEXT_LINE_HEIGHT * lines) * props.zoom + 6}px`,
  }
})

const tooLong = computed(() => props.annotation.text.length > MAX_REWRITE_LENGTH)
const unsupported = computed(() => (result.value ? unsupportedChars(result.value.text) : []))

function cancel(): void {
  controller?.abort()
  controller = null
  busy.value = false
}

async function run(mode: RewriteMode): Promise<void> {
  const source = props.annotation.text
  if (!source.trim() || tooLong.value) return
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
        singleLine: props.annotation.replacesKey !== undefined,
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
  if (!result.value) return
  store.updateAnnotation(props.pageId, props.annotation.id, { text: result.value.text })
  store.closeHistoryGroup()
  result.value = null
}

// Anderes Textfeld ausgewählt → laufende Anfrage und Vorschau gehören nicht mehr dazu.
watch(
  () => props.annotation.id,
  () => {
    cancel()
    result.value = null
    error.value = null
    languageMenu.value = false
  },
)
onBeforeUnmount(cancel)
</script>

<template>
  <div
    class="absolute z-20 w-max max-w-[22rem] rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-800 shadow-lg"
    :style="style"
    data-testid="text-assist"
    @pointerdown.stop
    @mousedown.prevent
    @dblclick.stop
  >
    <div class="flex flex-wrap items-center gap-1">
      <span class="mr-1 font-medium text-gray-500">KI:</span>
      <button
        v-for="[mode, label] in MODES"
        :key="mode"
        type="button"
        class="ta-btn"
        :disabled="busy || tooLong || !annotation.text.trim()"
        :data-testid="`assist-${mode}`"
        @click="run(mode)"
      >
        {{ label }}
      </button>
      <span class="ml-1 flex items-center gap-1">
        <!-- Eigene Liste statt <select>: Ein natives Aufklappmenü nimmt dem Textfeld
             den Fokus; je nach Browser schließt es sich dann sofort wieder. -->
        <span class="relative">
          <button
            type="button"
            class="ta-btn"
            aria-label="Zielsprache"
            aria-haspopup="listbox"
            :aria-expanded="languageMenu"
            :disabled="busy"
            data-testid="assist-language"
            @click="languageMenu = !languageMenu"
          >
            {{ LANGUAGE_LABELS[language] }} ▾
          </button>
          <span
            v-if="languageMenu"
            role="listbox"
            aria-label="Zielsprache"
            class="absolute top-full left-0 z-30 mt-1 flex w-max flex-col rounded border border-gray-200 bg-white py-1 shadow-lg"
          >
            <button
              v-for="[code, label] in LANGUAGES"
              :key="code"
              type="button"
              role="option"
              :aria-selected="code === language"
              class="px-3 py-1 text-left hover:bg-gray-100"
              :class="code === language ? 'font-semibold text-blue-700' : ''"
              :data-testid="`assist-language-${code}`"
              @click="chooseLanguage(code)"
            >
              {{ label }}
            </button>
          </span>
        </span>
        <button
          type="button"
          class="ta-btn"
          :disabled="busy || tooLong || !annotation.text.trim()"
          data-testid="assist-translate"
          @click="run('translate')"
        >
          Übersetzen
        </button>
      </span>
    </div>

    <p v-if="tooLong" class="mt-1 text-amber-700">
      Text zu lang (höchstens {{ MAX_REWRITE_LENGTH }} Zeichen).
    </p>
    <div v-if="busy" class="mt-2 flex items-center justify-between gap-3 text-blue-700">
      <span>Claude formuliert…</span>
      <button type="button" class="underline" @click="cancel">Abbrechen</button>
    </div>
    <p v-if="error" role="alert" class="mt-2 text-red-700">{{ error }}</p>

    <div v-if="result" class="mt-2 border-t border-gray-200 pt-2">
      <p class="max-h-40 overflow-auto whitespace-pre-wrap" data-testid="assist-result">
        {{ result.text }}
      </p>
      <p v-if="unsupported.length > 0" class="mt-1 text-amber-700">
        Nicht in der PDF-Schrift enthalten, wird im Export zu „?“: {{ unsupported.join(' ') }}
      </p>
      <p v-if="result.source !== annotation.text" class="mt-1 text-amber-700">
        Der Text wurde inzwischen geändert – Übernehmen ersetzt ihn trotzdem.
      </p>
      <div class="mt-2 flex justify-end gap-2">
        <button type="button" class="ta-btn" @click="result = null">Verwerfen</button>
        <button type="button" class="ta-btn ta-primary" data-testid="assist-apply" @click="apply">
          Übernehmen
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference 'tailwindcss';

.ta-btn {
  @apply rounded border border-gray-300 bg-white px-2 py-0.5 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50;
}
.ta-primary {
  @apply border-blue-600 bg-blue-600 text-white hover:bg-blue-700;
}
</style>
