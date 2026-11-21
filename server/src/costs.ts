/**
 * Kosten der Anthropic-Organisation (Usage & Cost Analytics, Beta) für den
 * Kostenrechner im Browser. Braucht einen eigenen Admin-Key (ANTHROPIC_ADMIN_KEY),
 * der nur auf dem Server bleibt. Die Daten kommen 4–24 h verzögert; Zahlungen und
 * Guthaben liefert die API nicht (die trägt der Browser selbst ein).
 *
 * Abfrage: Tagesbuckets (UTC), aufgeteilt nach Modell, in Abschnitten von ≤ 31 Tagen
 * (API-Grenze), mit Paging. Ergebnisse werden kurz zwischengespeichert, damit
 * Seitenaufrufe nicht jedes Mal die Admin-API belasten.
 */

/** Ein Zeilenausschnitt der API-Antwort (nur die genutzten Felder). */
export interface CostRow {
  starting_at: string
  group: { model?: string | null }
  cost: { amount: string; currency: string }
}

export interface CostPage {
  data: CostRow[]
  next_page: string | null
  has_more: boolean
  data_refreshed_at: string | null
}

export interface CostQuery {
  starting_at: string
  ending_at: string
  page?: string
  signal: AbortSignal
}

/** Holt eine Seite von GET /v1/organizations/analytics/cost (1d-Buckets, group_by model). */
export type CostPageFn = (query: CostQuery) => Promise<CostPage>

export interface CostDay {
  /** UTC-Tag YYYY-MM-DD. */
  date: string
  /** USD (nach Rabatten, vor Gutschriften). */
  total: number
  /** USD je Modell; „other“ für nicht zuordenbare Kosten. */
  models: Record<string, number>
}

export interface CostReport {
  currency: 'USD'
  from: string
  /** Ende des abgefragten Bereichs (exklusiv), volle Stunde UTC. */
  to: string
  /** Bis hierhin sind die Daten vollständig (laut API); danach können Kosten fehlen. */
  refreshedAt: string | null
  fetchedAt: string
  days: CostDay[]
}

export class CostRequestError extends Error {
  override name = 'CostRequestError'
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Früheste Abfrage laut API. */
export const COST_API_START = '2026-01-01'
const DAY_MS = 86_400_000
const CHUNK_DAYS = 31
const MAX_PAGES_PER_CHUNK = 20
/** Ältere Ergebnisse werden neu geladen. */
export const COST_CACHE_MS = 10 * 60_000
/** „Aktualisieren“ wirkt erst, wenn das Ergebnis mindestens so alt ist (API-Schonung). */
export const COST_MIN_REFRESH_MS = 60_000

const DATE = /^\d{4}-\d{2}-\d{2}$/

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Prüft `from` (YYYY-MM-DD) und begrenzt es auf den erlaubten Bereich
 * (ab 2026-01-01, höchstens 364 Tage zurück, nicht in der Zukunft).
 */
export function parseFrom(raw: string | null, now: number): string {
  if (!raw || !DATE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    throw new CostRequestError(400, 'Parameter „from“ muss ein Datum (JJJJ-MM-TT) sein.')
  }
  if (utcDay(Date.parse(`${raw}T00:00:00Z`)) !== raw) {
    throw new CostRequestError(400, 'Ungültiges Datum.')
  }
  const today = utcDay(now)
  if (raw > today) throw new CostRequestError(400, 'Das Datum liegt in der Zukunft.')
  const yearAgo = utcDay(now - 364 * DAY_MS)
  const earliest = yearAgo > COST_API_START ? yearAgo : COST_API_START
  return raw < earliest ? earliest : raw
}

/** Cent-Betrag (Dezimal-String) → USD; ungültige Werte zählen als 0. */
function centsToUsd(amount: string): number {
  const cents = Number(amount)
  return Number.isFinite(cents) ? cents / 100 : 0
}

/** Lädt alle Tage ab `from` bis zur aktuellen vollen Stunde. */
export async function fetchCostReport(
  fetchPage: CostPageFn,
  from: string,
  now: number,
  signal: AbortSignal,
): Promise<CostReport> {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Math.floor(now / 3_600_000) * 3_600_000
  const byDay = new Map<string, CostDay>()
  let refreshedAt: string | null = null

  for (let chunkStart = start; chunkStart < end; chunkStart += CHUNK_DAYS * DAY_MS) {
    const chunkEnd = Math.min(chunkStart + CHUNK_DAYS * DAY_MS, end)
    let page: string | undefined
    for (let n = 0; ; n++) {
      if (n >= MAX_PAGES_PER_CHUNK) throw new Error('Kostenabfrage: zu viele Seiten.')
      const res = await fetchPage({
        starting_at: new Date(chunkStart).toISOString(),
        ending_at: new Date(chunkEnd).toISOString(),
        page,
        signal,
      })
      // Kleinster Stand über alle Abschnitte: erst bis dahin ist alles vollständig.
      if (res.data_refreshed_at && (!refreshedAt || res.data_refreshed_at < refreshedAt)) {
        refreshedAt = res.data_refreshed_at
      }
      for (const row of res.data) {
        const date = row.starting_at.slice(0, 10)
        const usd = centsToUsd(row.cost.amount)
        if (!DATE.test(date) || usd === 0) continue
        const day = byDay.get(date) ?? { date, total: 0, models: {} }
        const model = row.group.model || 'other'
        day.total += usd
        day.models[model] = (day.models[model] ?? 0) + usd
        byDay.set(date, day)
      }
      if (!res.has_more || !res.next_page) break
      page = res.next_page
    }
  }

  return {
    currency: 'USD',
    from,
    to: new Date(Math.max(end, start)).toISOString(),
    refreshedAt,
    fetchedAt: new Date(now).toISOString(),
    days: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
  }
}

export interface CostService {
  get(from: string | null, refresh: boolean): Promise<CostReport>
}

/** Kostenabfrage mit Zwischenspeicher (pro Startdatum) und gebündelten Parallelanfragen. */
export function createCostService(
  fetchPage: CostPageFn,
  clock: () => number = Date.now,
): CostService {
  const cache = new Map<string, { at: number; report: Promise<CostReport> }>()

  return {
    async get(rawFrom, refresh) {
      const now = clock()
      const from = parseFrom(rawFrom, now)
      const hit = cache.get(from)
      const age = hit ? now - hit.at : Infinity
      if (hit && age < COST_CACHE_MS && !(refresh && age >= COST_MIN_REFRESH_MS)) {
        return hit.report
      }
      // Eigenes Zeitlimit (kein Client-Signal): das Ergebnis wird geteilt und zwischengespeichert.
      const report = fetchCostReport(fetchPage, from, now, AbortSignal.timeout(60_000))
      cache.set(from, { at: now, report })
      // Fehler nicht zwischenspeichern; Speicher klein halten.
      report.catch(() => {
        if (cache.get(from)?.report === report) cache.delete(from)
      })
      for (const key of cache.keys()) {
        if (cache.size <= 8) break
        cache.delete(key)
      }
      return report
    },
  }
}
