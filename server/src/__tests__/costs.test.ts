import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'

import Anthropic from '@anthropic-ai/sdk'

import { createHandler } from '../app.ts'
import { ConfigError, loadConfig } from '../config.ts'
import {
  COST_CACHE_MS,
  createCostService,
  fetchCostReport,
  parseFrom,
  type CostPage,
  type CostPageFn,
  type CostQuery,
} from '../costs.ts'

const NOW = Date.parse('2026-11-21T10:37:00Z')
const signal = new AbortController().signal

function row(date: string, model: string | null, cents: string) {
  return {
    starting_at: `${date}T00:00:00Z`,
    group: { model },
    cost: { amount: cents, currency: 'USD' },
  }
}

function page(
  data: CostPage['data'],
  next: string | null = null,
  refreshed = '2026-11-21T04:00:00Z',
): CostPage {
  return { data, next_page: next, has_more: next !== null, data_refreshed_at: refreshed }
}

describe('Kosten: parseFrom', () => {
  it('prüft das Format', () => {
    assert.throws(() => parseFrom(null, NOW), /JJJJ-MM-TT/)
    assert.throws(() => parseFrom('21.11.2026', NOW), /JJJJ-MM-TT/)
    assert.throws(() => parseFrom('2026-02-30', NOW), /Ungültiges Datum/)
    assert.throws(() => parseFrom('2026-11-22', NOW), /Zukunft/)
  })
  it('begrenzt auf 2026-01-01 bzw. 364 Tage', () => {
    assert.equal(parseFrom('2025-06-01', NOW), '2026-01-01')
    assert.equal(parseFrom('2026-11-01', NOW), '2026-11-01')
    assert.equal(parseFrom('2026-01-01', Date.parse('2027-06-01T00:00:00Z')), '2026-06-02')
  })
})

describe('Kosten: fetchCostReport', () => {
  it('teilt in 31-Tage-Abschnitte, folgt dem Paging und summiert je Tag/Modell', async () => {
    const calls: Omit<CostQuery, 'signal'>[] = []
    const fetchPage: CostPageFn = async ({ signal: _s, ...q }) => {
      calls.push(q)
      if (q.starting_at.startsWith('2026-09-21') && !q.page) {
        return page([row('2026-09-21', 'claude-opus-5-5', '150.5')], 'p2', '2026-11-20T23:00:00Z')
      }
      if (q.page === 'p2') return page([row('2026-09-21', 'claude-haiku-5-5', '49.5')])
      return page([
        row('2026-11-20', 'claude-opus-5-5', '1000'),
        row('2026-11-20', null, '25'),
        row('2026-11-21', 'claude-opus-5-5', '0'),
      ])
    }
    const r = await fetchCostReport(fetchPage, '2026-09-21', NOW, signal)
    assert.deepEqual(
      calls.map((c) => [c.starting_at, c.ending_at, c.page]),
      [
        ['2026-09-21T00:00:00.000Z', '2026-10-22T00:00:00.000Z', undefined],
        ['2026-09-21T00:00:00.000Z', '2026-10-22T00:00:00.000Z', 'p2'],
        ['2026-10-22T00:00:00.000Z', '2026-11-21T10:00:00.000Z', undefined],
      ],
    )
    assert.equal(r.to, '2026-11-21T10:00:00.000Z')
    assert.equal(r.refreshedAt, '2026-11-20T23:00:00Z')
    assert.deepEqual(r.days, [
      {
        date: '2026-09-21',
        total: 2,
        models: { 'claude-opus-5-5': 1.505, 'claude-haiku-5-5': 0.495 },
      },
      { date: '2026-11-20', total: 10.25, models: { 'claude-opus-5-5': 10, other: 0.25 } },
    ])
  })

  it('fragt nichts ab, wenn der Bereich leer ist', async () => {
    let n = 0
    const r = await fetchCostReport(
      async () => (n++, page([])),
      '2026-11-21',
      Date.parse('2026-11-21T00:20:00Z'),
      signal,
    )
    assert.equal(n, 0)
    assert.deepEqual(r.days, [])
  })
})

describe('Kosten: Zwischenspeicher', () => {
  it('nutzt den Cache, „refresh“ erst nach einer Minute, Fehler werden nicht gespeichert', async () => {
    let now = NOW
    let calls = 0
    let fail = false
    const svc = createCostService(
      async () => {
        calls++
        if (fail) throw new Error('kaputt')
        return page([row('2026-11-21', 'claude-opus-5-5', '100')])
      },
      () => now,
    )
    await svc.get('2026-11-21', false)
    await svc.get('2026-11-21', true) // zu früh für refresh
    assert.equal(calls, 1)
    now += 61_000
    await svc.get('2026-11-21', true)
    assert.equal(calls, 2)
    now += COST_CACHE_MS
    fail = true
    await assert.rejects(svc.get('2026-11-21', false), /kaputt/)
    fail = false
    await svc.get('2026-11-21', false)
    assert.equal(calls, 4)
  })
})

describe('Kosten: Konfiguration', () => {
  it('Admin-Key optional, nicht gleich dem API-Key', () => {
    assert.equal(loadConfig({ ANTHROPIC_API_KEY: 'k' }).adminKey, null)
    assert.equal(
      loadConfig({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_ADMIN_KEY: ' sk-ant-admin01 ' }).adminKey,
      'sk-ant-admin01',
    )
    assert.throws(
      () => loadConfig({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_ADMIN_KEY: 'k' }),
      ConfigError,
    )
  })
})

describe('Kosten: HTTP /api/costs', () => {
  const config = {
    model: 'claude-opus-5-5',
    models: ['claude-opus-5-5'],
    effort: 'medium' as const,
    maxBodyBytes: 20_000,
    maxChars: 10_000,
    maxAskChars: 10_000,
    timeoutMs: 5_000,
  }
  const stream = () => {
    throw new Error('nicht erwartet')
  }
  const servers: Server[] = []
  let withCosts = ''
  let without = ''
  let next: CostPage | Error = page([])
  const logs: string[] = []

  async function start(costs?: ReturnType<typeof createCostService>): Promise<string> {
    const handler = createHandler({ config, stream, costs, log: (l) => logs.push(l) })
    const server = createServer((req, res) => void handler(req, res))
    servers.push(server)
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }

  before(async () => {
    without = await start()
    withCosts = await start(
      createCostService(async () => {
        if (next instanceof Error) throw next
        return next
      }),
    )
  })
  after(() => Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r())))))

  it('503 ohne Admin-Key, Health meldet costs=false', async () => {
    const res = await fetch(`${without}/api/costs?from=2026-11-01`)
    assert.equal(res.status, 503)
    assert.deepEqual(((await res.json()) as { configured: boolean }).configured, false)
    const health = (await (await fetch(`${without}/api/health`)).json()) as { costs: boolean }
    assert.equal(health.costs, false)
  })

  it('liefert Tageskosten; nur GET', async () => {
    const today = new Date().toISOString().slice(0, 10)
    next = page([row(today, 'claude-opus-5-5', '250')])
    const res = await fetch(`${withCosts}/api/costs?from=${today}`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as { days: { total: number }[]; currency: string }
    assert.equal(body.currency, 'USD')
    assert.ok(body.days.length <= 1)
    assert.equal((await fetch(`${withCosts}/api/costs`, { method: 'POST' })).status, 405)
    const health = (await (await fetch(`${withCosts}/api/health`)).json()) as { costs: boolean }
    assert.equal(health.costs, true)
  })

  it('400 bei ungültigem Datum, 502 bei falschem Admin-Key', async () => {
    assert.equal((await fetch(`${withCosts}/api/costs?from=gestern`)).status, 400)
    next = new Anthropic.AuthenticationError(401, undefined, 'invalid x-api-key', new Headers())
    const res = await fetch(`${withCosts}/api/costs?from=2026-03-01`)
    assert.equal(res.status, 502)
    assert.match(((await res.json()) as { error: string }).error, /ANTHROPIC_ADMIN_KEY/)
    assert.ok(logs.some((l) => l.startsWith('costs fehler status=502')))
  })
})
