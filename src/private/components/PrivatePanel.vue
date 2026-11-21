<script setup lang="ts">
/** Rechte Seitenleiste des privaten Builds: KI-Schwärzung und Fragen zum Dokument. */
import { ref } from 'vue'

import AskPanel from './AskPanel.vue'
import FormPanel from './FormPanel.vue'
import RedactionPanel from './RedactionPanel.vue'

type Tab = 'redact' | 'ask' | 'form'
const TABS: { id: Tab; label: string }[] = [
  { id: 'redact', label: 'Schwärzen' },
  { id: 'ask', label: 'Fragen' },
  { id: 'form', label: 'Formular' },
]
const tab = ref<Tab>('redact')
</script>

<template>
  <aside
    class="flex w-80 shrink-0 flex-col border-l border-gray-200 bg-white text-sm"
    aria-label="KI-Werkzeuge"
  >
    <div role="tablist" class="flex border-b border-gray-200">
      <button
        v-for="t in TABS"
        :id="`private-tab-${t.id}`"
        :key="t.id"
        type="button"
        role="tab"
        :aria-selected="tab === t.id"
        :aria-controls="`private-panel-${t.id}`"
        class="flex-1 px-3 py-2 font-medium"
        :class="
          tab === t.id
            ? 'border-b-2 border-blue-600 text-blue-700'
            : 'text-gray-500 hover:text-gray-800'
        "
        :data-testid="`private-tab-${t.id}`"
        @click="tab = t.id"
      >
        {{ t.label }}
      </button>
    </div>
    <!-- v-show: Zustand (laufende Analyse, Eingabe) bleibt beim Tabwechsel erhalten. -->
    <div
      v-show="tab === 'redact'"
      id="private-panel-redact"
      role="tabpanel"
      aria-labelledby="private-tab-redact"
      class="flex min-h-0 flex-1 flex-col"
    >
      <RedactionPanel />
    </div>
    <div
      v-show="tab === 'ask'"
      id="private-panel-ask"
      role="tabpanel"
      aria-labelledby="private-tab-ask"
      class="flex min-h-0 flex-1 flex-col"
    >
      <AskPanel />
    </div>
    <div
      v-show="tab === 'form'"
      id="private-panel-form"
      role="tabpanel"
      aria-labelledby="private-tab-form"
      class="flex min-h-0 flex-1 flex-col"
    >
      <FormPanel />
    </div>
  </aside>
</template>
