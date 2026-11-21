/**
 * Eigene Kostenzählung: Tokens jeder KI-Anfrage dieser App, nach Listenpreis in USD
 * umgerechnet, je UTC-Tag und Modell summiert und als JSON-Datei gespeichert
 * (systemd: StateDirectory, überlebt Neustarts). Ersetzt die Anthropic-Kosten,
 * wenn kein funktionierender Admin-Key vorhanden ist. Kein Dokumentinhalt.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { UsageMeta } from './claude.ts'
import type { CostDay } from './costs.ts'
import { estimateCost } from './pricing.ts'

export interface UsageTotals {
  usd: number
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** Anfragen ohne hinterlegten Preis (Modell unbekannt) – nicht in usd enthalten. */
  unpriced: number
}

interface UsageFile {
  version: 1
  /** UTC-Tag → Modell → Summen. */
  days: Record<string, Record<string, UsageTotals>>
}

/** Ältere Tage werden verworfen (Kosten-API reicht ohnehin nur 364 Tage zurück). */
const KEEP_DAYS = 400
const DAY_MS = 86_400_000
const DATE = /^\d{4}-\d{2}-\d{2}$/
const FIELDS = [
  'usd',
  'requests',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'unpriced',
] as const

function empty(): UsageTotals {
  return {
    usd: 0,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    unpriced: 0,
  }
}

/** Liest die Datei tolerant: unbrauchbare Einträge werden übersprungen. */
export function parseUsageFile(raw: string): UsageFile {
  const out: UsageFile = { version: 1, days: {} }
  const data = JSON.parse(raw) as { days?: unknown }
  if (!data.days || typeof data.days !== 'object') return out
  for (const [date, models] of Object.entries(data.days as Record<string, unknown>)) {
    if (!DATE.test(date) || !models || typeof models !== 'object') continue
    for (const [model, totals] of Object.entries(models as Record<string, unknown>)) {
      if (!totals || typeof totals !== 'object') continue
      const t = empty()
      for (const f of FIELDS) {
        const v = (totals as Record<string, unknown>)[f]
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) t[f] = v
      }
      ;(out.days[date] ??= {})[model] = t
    }
  }
  return out
}

export interface UsageStore {
  /** Zählt eine Anfrage (Tokens laut Antwort). */
  record(meta: UsageMeta): void
  /** Tageskosten ab `from` (YYYY-MM-DD), Format wie die Anthropic-Kosten. */
  days(from: string): CostDay[]
  /** Schreibt ausstehende Änderungen (z. B. vor dem Beenden). */
  flush(): Promise<void>
}

export interface UsageStoreOptions {
  /** null = nur im Speicher (Tests). */
  file: string | null
  clock?: () => number
  log?: (line: string) => void
  /** Verzögerung, mit der Schreibvorgänge gebündelt werden. */
  writeDelayMs?: number
}

export function createUsageStore(opts: UsageStoreOptions): UsageStore {
  const clock = opts.clock ?? Date.now
  const log = opts.log ?? ((l: string) => console.log(l))
  let state: UsageFile = { version: 1, days: {} }

  if (opts.file) {
    try {
      state = parseUsageFile(readFileSync(opts.file, 'utf8'))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Kaputte Datei nicht überschreiben, sondern beiseitelegen.
        log(`usage: Datei unlesbar (${String(err)}), beginne neu`)
        void rename(opts.file, `${opts.file}.defekt-${clock()}`).catch(() => {})
      }
    }
    try {
      mkdirSync(dirname(opts.file), { recursive: true })
    } catch {
      // Schreibfehler werden beim Speichern gemeldet.
    }
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  let writing: Promise<void> = Promise.resolve()

  function prune(): void {
    const cutoff = new Date(clock() - KEEP_DAYS * DAY_MS).toISOString().slice(0, 10)
    for (const date of Object.keys(state.days)) if (date < cutoff) delete state.days[date]
  }

  function write(): Promise<void> {
    timer = null
    const file = opts.file
    if (!file) return Promise.resolve()
    const json = JSON.stringify(state)
    // Atomar: erst temporäre Datei, dann umbenennen. Nacheinander, nie parallel.
    writing = writing.then(async () => {
      try {
        await writeFile(`${file}.tmp`, json, { mode: 0o600 })
        await rename(`${file}.tmp`, file)
      } catch (err) {
        log(`usage: Speichern fehlgeschlagen: ${String(err)}`)
      }
    })
    return writing
  }

  return {
    record(meta) {
      const date = new Date(clock()).toISOString().slice(0, 10)
      const t = ((state.days[date] ??= {})[meta.model] ??= empty())
      const usd = estimateCost(meta)
      t.requests += 1
      t.inputTokens += meta.inputTokens
      t.outputTokens += meta.outputTokens
      t.cacheReadTokens += meta.cacheReadTokens
      t.cacheWriteTokens += meta.cacheWriteTokens
      if (usd === null) t.unpriced += 1
      else t.usd += usd
      prune()
      if (opts.file && !timer) timer = setTimeout(() => void write(), opts.writeDelayMs ?? 1_000)
    },
    days(from) {
      return Object.entries(state.days)
        .filter(([date]) => date >= from)
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([date, models]) => {
          const m: Record<string, number> = {}
          let total = 0
          for (const [model, t] of Object.entries(models)) {
            m[model] = t.usd
            total += t.usd
          }
          return total > 0 ? [{ date, total, models: m }] : []
        })
    },
    async flush() {
      if (timer) {
        clearTimeout(timer)
        await write()
      }
      await writing
    },
  }
}
