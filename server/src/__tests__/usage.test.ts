import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import Anthropic from '@anthropic-ai/sdk'

import { createHandler } from '../app.ts'
import type { StreamFn } from '../claude.ts'
import { loadConfig } from '../config.ts'
import {
  ADMIN_RETRY_MS,
  createCombinedCostService,
  CostRequestError,
  type CostReport,
  type CostService,
} from '../costs.ts'
import { estimateCost } from '../pricing.ts'
import { createUsageStore, parseUsageFile } from '../usage.ts'

const NOW = Date.parse('2026-11-21T10:30:00Z')
const META = {
  model: 'claude-opus-5-5',
  inputTokens: 1_000_000,
  outputTokens: 100_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

describe('Eigene Kostenzählung', () => {
  it('Listenpreis inkl. Cache und Langprompt-Tarif', () => {
    assert.equal(estimateCost(META), 6) // 4 + 0.1 × 20
    assert.equal(
      estimateCost({ ...META, inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 }),
      0.2,
    )
    assert.equal(
      estimateCost({ ...META, model: 'claude-haiku-5-5', inputTokens: 200_000, outputTokens: 0 }),
      0.1, // 200k × 0.5 (Langprompt-Tarif)
    )
    assert.equal(estimateCost({ ...META, model: 'claude-unbekannt' }), null)
  })

  it('summiert je Tag und Modell, überlebt einen Neustart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-'))
    try {
      const file = join(dir, 'sub', 'usage.json')
      let now = NOW - 86_400_000
      const a = createUsageStore({ file, clock: () => now, writeDelayMs: 5 })
      a.record(META)
      now = NOW
      a.record(META)
      a.record({ ...META, model: 'claude-haiku-5-5', inputTokens: 1_000_000, outputTokens: 0 })
      a.record({ ...META, model: 'claude-unbekannt' })
      await a.flush()

      const b = createUsageStore({ file, clock: () => now })
      assert.deepEqual(b.days('2026-11-20'), [
        { date: '2026-11-20', total: 6, models: { 'claude-opus-5-5': 6 } },
        {
          date: '2026-11-21',
          total: 6.5,
          models: { 'claude-opus-5-5': 6, 'claude-haiku-5-5': 0.5, 'claude-unbekannt': 0 },
        },
      ])
      assert.deepEqual(b.days('2026-11-21').length, 1)
      const saved = parseUsageFile(await readFile(file, 'utf8'))
      assert.equal(saved.days['2026-11-21']?.['claude-unbekannt']?.unpriced, 1)
      assert.equal(saved.days['2026-11-21']?.['claude-opus-5-5']?.requests, 1)
      assert.ok(!(await readdir(join(dir, 'sub'))).some((f) => f.endsWith('.tmp')))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('legt eine kaputte Datei beiseite und beginnt neu', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-'))
    try {
      const file = join(dir, 'usage.json')
      await writeFile(file, '{kaputt')
      const logs: string[] = []
      const s = createUsageStore({ file, clock: () => NOW, log: (l) => logs.push(l) })
      assert.deepEqual(s.days('2026-01-01'), [])
      await new Promise((r) => setTimeout(r, 20))
      assert.ok((await readdir(dir)).some((f) => f.startsWith('usage.json.defekt-')))
      assert.ok(logs.some((l) => l.includes('unlesbar')))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('Speicherort: USAGE_FILE, sonst STATE_DIRECTORY, sonst data/', () => {
    const base = { ANTHROPIC_API_KEY: 'k' }
    assert.equal(loadConfig(base).usageFile, 'data/usage.json')
    assert.equal(
      loadConfig({ ...base, STATE_DIRECTORY: '/var/lib/x/:/var/lib/y' }).usageFile,
      '/var/lib/x/usage.json',
    )
    assert.equal(
      loadConfig({ ...base, STATE_DIRECTORY: '/var/lib/x', USAGE_FILE: '/tmp/u.json' }).usageFile,
      '/tmp/u.json',
    )
  })
})

function anthropicReport(): CostReport {
  return {
    currency: 'USD',
    source: 'anthropic',
    notice: null,
    from: '2026-11-01',
    to: '',
    refreshedAt: null,
    fetchedAt: '',
    days: [{ date: '2026-11-02', total: 9, models: {} }],
  }
}

describe('Kostenquelle: Admin-Key oder eigene Zählung', () => {
  const local = { days: () => [{ date: '2026-11-21', total: 1, models: { m: 1 } }] }

  it('ohne Admin-Key: eigene Zählung ohne Hinweis', async () => {
    const svc = createCombinedCostService({ local, clock: () => NOW })
    const r = await svc.get('2026-11-01', false)
    assert.equal(r.source, 'local')
    assert.equal(r.notice, null)
    assert.equal(r.refreshedAt, new Date(NOW).toISOString())
    assert.equal(svc.source(), 'local')
    await assert.rejects(svc.get('gestern', false), CostRequestError)
  })

  it('funktionierender Admin-Key: Anthropic-Kosten', async () => {
    const anthropic: CostService = { get: async () => anthropicReport() }
    const svc = createCombinedCostService({ anthropic, local, clock: () => NOW })
    assert.equal((await svc.get('2026-11-01', false)).source, 'anthropic')
    assert.equal(svc.source(), 'anthropic')
  })

  it('403: eigene Zählung, erneuter Versuch erst nach einer Stunde', async () => {
    let calls = 0
    let now = NOW
    const anthropic: CostService = {
      get: async () => {
        calls++
        throw new Anthropic.PermissionDeniedError(403, undefined, 'forbidden', new Headers())
      },
    }
    const logs: string[] = []
    const svc = createCombinedCostService({
      anthropic,
      local,
      clock: () => now,
      log: (l) => logs.push(l),
    })
    const r = await svc.get('2026-11-01', false)
    assert.equal(r.source, 'local')
    assert.match(r.notice ?? '', /abgelehnt/)
    await svc.get('2026-11-01', true)
    assert.equal(calls, 1)
    assert.equal(svc.source(), 'local')
    now += ADMIN_RETRY_MS
    await svc.get('2026-11-01', false)
    assert.equal(calls, 2)
    assert.ok(logs.some((l) => l.includes('HTTP 403')))
  })

  it('Ausfall: eigene Zählung mit Hinweis, Admin-Key bleibt aktiv', async () => {
    let fail = true
    const anthropic: CostService = {
      get: async () => {
        if (fail) throw new Error('netz')
        return anthropicReport()
      },
    }
    const svc = createCombinedCostService({ anthropic, local, clock: () => NOW, log: () => {} })
    assert.match((await svc.get('2026-11-01', false)).notice ?? '', /nicht abrufbar/)
    fail = false
    assert.equal((await svc.get('2026-11-01', false)).source, 'anthropic')
  })
})

describe('HTTP: Zählung jeder KI-Anfrage', () => {
  let server: Server
  let base = ''
  const recorded: { model: string; outputTokens: number }[] = []
  let text = '{"findings":[]}'

  const stream: StreamFn = (params) => ({
    finalMessage: async () =>
      ({
        id: 'm',
        type: 'message',
        role: 'assistant',
        model: params.model,
        content: [{ type: 'text', text, citations: null }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        stop_details: null,
        usage: { input_tokens: 100, output_tokens: 7 },
      }) as unknown as Anthropic.Beta.Messages.BetaMessage,
  })

  before(async () => {
    const usage = createUsageStore({ file: null, clock: () => NOW })
    const handler = createHandler({
      config: {
        model: 'claude-opus-5-5',
        models: ['claude-opus-5-5'],
        effort: 'medium',
        maxBodyBytes: 20_000,
        maxChars: 10_000,
        maxAskChars: 10_000,
        timeoutMs: 5_000,
      },
      stream,
      costs: createCombinedCostService({ local: usage, clock: () => Date.now() }),
      usage: {
        record: (m) => {
          recorded.push(m)
          usage.record(m)
        },
      },
      log: () => {},
    })
    server = createServer((req, res) => void handler(req, res))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  after(() => new Promise<void>((r) => server.close(() => r())))

  const post = () =>
    fetch(`${base}/api/redaction-suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages: [{ page: 1, lines: ['Hallo'] }] }),
    })

  it('zählt erfolgreiche und verworfene (abgerechnete) Antworten', async () => {
    assert.equal((await post()).status, 200)
    text = 'kein JSON'
    assert.notEqual((await post()).status, 200)
    assert.deepEqual(
      recorded.map((r) => [r.model, r.outputTokens]),
      [
        ['claude-opus-5-5', 7],
        ['claude-opus-5-5', 7],
      ],
    )
    const health = (await (await fetch(`${base}/api/health`)).json()) as {
      costs: boolean
      costSource: string
    }
    assert.deepEqual([health.costs, health.costSource], [true, 'local'])
    const res = await fetch(`${base}/api/costs?from=2026-11-01`)
    const body = (await res.json()) as { source: string; days: { total: number }[] }
    assert.equal(body.source, 'local')
    assert.equal(body.days.length, 1)
    assert.ok(Math.abs(body.days[0]!.total - 2 * ((100 * 4 + 7 * 20) / 1e6)) < 1e-12)
  })
})
