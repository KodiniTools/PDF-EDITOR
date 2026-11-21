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
const language = ref<RewriteLanguage>('en')
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
        <select
          v-model="language"
          class="rounded border border-gray-300 px-1 py-0.5"
          aria-label="Zielsprache"
          :disabled="busy"
        >
          <option v-for="[code, label] in LANGUAGES" :key="code" :value="code">{{ label }}</option>
        </select>
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
