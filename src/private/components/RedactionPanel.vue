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
    <div class="border-b border-gray-200 p-3">
      <p class="text-xs text-gray-500">
        Der Text der Seiten wird zur Analyse an Claude (Anthropic) gesendet. Vorschläge prüfen, dann
        übernehmen.
      </p>
      <div class="mt-2 flex gap-2">
        <button
          type="button"
          class="pn-btn"
          :disabled="redaction.busy || !doc.selectedPage"
          @click="analyze('page')"
        >
          Diese Seite
        </button>
        <button
          type="button"
          class="pn-btn pn-primary"
          :disabled="redaction.busy || !doc.hasDocument"
          data-testid="analyze-all"
          @click="analyze('all')"
        >
          Alle Seiten
        </button>
      </div>
      <div v-if="redaction.busy" class="mt-2 flex items-center justify-between text-blue-700">
        <span>
          Analysiere…
          <template v-if="redaction.progress.total > 1">
            ({{ redaction.progress.done }}/{{ redaction.progress.total }})
          </template>
        </span>
        <button type="button" class="underline" @click="redaction.cancel()">Abbrechen</button>
      </div>
      <p v-if="redaction.error" role="alert" class="mt-2 text-red-700">{{ redaction.error }}</p>
      <p v-if="notice" class="mt-2 text-green-700" role="status">{{ notice }}</p>
      <p v-if="redaction.pagesWithoutText > 0" class="mt-2 text-xs text-amber-700">
        {{ redaction.pagesWithoutText }} Seite(n) ohne erkennbaren Text (z. B. Scan) – dort bitte
        manuell schwärzen.
      </p>
      <p v-if="redaction.truncatedPages > 0" class="mt-2 text-xs text-amber-700">
        {{ redaction.truncatedPages }} Seite(n) waren zu lang und wurden nur teilweise geprüft.
      </p>
    </div>

    <div class="min-h-0 flex-1 overflow-auto p-2">
      <section v-for="g in groups" :key="g.page.id" class="mb-3">
        <button
          type="button"
          class="mb-1 text-xs font-medium text-gray-500 hover:underline"
          @click="doc.selectPage(g.page.id)"
        >
          Seite {{ g.number }}
        </button>
        <ul class="space-y-1">
          <li
            v-for="s in g.items"
            :key="s.id"
            class="flex items-start gap-2 rounded px-1 py-1 hover:bg-gray-50"
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
              <span class="block text-xs text-gray-500">
                {{ CATEGORY_LABELS[s.category] }}
                <template v-if="s.rects.length > 1"> · {{ s.rects.length }}×</template>
              </span>
            </button>
            <button
              type="button"
              class="text-gray-400 hover:text-gray-700"
              :aria-label="`Vorschlag ${s.text} verwerfen`"
              @click="redaction.dismiss(s.id)"
            >
              ✕
            </button>
          </li>
        </ul>
      </section>
      <p v-if="groups.length === 0 && !redaction.busy" class="p-2 text-xs text-gray-500">
        Noch keine Vorschläge. Manuell schwärzen: Werkzeug „Schwärzen“ (R).
      </p>
    </div>

    <div v-if="redaction.valid.length > 0" class="flex gap-2 border-t border-gray-200 p-3">
      <button type="button" class="pn-btn" @click="redaction.selectAll(!allSelected)">
        {{ allSelected ? 'Keine' : 'Alle' }}
      </button>
      <button
        type="button"
        class="pn-btn pn-danger flex-1"
        :disabled="redaction.selectedCount === 0"
        data-testid="apply-suggestions"
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
  @apply rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50;
}
.pn-primary {
  @apply border-blue-600 bg-blue-600 text-white hover:bg-blue-700;
}
.pn-danger {
  @apply border-gray-900 bg-gray-900 text-white hover:bg-black;
}
</style>
