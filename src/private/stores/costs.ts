/**
 * Kostenrechner (privater Build): lädt die Kosten der Anthropic-Organisation vom
 * eigenen Server (GET /api/costs, Admin-Key nur dort) und verrechnet sie mit selbst
 * eingetragenen Zahlungen/Aufladungen (nur in diesem Browser gespeichert).
 */
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import {
  byModel,
  ledger,
  monthStart,
  parseReport,
  parseSettings,
  sumDays,
  utcToday,
  type CostReport,
  type CostSettings,
} from '../costs/ledger'

export const COST_STORAGE_KEY = 'pdf-editor-privat:kosten'
const COSTS_URL = `${import.meta.env.BASE_URL}api/costs`
/** Server holt bis zu 12 Abschnitte à 31 Tage; großzügig bemessen. */
const REQUEST_TIMEOUT_MS = 90_000
/** Automatisch neu laden, wenn die Daten älter sind (Server cacht 10 min). */
export const AUTO_REFRESH_MS = 10 * 60_000
/** Eigene Zählung ist sofort aktuell und billig abzufragen. */
export const LOCAL_REFRESH_MS = 30_000

function readStored(): string | null {
  try {
    return localStorage.getItem(COST_STORAGE_KEY)
  } catch {
    return null
  }
}

let seq = 0

export const useCostStore = defineStore('privateCosts', () => {
  const report = ref<CostReport | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** null = noch unbekannt; false = auf dem Server nicht eingerichtet. */
  const configured = ref<boolean | null>(null)
  const settings = ref<CostSettings>(parseSettings(readStored(), utcToday()))
  let inflight: Promise<void> | null = null

  watch(
    settings,
    (s) => {
      try {
        localStorage.setItem(COST_STORAGE_KEY, JSON.stringify(s))
      } catch {
        // privates Fenster o. Ä.: Einträge gelten nur bis zum Neuladen
      }
    },
    { deep: true },
  )

  /** Wird bei jedem Laden nachgeführt (Seite bleibt evtl. über Mitternacht offen). */
  const today = ref(utcToday())
  const month = computed(() => monthStart(today.value))
  /** Ab hier wird geladen: Monatsanfang oder Kontobeginn, je nachdem was früher ist. */
  const queryFrom = computed(() =>
    settings.value.since < month.value ? settings.value.since : month.value,
  )

  const days = computed(() => report.value?.days ?? [])
  const todayUsd = computed(() => sumDays(days.value, today.value))
  const monthUsd = computed(() => sumDays(days.value, month.value))
  const monthByModel = computed(() => byModel(days.value, month.value))
  const account = computed(() => ledger(days.value, settings.value))
  /** Server konnte nicht so weit zurück (API: max. 364 Tage, ab 2026-01-01). */
  const truncated = computed(() => !!report.value && report.value.from > settings.value.since)
  const budgetShare = computed(() =>
    settings.value.budget ? monthUsd.value / settings.value.budget : null,
  )

  /** Lädt die Kosten; `refresh` umgeht den Server-Cache (frühestens nach 1 min). */
  function load(refresh = false, fetchFn: typeof fetch = fetch): Promise<void> {
    if (inflight) return inflight
    inflight = (async () => {
      loading.value = true
      error.value = null
      today.value = utcToday()
      const from = queryFrom.value
      try {
        const url = `${COSTS_URL}?from=${from}${refresh ? '&refresh=1' : ''}`
        const res = await fetchFn(url, {
          credentials: 'same-origin',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        let body: unknown = null
        try {
          body = await res.json()
        } catch {
          // HTML-Fehlerseite (z. B. nginx)
        }
        const b = body as { error?: unknown; configured?: unknown } | null
        if (res.status === 503 && b?.configured === false) {
          configured.value = false
          report.value = null
          return
        }
        if (!res.ok) {
          error.value =
            res.status === 401
              ? 'Anmeldung abgelaufen. Bitte die Seite neu laden.'
              : typeof b?.error === 'string'
                ? b.error
                : `Kosten konnten nicht geladen werden (HTTP ${res.status}).`
          return
        }
        configured.value = true
        report.value = parseReport(body)
      } catch (err) {
        console.error('[pdf-editor] Kosten:', err)
        error.value =
          err instanceof DOMException && err.name === 'TimeoutError'
            ? 'Die Kostenabfrage hat zu lange gedauert.'
            : 'Kosten konnten nicht geladen werden. Läuft das Backend?'
      } finally {
        loading.value = false
        inflight = null
      }
    })()
    return inflight
  }

  /** Neu laden, wenn nötig (veraltet oder Zeitraum geändert). */
  function ensureFresh(fetchFn: typeof fetch = fetch): Promise<void> {
    const r = report.value
    const stale =
      !r || r.from > queryFrom.value || Date.now() - Date.parse(r.fetchedAt) > AUTO_REFRESH_MS
    return configured.value !== false && stale ? load(false, fetchFn) : Promise.resolve()
  }

  function addPayment(usd: number, date: string = today.value): void {
    if (!Number.isFinite(usd) || usd <= 0) return
    const rounded = Math.round(usd * 100) / 100
    settings.value.payments.push({ id: `pay-${Date.now()}-${++seq}`, date, usd: rounded })
    settings.value.payments.sort((a, b) => a.date.localeCompare(b.date))
  }

  function removePayment(id: string): void {
    settings.value.payments = settings.value.payments.filter((p) => p.id !== id)
  }

  /** Kontobeginn ändern (lädt bei Bedarf weiter zurück). */
  function setSince(date: string): void {
    if (date > today.value) return
    settings.value.since = date
    void ensureFresh()
  }

  function setBudget(usd: number | null): void {
    settings.value.budget = usd !== null && Number.isFinite(usd) && usd > 0 ? usd : null
  }

  return {
    report,
    loading,
    error,
    configured,
    settings,
    today,
    month,
    queryFrom,
    todayUsd,
    monthUsd,
    monthByModel,
    account,
    truncated,
    budgetShare,
    load,
    ensureFresh,
    addPayment,
    removePayment,
    setSince,
    setBudget,
  }
})
