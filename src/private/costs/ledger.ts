/**
 * Kostenrechner (privater Build): Auswertung der Tageskosten vom Server
 * (GET /api/costs, Quelle: Anthropic Usage & Cost Analytics) und ein einfaches
 * Konto aus selbst eingetragenen Zahlungen/Aufladungen. Alle Tage sind UTC-Tage,
 * wie in der Anthropic-Abrechnung.
 */

export interface CostDay {
  /** UTC-Tag YYYY-MM-DD. */
  date: string
  /** USD (nach Rabatten, vor Gutschriften). */
  total: number
  models: Record<string, number>
}

export interface CostReport {
  from: string
  to: string
  /** Bis hierhin sind die Daten laut Anthropic vollständig. */
  refreshedAt: string | null
  fetchedAt: string
  days: CostDay[]
}

/** Zahlung einer Rechnung oder Aufladung von Guthaben (selbst eingetragen). */
export interface Payment {
  id: string
  date: string
  usd: number
}

export interface CostSettings {
  /** Konto beginnt an diesem Tag: Kosten ab hier zählen gegen die Zahlungen. */
  since: string
  payments: Payment[]
  /** Optionales Monatsbudget in USD. */
  budget: number | null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function isDate(v: unknown): v is string {
  return typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
}

export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`
}

function money(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
}

/** Prüft die Serverantwort; unbrauchbare Tage werden verworfen. */
export function parseReport(body: unknown): CostReport {
  const b = (body ?? {}) as Record<string, unknown>
  if (!isDate(b.from) || typeof b.to !== 'string' || !Array.isArray(b.days)) {
    throw new Error('Unerwartete Antwort vom Server.')
  }
  const days = b.days.flatMap((d: unknown): CostDay[] => {
    const { date, total, models } = (d ?? {}) as Record<string, unknown>
    const t = money(total)
    if (!isDate(date) || t === null) return []
    const m: Record<string, number> = {}
    if (models && typeof models === 'object') {
      for (const [k, v] of Object.entries(models)) {
        const usd = money(v)
        if (usd !== null) m[k] = usd
      }
    }
    return [{ date, total: t, models: m }]
  })
  return {
    from: b.from,
    to: b.to,
    refreshedAt: typeof b.refreshedAt === 'string' ? b.refreshedAt : null,
    fetchedAt: typeof b.fetchedAt === 'string' ? b.fetchedAt : new Date().toISOString(),
    days,
  }
}

/** Summe der Tage im Bereich [from, to] (beide inklusive, `to` optional). */
export function sumDays(days: readonly CostDay[], from: string, to?: string): number {
  return days.reduce((s, d) => (d.date >= from && (!to || d.date <= to) ? s + d.total : s), 0)
}

/** Kosten je Modell ab `from`, absteigend. */
export function byModel(days: readonly CostDay[], from: string): { model: string; usd: number }[] {
  const acc = new Map<string, number>()
  for (const d of days) {
    if (d.date < from) continue
    for (const [model, usd] of Object.entries(d.models)) {
      acc.set(model, (acc.get(model) ?? 0) + usd)
    }
  }
  return [...acc]
    .map(([model, usd]) => ({ model, usd }))
    .filter((r) => r.usd > 0)
    .sort((a, b) => b.usd - a.usd)
}

export interface Ledger {
  /** Kosten seit `since`. */
  costs: number
  /** Zahlungen/Aufladungen seit `since`. */
  paid: number
  /** paid − costs: positiv = Guthaben, negativ = offener Betrag. */
  balance: number
}

export function ledger(days: readonly CostDay[], settings: CostSettings): Ledger {
  const costs = sumDays(days, settings.since)
  const paid = settings.payments.reduce((s, p) => (p.date >= settings.since ? s + p.usd : s), 0)
  return { costs, paid, balance: paid - costs }
}

/** Liest gespeicherte Einstellungen tolerant (alte/kaputte Daten → Standard). */
export function parseSettings(raw: string | null, today: string): CostSettings {
  const fallback: CostSettings = { since: monthStart(today), payments: [], budget: null }
  if (!raw) return fallback
  try {
    const s = JSON.parse(raw) as Record<string, unknown>
    const payments = Array.isArray(s.payments)
      ? s.payments.flatMap((p: unknown): Payment[] => {
          const { id, date, usd } = (p ?? {}) as Record<string, unknown>
          const amount = money(usd)
          return typeof id === 'string' && isDate(date) && amount !== null && amount > 0
            ? [{ id, date, usd: amount }]
            : []
        })
      : []
    const budget = money(s.budget)
    return {
      since: isDate(s.since) && s.since <= today ? s.since : fallback.since,
      payments,
      budget: budget && budget > 0 ? budget : null,
    }
  } catch {
    return fallback
  }
}
