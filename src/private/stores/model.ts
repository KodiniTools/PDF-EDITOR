/**
 * Modellauswahl für alle KI-Funktionen des privaten Builds.
 * Die Wahl wird bei jeder Anfrage als `model` mitgeschickt (siehe apiHooks) und vom
 * Server gegen seine Allowlist geprüft. Abgerechnet wird über genau dieses Modell
 * (kein automatischer Fallback); `last` zeigt das tatsächlich verwendete Modell.
 */
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { estimateCost, MODEL_INFO } from '../models'
import { apiHooks, type UsageMeta } from '../suggestions/api'

export const MODEL_STORAGE_KEY = 'pdf-editor-privat:modell'
const HEALTH_URL = `${import.meta.env.BASE_URL}api/health`

function readStored(): string | null {
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY)
  } catch {
    return null
  }
}

export const useModelStore = defineStore('privateModel', () => {
  /** Vom Server erlaubte Modelle; bis zur Antwort die bekannten Modelle. */
  const available = ref<string[]>(Object.keys(MODEL_INFO))
  const serverDefault = ref<string | null>(null)
  const selected = ref<string>(readStored() ?? Object.keys(MODEL_INFO)[0] ?? 'claude-opus-5-5')
  const last = ref<(UsageMeta & { cost: number | null; requested: string | null }) | null>(null)
  /** Summe der geschätzten Kosten seit dem Laden der Seite (nur bekannte Modelle). */
  const sessionCost = ref(0)
  const requests = ref(0)
  let loaded: Promise<void> | null = null

  watch(selected, (id) => {
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, id)
    } catch {
      // privates Fenster o. Ä.: Auswahl gilt dann nur bis zum Neuladen
    }
  })

  /** Lädt die Allowlist vom Server; eine unbekannte Auswahl fällt auf den Standard zurück. */
  function loadAvailable(fetchFn: typeof fetch = fetch): Promise<void> {
    loaded ??= (async () => {
      try {
        const res = await fetchFn(HEALTH_URL, { credentials: 'same-origin' })
        if (!res.ok) return
        const body = (await res.json()) as { model?: unknown; models?: unknown }
        const models = Array.isArray(body.models)
          ? body.models.filter((m): m is string => typeof m === 'string')
          : []
        if (typeof body.model === 'string') serverDefault.value = body.model
        if (models.length > 0) available.value = models
        if (!available.value.includes(selected.value)) {
          selected.value = serverDefault.value ?? available.value[0] ?? selected.value
        }
      } catch (err) {
        console.warn('[pdf-editor] Modellliste nicht verfügbar:', err)
      }
    })()
    return loaded
  }

  function recordUsage(meta: UsageMeta, requested: string | null = null): void {
    const cost = estimateCost(meta)
    last.value = { ...meta, cost, requested }
    requests.value++
    if (cost !== null) sessionCost.value += cost
  }

  /** Antwort kam von einem anderen Modell als angefragt (ohne Fallback nicht zu erwarten). */
  const mismatch = computed(
    () => !!last.value?.requested && last.value.model !== last.value.requested,
  )

  apiHooks.model = () => selected.value
  apiHooks.onUsage = recordUsage

  return {
    available,
    serverDefault,
    selected,
    last,
    sessionCost,
    requests,
    mismatch,
    loadAvailable,
    recordUsage,
  }
})
