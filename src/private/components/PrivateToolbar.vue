<script setup lang="ts">
/**
 * Toolbar-Ergänzung des privaten Builds: „Neues Dokument“ und die Modellauswahl
 * für alle KI-Funktionen samt Anzeige des zuletzt abgerechneten Modells.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { isPlainKey } from '@/lib/shortcuts'
import { useDocumentStore } from '@/stores/document'

import { formatUsd, MODEL_INFO, modelLabel } from '../models'
import { useCostStore } from '../stores/costs'
import { useModelStore } from '../stores/model'
import CostDialog from './CostDialog.vue'
import NewDocumentDialog from './NewDocumentDialog.vue'

const doc = useDocumentStore()
const models = useModelStore()
const costs = useCostStore()
const showNew = ref(false)
const showCosts = ref(false)

/** N: Neues Dokument, K: Kosten (nicht in Eingabefeldern oder offenen Dialogen). */
function onShortcut(e: KeyboardEvent): void {
  if (!isPlainKey(e) || e.shiftKey) return
  const key = e.key.toLowerCase()
  if (key === 'n') showNew.value = true
  else if (key === 'k') showCosts.value = true
  else return
  e.preventDefault()
}

/** Zurück im Tab: Kosten aktualisieren, falls älter als 10 Minuten. */
function onVisible(): void {
  if (document.visibilityState === 'visible') void costs.ensureFresh()
}

onMounted(() => {
  void models.loadAvailable()
  void costs.ensureFresh()
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('keydown', onShortcut)
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisible)
  window.removeEventListener('keydown', onShortcut)
})

// Eigene Zählung ist sofort aktuell: nach jeder KI-Anfrage die Summe nachladen.
watch(
  () => models.requests,
  () => {
    if (costs.report?.source === 'local') void costs.load()
  },
)

const costTitle = computed(() => {
  if (costs.configured === false) return 'Kostenrechner: auf dem Server nicht eingerichtet (K)'
  if (!costs.report) return 'Kosten der Anthropic API (K)'
  const a = costs.account
  return [
    costs.report.source === 'local'
      ? `Dieser Monat: ca. ${formatUsd(costs.monthUsd)} (Schätzung, nur dieser Editor)`
      : `Dieser Monat: ${formatUsd(costs.monthUsd)} (4–24 h verzögert)`,
    a.balance >= 0
      ? `Guthaben (geschätzt): ${formatUsd(a.balance)}`
      : `Offener Betrag: ${formatUsd(-a.balance)}`,
    'Öffnen mit K',
  ].join('\n')
})

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
  <div class="pdf-private-toolbar flex min-w-0 flex-wrap items-center gap-2 text-sm">
    <button
      type="button"
      class="rounded-md border pdf-control-border pdf-control-surface px-3 py-1.5 pdf-control-hover"
      data-testid="new-document"
      :title="
        doc.hasDocument
          ? 'Neue Seiten an das geöffnete Dokument anhängen (N)'
          : 'Neues Dokument (N)'
      "
      @click="showNew = true"
    >
      {{ doc.hasDocument ? 'Neue Seite' : 'Neues Dokument' }}
    </button>
    <label class="flex items-center gap-1 pdf-control-muted" title="Modell für alle KI-Funktionen">
      <span class="hidden lg:inline">KI-Modell</span>
      <select
        v-model="models.selected"
        class="rounded-md border pdf-control-border pdf-control-surface px-2 py-1.5"
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
      :class="
        models.mismatch
          ? 'pdf-control-warning-bg pdf-control-warning'
          : 'pdf-control-raised pdf-control-muted'
      "
      :title="usageTitle"
      data-testid="model-usage"
    >
      {{ modelLabel(models.last.model) }} ·
      {{ models.last.cost === null ? '?' : formatUsd(models.last.cost) }}
    </span>
    <button
      type="button"
      class="rounded-md border px-2 py-1.5 tabular-nums pdf-control-hover"
      :class="
        costs.budgetShare !== null && costs.budgetShare >= 1
          ? 'pdf-control-error-border pdf-control-error-bg pdf-control-error'
          : 'pdf-control-border pdf-control-surface'
      "
      :title="costTitle"
      data-testid="cost-button"
      @click="showCosts = true"
    >
      Kosten<template v-if="costs.report"
        >: {{ costs.report.source === 'local' ? '≈ ' : ''
        }}{{ formatUsd(costs.monthUsd) }}</template
      >
    </button>
    <NewDocumentDialog v-if="showNew" @close="showNew = false" />
    <CostDialog v-if="showCosts" @close="showCosts = false" />
  </div>
</template>
