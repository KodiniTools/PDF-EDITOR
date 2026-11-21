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
    class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
    @click.self="emit('close')"
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cost-title"
      class="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-5 text-sm shadow-xl"
      data-testid="cost-dialog"
    >
      <div class="flex items-start justify-between gap-2">
        <h2 id="cost-title" class="text-base font-semibold">Kosten der Anthropic API</h2>
        <button
          type="button"
          class="rounded-md border border-gray-300 px-2 py-1 hover:bg-gray-100 disabled:opacity-50"
          :disabled="costs.loading || costs.configured === false"
          data-testid="cost-refresh"
          @click="costs.load(true)"
        >
          {{ costs.loading ? 'Lade…' : 'Aktualisieren' }}
        </button>
      </div>

      <p v-if="costs.error" role="alert" class="mt-2 text-red-700">{{ costs.error }}</p>

      <div
        v-if="costs.configured === false"
        class="mt-3 space-y-2 rounded-md bg-amber-50 p-3 text-amber-900"
        data-testid="cost-setup"
      >
        <p class="font-medium">Kostenrechner ist auf dem Server noch nicht eingerichtet.</p>
        <p>
          In der Anthropic Console unter Settings → Admin keys einen Admin-Key anlegen und auf dem
          Server in <code>/etc/kodini/pdf-editor-privat-api.env</code> als
          <code>ANTHROPIC_ADMIN_KEY=…</code> eintragen, dann den Dienst neu starten. Der Key bleibt
          nur auf dem Server.
        </p>
      </div>

      <template v-else>
        <p class="mt-1 text-xs text-gray-500" data-testid="cost-status">
          Anthropic liefert die Kosten 4–24 Stunden verzögert. Vollständig bis
          {{ fmtDateTime(costs.report?.refreshedAt) }}, geladen
          {{ fmtDateTime(costs.report?.fetchedAt) }}.
        </p>

        <div class="mt-3 grid grid-cols-3 gap-2">
          <div class="rounded-md bg-gray-50 p-2">
            <div class="text-xs text-gray-500">Dieser Monat</div>
            <div class="text-lg font-semibold tabular-nums" data-testid="cost-month">
              {{ formatUsd(costs.monthUsd) }}
            </div>
          </div>
          <div class="rounded-md bg-gray-50 p-2">
            <div class="text-xs text-gray-500">Heute (UTC, unvollst.)</div>
            <div class="text-lg font-semibold tabular-nums">{{ formatUsd(costs.todayUsd) }}</div>
          </div>
          <div
            class="rounded-md bg-gray-50 p-2"
            title="Sofort, aus den Tokens dieses Editors geschätzt"
          >
            <div class="text-xs text-gray-500">Seit Seitenaufruf ≈</div>
            <div class="text-lg font-semibold tabular-nums">
              {{ formatUsd(models.sessionCost) }}
            </div>
          </div>
        </div>

        <div v-if="costs.settings.budget" class="mt-2">
          <div class="flex justify-between text-xs text-gray-600">
            <span>Monatsbudget {{ formatUsd(costs.settings.budget) }}</span>
            <span>{{ Math.round((costs.budgetShare ?? 0) * 100) }} %</span>
          </div>
          <div class="mt-1 h-2 overflow-hidden rounded bg-gray-200">
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

        <section class="mt-4 rounded-md border border-gray-200 p-3" data-testid="cost-account">
          <div class="flex items-baseline justify-between">
            <span class="font-medium">
              {{ account.balance >= 0 ? 'Guthaben (geschätzt)' : 'Offener Betrag' }}
            </span>
            <span
              class="text-lg font-semibold tabular-nums"
              :class="account.balance >= 0 ? 'text-green-700' : 'text-red-700'"
              data-testid="cost-balance"
            >
              {{ formatUsd(Math.abs(account.balance)) }}
            </span>
          </div>
          <p class="mt-1 text-xs text-gray-600">
            Kosten seit {{ fmtDate(costs.settings.since) }}: {{ formatUsd(account.costs) }} ·
            Zahlungen/Aufladungen: {{ formatUsd(account.paid) }}
          </p>
          <p v-if="costs.truncated" class="mt-1 text-xs text-amber-700">
            Anthropic liefert höchstens 364 Tage (ab 01.01.2026); ältere Kosten fehlen.
          </p>

          <div class="mt-3 flex flex-wrap items-end gap-2">
            <label class="flex flex-col gap-1">
              <span class="text-xs text-gray-600">Bezahlt / aufgeladen (USD)</span>
              <input
                v-model.number="payAmount"
                type="number"
                min="0"
                step="0.01"
                class="w-32 rounded-md border border-gray-300 px-2 py-1"
                data-testid="cost-pay-amount"
                @keydown.enter="pay"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-gray-600">Datum</span>
              <input
                v-model="payDate"
                type="date"
                :max="costs.today"
                class="rounded-md border border-gray-300 px-2 py-1"
              />
            </label>
            <button
              type="button"
              class="rounded-md bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50"
              :disabled="!canPay"
              data-testid="cost-pay"
              @click="pay"
            >
              Eintragen
            </button>
            <button
              v-if="open > 0"
              type="button"
              class="text-xs text-blue-700 underline"
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
              class="flex items-center justify-between rounded bg-gray-50 px-2 py-1"
            >
              <span>{{ fmtDate(p.date) }}</span>
              <span class="flex items-center gap-2">
                <span class="tabular-nums">{{ formatUsd(p.usd) }}</span>
                <button
                  type="button"
                  class="text-gray-400 hover:text-red-700"
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
          <h3 class="mb-1 font-medium">Dieser Monat nach Modell</h3>
          <table class="w-full" data-testid="cost-models">
            <tr v-for="r in costs.monthByModel" :key="r.model" class="border-t border-gray-100">
              <td class="py-1">{{ r.model === 'other' ? 'Sonstiges' : modelLabel(r.model) }}</td>
              <td class="py-1 text-right tabular-nums">{{ formatUsd(r.usd) }}</td>
            </tr>
          </table>
        </section>

        <details class="mt-4">
          <summary class="cursor-pointer text-gray-700">Einstellungen</summary>
          <div class="mt-2 grid grid-cols-2 gap-3">
            <label class="flex flex-col gap-1">
              <span class="text-xs text-gray-600">Konto beginnt am</span>
              <input
                type="date"
                :value="costs.settings.since"
                min="2026-01-01"
                :max="costs.today"
                class="rounded-md border border-gray-300 px-2 py-1"
                data-testid="cost-since"
                @change="onSince"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-gray-600">Monatsbudget (USD, leer = keins)</span>
              <input
                v-model.number="budgetInput"
                type="number"
                min="0"
                step="1"
                class="rounded-md border border-gray-300 px-2 py-1"
                data-testid="cost-budget"
                @change="saveBudget"
              />
            </label>
          </div>
          <p class="mt-2 text-xs text-gray-500">
            Zahlungen, Budget und Kontobeginn werden nur in diesem Browser gespeichert; Anthropic
            stellt Zahlungen und Guthaben nicht über die API bereit. Die Kosten gelten für die ganze
            Organisation (alle API-Keys), nach Rabatten, vor Gutschriften.
          </p>
        </details>
      </template>

      <div class="mt-5 flex justify-end">
        <button
          type="button"
          class="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-100"
          data-testid="cost-close"
          @click="emit('close')"
        >
          Schließen
        </button>
      </div>
    </div>
  </div>
</template>
