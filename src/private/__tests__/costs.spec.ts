import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  byModel,
  ledger,
  parseReport,
  parseSettings,
  sumDays,
  type CostDay,
} from '@/private/costs/ledger'
import { COST_STORAGE_KEY, useCostStore } from '@/private/stores/costs'

const DAYS: CostDay[] = [
  { date: '2026-10-30', total: 5, models: { 'claude-opus-5-5': 5 } },
  { date: '2026-11-02', total: 3, models: { 'claude-opus-5-5': 2, 'claude-haiku-5-5': 1 } },
  { date: '2026-11-20', total: 1.5, models: { 'claude-haiku-5-5': 1.5 } },
]

describe('Kosten: Auswertung', () => {
  it('summiert Bereiche und Modelle', () => {
    expect(sumDays(DAYS, '2026-11-01')).toBe(4.5)
    expect(sumDays(DAYS, '2026-10-01', '2026-11-02')).toBe(8)
    expect(byModel(DAYS, '2026-11-01')).toEqual([
      { model: 'claude-haiku-5-5', usd: 2.5 },
      { model: 'claude-opus-5-5', usd: 2 },
    ])
  })

  it('Konto: Zahlungen minus Kosten ab Kontobeginn', () => {
    const s = {
      since: '2026-11-01',
      budget: null,
      payments: [
        { id: 'a', date: '2026-10-15', usd: 100 }, // vor Kontobeginn → zählt nicht
        { id: 'b', date: '2026-11-10', usd: 3 },
      ],
    }
    expect(ledger(DAYS, s)).toEqual({ costs: 4.5, paid: 3, balance: -1.5 })
  })

  it('verwirft unbrauchbare Server- und Speicherdaten', () => {
    expect(() => parseReport({})).toThrow('Unerwartete Antwort')
    const r = parseReport({
      from: '2026-11-01',
      to: 'x',
      refreshedAt: null,
      fetchedAt: '2026-11-21T10:00:00Z',
      days: [
        { date: '2026-11-02', total: 2, models: { m: 2, bad: -1 } },
        { date: 'x', total: 1 },
      ],
    })
    expect(r.days).toEqual([{ date: '2026-11-02', total: 2, models: { m: 2 } }])
    expect(parseSettings('kaputt', '2026-11-21')).toEqual({
      since: '2026-11-01',
      payments: [],
      budget: null,
    })
    expect(
      parseSettings(
        JSON.stringify({
          since: '2026-12-01',
          budget: -5,
          payments: [
            { id: 'p', date: '2026-11-03', usd: 10 },
            { id: 'q', usd: 'x' },
          ],
        }),
        '2026-11-21',
      ),
    ).toEqual({
      since: '2026-11-01',
      budget: null,
      payments: [{ id: 'p', date: '2026-11-03', usd: 10 }],
    })
  })
})

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Kosten: Store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('lädt ab Monatsanfang, Zahlung wird gespeichert und verrechnet', async () => {
    const costs = useCostStore()
    const month = costs.month
    const fetchFn = vi.fn<typeof fetch>(async () =>
      jsonResponse(200, {
        from: month,
        to: `${costs.today}T00:00:00.000Z`,
        refreshedAt: null,
        fetchedAt: new Date().toISOString(),
        days: [{ date: month, total: 12.5, models: { 'claude-opus-5-5': 12.5 } }],
      }),
    )
    await costs.load(true, fetchFn)
    expect(String(fetchFn.mock.calls[0]![0])).toMatch(
      new RegExp(`api/costs\\?from=${month}&refresh=1$`),
    )
    expect(costs.configured).toBe(true)
    expect(costs.monthUsd).toBe(12.5)
    expect(costs.account.balance).toBe(-12.5)

    costs.addPayment(12.5)
    costs.addPayment(-3) // ignoriert
    expect(costs.account.balance).toBe(0)
    await Promise.resolve()
    expect(JSON.parse(localStorage.getItem(COST_STORAGE_KEY)!).payments).toHaveLength(1)

    costs.setBudget(10)
    expect(costs.budgetShare).toBe(1.25)
  })

  it('erkennt fehlende Einrichtung und Serverfehler', async () => {
    const costs = useCostStore()
    await costs.load(
      false,
      vi.fn<typeof fetch>(async () => jsonResponse(503, { error: 'x', configured: false })),
    )
    expect(costs.configured).toBe(false)
    expect(costs.error).toBeNull()

    setActivePinia(createPinia())
    const other = useCostStore()
    await other.load(
      false,
      vi.fn<typeof fetch>(async () => jsonResponse(502, { error: 'Admin-Key ungültig' })),
    )
    expect(other.error).toBe('Admin-Key ungültig')
    expect(other.report).toBeNull()
  })
})
