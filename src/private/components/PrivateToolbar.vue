<script setup lang="ts">
/**
 * Toolbar-Ergänzung des privaten Builds: „Neues Dokument“ und die Modellauswahl
 * für alle KI-Funktionen samt Anzeige des zuletzt abgerechneten Modells.
 */
import { computed, onMounted, ref } from 'vue'

import { formatUsd, MODEL_INFO, modelLabel } from '../models'
import { useModelStore } from '../stores/model'
import NewDocumentDialog from './NewDocumentDialog.vue'

const models = useModelStore()
const showNew = ref(false)

onMounted(() => void models.loadAvailable())

const usageTitle = computed(() => {
  const l = models.last
  if (!l) return 'Noch keine KI-Anfrage'
  const fmt = (n: number) => n.toLocaleString('de-DE')
  return [
    `Letzte Anfrage abgerechnet über: ${modelLabel(l.model)} (${l.model})`,
    `Eingabe: ${fmt(l.inputTokens)} Tokens, Ausgabe: ${fmt(l.outputTokens)} Tokens`,
    l.cost === null ? 'Kosten: unbekannt' : `Kosten ca. ${formatUsd(l.cost)} (Listenpreis)`,
    `Seit Seitenaufruf: ${models.requests} Anfragen, ca. ${formatUsd(models.sessionCost)}`,
  ].join('\n')
})
</script>

<template>
  <div class="flex items-center gap-2 text-sm">
    <button
      type="button"
      class="rounded-md border border-gray-300 bg-white px-3 py-1.5 hover:bg-gray-100"
      data-testid="new-document"
      @click="showNew = true"
    >
      Neues Dokument
    </button>
    <label class="flex items-center gap-1 text-gray-600" title="Modell für alle KI-Funktionen">
      <span class="hidden lg:inline">KI-Modell</span>
      <select
        v-model="models.selected"
        class="rounded-md border border-gray-300 bg-white px-2 py-1.5"
        data-testid="model-select"
      >
        <option v-for="id in models.available" :key="id" :value="id">
          {{ modelLabel(id) }}{{ MODEL_INFO[id] ? ` – ${MODEL_INFO[id]?.hint}` : '' }}
        </option>
      </select>
    </label>
    <span
      v-if="models.last"
      class="rounded px-1.5 py-0.5 text-xs tabular-nums whitespace-pre"
      :class="models.mismatch ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'"
      :title="usageTitle"
      data-testid="model-usage"
    >
      {{ modelLabel(models.last.model) }} ·
      {{ models.last.cost === null ? '?' : formatUsd(models.last.cost) }}
    </span>
    <NewDocumentDialog v-if="showNew" @close="showNew = false" />
  </div>
</template>
