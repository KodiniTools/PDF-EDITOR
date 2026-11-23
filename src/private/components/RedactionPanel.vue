<script setup lang="ts">
/** Seitenleiste „KI-Schwärzung“ (nur privater Build). */
import { computed, ref, watch } from 'vue'

import { CATEGORY_LABELS } from '@/private/suggestions/categories'
import { useRedactionStore } from '@/private/stores/redaction'
import { useDocumentStore } from '@/stores/document'

const doc = useDocumentStore()
const redaction = useRedactionStore()
const notice = ref<string | null>(null)

/** Vorschläge gruppiert nach Seitenposition. */
const groups = computed(() => {
  const byPage = new Map<string, typeof redaction.valid>()
  for (const s of redaction.valid) {
    const list = byPage.get(s.pageId) ?? []
    list.push(s)
    byPage.set(s.pageId, list)
  }
  return doc.pages
    .map((p, index) => ({ page: p, number: index + 1, items: byPage.get(p.id) ?? [] }))
    .filter((g) => g.items.length > 0)
})

const allSelected = computed(
  () => redaction.valid.length > 0 && redaction.selectedCount === redaction.valid.length,
)

watch(
  () => doc.hasDocument,
  (has) => {
    if (!has) redaction.clear()
  },
)

async function analyze(scope: 'page' | 'all'): Promise<void> {
  notice.value = null
  await redaction.analyze(scope)
  if (redaction.status === 'done' && redaction.valid.length === 0) {
    notice.value = 'Keine sensiblen Daten gefunden.'
  }
}

function apply(): void {
  const n = redaction.applySelected()
  notice.value =
    n > 0 ? `${n} Schwärzung${n === 1 ? '' : 'en'} angelegt. Wirksam beim Export.` : null
}
</script>

<template>
  <section
    class="flex min-h-0 flex-1 flex-col"
    aria-label="KI-Schwärzung"
    data-testid="redaction-panel"
  >
    <div class="border-b pdf-control-border p-3">
      <p class="text-xs pdf-control-muted">
        Der Text der Seiten (bei Scans das Seitenbild) wird zur Analyse an Claude (Anthropic)
        gesendet. Vorschläge prüfen, dann übernehmen.
      </p>
      <div class="mt-2 flex gap-2">
        <button
          type="button"
          class="pn-btn"
          :disabled="redaction.busy || !doc.selectedPage"
          title="Aktuelle Seite prüfen (Strg+Enter)"
          data-shortcut="primary"
          @click="analyze('page')"
        >
          Diese Seite
        </button>
        <button
          type="button"
          class="pn-btn pn-primary"
          :disabled="redaction.busy || !doc.hasDocument"
          data-testid="analyze-all"
          title="Alle Seiten prüfen (Strg+Umschalt+Enter)"
          data-shortcut="secondary"
          @click="analyze('all')"
        >
          Alle Seiten
        </button>
      </div>
      <label class="mt-2 flex items-center gap-2 text-xs pdf-control-muted">
        <input v-model="redaction.readScans" type="checkbox" :disabled="redaction.busy" />
        Gescannte Seiten per Bilderkennung lesen
      </label>
      <div v-if="redaction.busy" class="mt-2 flex items-center justify-between pdf-control-info">
        <span>
          {{ redaction.phase === 'ocr' ? 'Lese Scans…' : 'Analysiere…' }}
          <template v-if="redaction.progress.total > 1 || redaction.phase === 'ocr'">
            ({{ redaction.progress.done }}/{{ redaction.progress.total }})
          </template>
        </span>
        <button type="button" class="underline" @click="redaction.cancel()">Abbrechen</button>
      </div>
      <p v-if="redaction.error" role="alert" class="mt-2 pdf-control-error">
        {{ redaction.error }}
      </p>
      <p v-if="notice" class="mt-2 pdf-control-success" role="status">{{ notice }}</p>
      <p v-if="redaction.ocrPages > 0" class="mt-2 text-xs pdf-control-muted">
        {{ redaction.ocrPages }} gescannte Seite(n) per Bilderkennung gelesen. Die Flächen sind dort
        ungenauer – bitte prüfen und bei Bedarf anpassen.
      </p>
      <p v-if="redaction.ocrError" class="mt-2 text-xs pdf-control-warning">
        Bilderkennung teilweise fehlgeschlagen: {{ redaction.ocrError }}
      </p>
      <p v-if="redaction.pagesWithoutText > 0" class="mt-2 text-xs pdf-control-warning">
        {{ redaction.pagesWithoutText }} Seite(n) ohne erkennbaren Text – dort bitte manuell
        schwärzen.
      </p>
      <p v-if="redaction.truncatedPages > 0" class="mt-2 text-xs pdf-control-warning">
        {{ redaction.truncatedPages }} Seite(n) waren zu lang und wurden nur teilweise geprüft.
      </p>
    </div>

    <div class="min-h-0 flex-1 overflow-auto p-2">
      <section v-for="g in groups" :key="g.page.id" class="mb-3">
        <button
          type="button"
          class="mb-1 text-xs font-medium pdf-control-muted hover:underline"
          @click="doc.selectPage(g.page.id)"
        >
          Seite {{ g.number }}
        </button>
        <ul class="space-y-1">
          <li
            v-for="s in g.items"
            :key="s.id"
            class="flex items-start gap-2 rounded px-1 py-1"
            data-testid="suggestion-item"
          >
            <input
              type="checkbox"
              class="mt-0.5"
              :checked="s.selected"
              :aria-label="`${s.text} schwärzen`"
              @change="redaction.toggle(s.id)"
            />
            <button
              type="button"
              class="min-w-0 flex-1 text-left"
              :title="s.reason"
              @click="doc.selectPage(s.pageId)"
            >
              <span class="block truncate font-medium">{{ s.text }}</span>
              <span class="block text-xs pdf-control-muted">
                {{ CATEGORY_LABELS[s.category] }}
                <template v-if="s.rects.length > 1"> · {{ s.rects.length }}×</template>
              </span>
            </button>
            <button
              type="button"
              class="pdf-control-muted pdf-control-text-hover"
              :aria-label="`Vorschlag ${s.text} verwerfen`"
              @click="redaction.dismiss(s.id)"
            >
              ✕
            </button>
          </li>
        </ul>
      </section>
      <p v-if="groups.length === 0 && !redaction.busy" class="p-2 text-xs pdf-control-muted">
        Noch keine Vorschläge. Manuell schwärzen: Werkzeug „Schwärzen“ (R).
      </p>
    </div>

    <div v-if="redaction.valid.length > 0" class="flex gap-2 border-t pdf-control-border p-3">
      <button type="button" class="pn-btn" @click="redaction.selectAll(!allSelected)">
        {{ allSelected ? 'Keine' : 'Alle' }}
      </button>
      <button
        type="button"
        class="pn-btn pn-danger flex-1"
        :disabled="redaction.selectedCount === 0"
        data-testid="apply-suggestions"
        title="Ausgewählte Vorschläge übernehmen (Strg+Alt+Enter)"
        data-shortcut="apply"
        @click="apply"
      >
        {{ redaction.selectedCount }} schwärzen
      </button>
    </div>
  </section>
</template>

<style scoped>
@reference 'tailwindcss';

.pn-btn {
  @apply rounded-md border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50;
}
</style>
