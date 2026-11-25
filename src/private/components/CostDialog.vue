<script setup lang="ts">
/**
 * Kostenrechner: Kosten der Anthropic-Organisation (vom Server, 4–24 h verzögert),
 * Monatsbudget und ein Konto aus selbst eingetragenen Zahlungen/Aufladungen.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { formatUsd, modelLabel } from '../models'
import { useCostStore } from '../stores/costs'
import { useModelStore } from '../stores/model'

const emit = defineEmits<{ close: [] }>()

const costs = useCostStore()
const models = useModelStore()

const payAmount = ref<number | null>(null)
const payDate = ref(costs.today)
const budgetInput = ref<number | null>(costs.settings.budget)

const account = computed(() => costs.account)
const open = computed(() => Math.max(0, -account.value.balance))
const canPay = computed(
  () => payAmount.value !== null && payAmount.value > 0 && payDate.value <= costs.today,
)

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return 'unbekannt'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? 'unbekannt'
    : d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
}

function fmtDate(day: string): string {
  const [y, m, d] = day.split('-')
  return `${d}.${m}.${y}`
}

function prefillOpen(): void {
  payAmount.value = Math.round(open.value * 100) / 100
  payDate.value = costs.today
}

function pay(): void {
  if (!canPay.value || payAmount.value === null) return
  costs.addPayment(payAmount.value, payDate.value)
  payAmount.value = null
}

function saveBudget(): void {
  costs.setBudget(budgetInput.value)
  budgetInput.value = costs.settings.budget
}

function onSince(e: Event): void {
  const v = (e.target as HTMLInputElement).value
  if (v) costs.setSince(v)
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

// Solange der Dialog offen ist: alle 5 Minuten prüfen, ob neue Daten fällig sind.
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  window.addEventListener('keydown', onKey)
  void costs.ensureFresh()
  timer = setInterval(() => void costs.ensureFresh(), 5 * 60_000)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  clearInterval(timer)
})
</script>

<template>
  <div
    class="fixed inset-0 z-50 grid place-items-center pdf-control-scrim p-4"
    @click.self="emit('close')"
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cost-title"
      class="pdf-control-dialog w-full max-w-lg rounded-xl pdf-control-surface p-5 text-sm shadow-xl"
      data-testid="cost-dialog"
    >
      <div class="flex items-start justify-between gap-2">
        <h2 id="cost-title" class="text-base">Kosten der Anthropic API</h2>
        <button
          type="button"
          class="rounded-md border pdf-control-border px-2 py-1 pdf-control-hover disabled:opacity-50"
          :disabled="costs.loading || costs.configured === false"
          data-testid="cost-refresh"
          @click="costs.load(true)"
        >
          {{ costs.loading ? 'Lade…' : 'Aktualisieren' }}
        </button>
      </div>

      <p v-if="costs.error" role="alert" class="mt-2 pdf-control-error">{{ costs.error }}</p>

      <div
        v-if="costs.configured === false"
        class="mt-3 space-y-2 rounded-md pdf-control-warning-bg p-3 pdf-control-warning"
        data-testid="cost-setup"
      >
        <p>Das Backend kennt den Kostenrechner noch nicht.</p>
        <p>
          Bitte die aktuelle Version mit <code>deploy-privat.sh</code> auf den Server bringen.
          Danach zählt der Server die Kosten jeder KI-Anfrage selbst mit.
        </p>
      </div>

      <template v-else>
        <p
          v-if="costs.report?.source === 'local'"
          class="mt-2 rounded-md pdf-control-info-bg p-2 text-xs pdf-control-info"
          data-testid="cost-status"
        >
          <strong>Schätzung:</strong> gezählt werden nur KI-Anfragen dieses PDF-Editors (Tokens ×
          Listenpreis), sofort aktuell. Andere Apps und Keys sowie Rabatte und Gutschriften sind
          nicht enthalten; maßgeblich ist die Rechnung in der Anthropic Console.
          <span v-if="costs.report.notice" class="mt-1 block pdf-control-info">
            {{ costs.report.notice }}
          </span>
        </p>
        <p v-else class="mt-1 text-xs pdf-control-muted" data-testid="cost-status">
          Kosten der ganzen Organisation laut Anthropic, 4–24 Stunden verzögert. Vollständig bis
          {{ fmtDateTime(costs.report?.refreshedAt) }}, geladen
          {{ fmtDateTime(costs.report?.fetchedAt) }}.
        </p>

        <div class="mt-3 grid grid-cols-3 gap-2">
          <div class="rounded-md pdf-control-raised p-2">
            <div class="text-xs pdf-control-muted">Dieser Monat</div>
            <div class="text-lg tabular-nums" data-testid="cost-month">
              {{ formatUsd(costs.monthUsd) }}
            </div>
          </div>
          <div class="rounded-md pdf-control-raised p-2">
            <div class="text-xs pdf-control-muted">
              Heute (UTC{{ costs.report?.source === 'local' ? '' : ', unvollst.' }})
            </div>
            <div class="text-lg tabular-nums">{{ formatUsd(costs.todayUsd) }}</div>
          </div>
          <div
            class="rounded-md pdf-control-raised p-2"
            title="Sofort, aus den Tokens dieses Editors geschätzt"
          >
            <div class="text-xs pdf-control-muted">Seit Seitenaufruf ≈</div>
            <div class="text-lg tabular-nums">
              {{ formatUsd(models.sessionCost) }}
            </div>
          </div>
        </div>

        <div v-if="costs.settings.budget" class="mt-2">
          <div class="flex justify-between text-xs pdf-control-muted">
            <span>Monatsbudget {{ formatUsd(costs.settings.budget) }}</span>
            <span>{{ Math.round((costs.budgetShare ?? 0) * 100) }} %</span>
          </div>
          <div class="mt-1 h-2 overflow-hidden rounded pdf-control-track">
            <div
              class="h-full"
              :class="
                (costs.budgetShare ?? 0) >= 1
                  ? 'bg-red-600'
                  : (costs.budgetShare ?? 0) >= 0.8
                    ? 'bg-amber-500'
                    : 'bg-green-600'
              "
              :style="{ width: `${Math.min(100, (costs.budgetShare ?? 0) * 100)}%` }"
            />
          </div>
        </div>

        <section class="mt-4 rounded-md border pdf-control-border p-3" data-testid="cost-account">
          <div class="flex items-baseline justify-between">
            <span>
              {{ account.balance >= 0 ? 'Guthaben (geschätzt)' : 'Offener Betrag' }}
            </span>
            <span
              class="text-lg tabular-nums"
              :class="account.balance >= 0 ? 'pdf-control-success' : 'pdf-control-error'"
              data-testid="cost-balance"
            >
              {{ formatUsd(Math.abs(account.balance)) }}
            </span>
          </div>
          <p class="mt-1 text-xs pdf-control-muted">
            {{ costs.report?.source === 'local' ? 'Geschätzte Kosten' : 'Kosten' }} seit
            {{ fmtDate(costs.settings.since) }}: {{ formatUsd(account.costs) }} ·
            Zahlungen/Aufladungen: {{ formatUsd(account.paid) }}
          </p>
          <p v-if="costs.truncated" class="mt-1 text-xs pdf-control-warning">
            Kosten sind höchstens 364 Tage (ab 01.01.2026) verfügbar; ältere fehlen.
          </p>
          <p
            v-if="costs.report?.source === 'local' && account.balance > 0"
            class="mt-1 text-xs pdf-control-muted"
          >
            Guthaben ist nur eine Schätzung: Verbrauch anderer Apps mit demselben Konto fehlt.
          </p>

          <div class="mt-3 flex flex-wrap items-end gap-2">
            <label class="flex flex-col gap-1">
              <span class="text-xs pdf-control-muted">Bezahlt / aufgeladen (USD)</span>
              <input
                v-model.number="payAmount"
                type="number"
                min="0"
                step="0.01"
                class="w-32 rounded-md border pdf-control-border px-2 py-1"
                data-testid="cost-pay-amount"
                @keydown.enter="pay"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs pdf-control-muted">Datum</span>
              <input
                v-model="payDate"
                type="date"
                :max="costs.today"
                class="rounded-md border pdf-control-border px-2 py-1"
              />
            </label>
            <button
              type="button"
              class="rounded-md pdf-control-primary px-3 py-1.5 disabled:opacity-50"
              :disabled="!canPay"
              data-testid="cost-pay"
              @click="pay"
            >
              Eintragen
            </button>
            <button
              v-if="open > 0"
              type="button"
              class="text-xs pdf-control-info underline"
              data-testid="cost-pay-open"
              @click="prefillOpen"
            >
              Offenen Betrag übernehmen
            </button>
          </div>

          <ul
            v-if="costs.settings.payments.length"
            class="mt-3 space-y-1"
            data-testid="cost-payments"
          >
            <li
              v-for="p in [...costs.settings.payments].reverse()"
              :key="p.id"
              class="flex items-center justify-between rounded pdf-control-raised px-2 py-1"
            >
              <span>{{ fmtDate(p.date) }}</span>
              <span class="flex items-center gap-2">
                <span class="tabular-nums">{{ formatUsd(p.usd) }}</span>
                <button
                  type="button"
                  class="pdf-control-muted pdf-control-error-text-hover"
                  :aria-label="`Zahlung vom ${fmtDate(p.date)} entfernen`"
                  @click="costs.removePayment(p.id)"
                >
                  ✕
                </button>
              </span>
            </li>
          </ul>
        </section>

        <section v-if="costs.monthByModel.length" class="mt-4">
          <h3 class="mb-1">Dieser Monat nach Modell</h3>
          <table class="w-full" data-testid="cost-models">
            <tr v-for="r in costs.monthByModel" :key="r.model" class="border-t pdf-control-border">
              <td class="py-1">{{ r.model === 'other' ? 'Sonstiges' : modelLabel(r.model) }}</td>
              <td class="py-1 text-right tabular-nums">{{ formatUsd(r.usd) }}</td>
            </tr>
          </table>
        </section>

        <details class="mt-4">
          <summary class="cursor-pointer pdf-control-muted">Einstellungen</summary>
          <div class="mt-2 grid grid-cols-2 gap-3">
            <label class="flex flex-col gap-1">
              <span class="text-xs pdf-control-muted">Konto beginnt am</span>
              <input
                type="date"
                :value="costs.settings.since"
                min="2026-01-01"
                :max="costs.today"
                class="rounded-md border pdf-control-border px-2 py-1"
                data-testid="cost-since"
                @change="onSince"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs pdf-control-muted">Monatsbudget (USD, leer = keins)</span>
              <input
                v-model.number="budgetInput"
                type="number"
                min="0"
                step="1"
                class="rounded-md border pdf-control-border px-2 py-1"
                data-testid="cost-budget"
                @change="saveBudget"
              />
            </label>
          </div>
          <p class="mt-2 text-xs pdf-control-muted">
            Zahlungen, Budget und Kontobeginn werden nur in diesem Browser gespeichert; Anthropic
            stellt Zahlungen und Guthaben nicht über die API bereit.
            <template v-if="costs.report?.source === 'local'">
              Die eigene Zählung liegt auf dem Server und gilt für alle Browser.
            </template>
            <template v-else>
              Die Kosten gelten für die ganze Organisation (alle API-Keys), nach Rabatten, vor
              Gutschriften.
            </template>
          </p>
        </details>
      </template>

      <div class="mt-5 flex justify-end">
        <button
          type="button"
          class="rounded-md border pdf-control-border px-3 py-1.5"
          data-testid="cost-close"
          @click="emit('close')"
        >
          Schließen
        </button>
      </div>
    </div>
  </div>
</template>
