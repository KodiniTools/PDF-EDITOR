/** Konfiguration aus Umgebungsvariablen (systemd: EnvironmentFile, lokal: server/.env). */

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export interface Config {
  host: string
  port: number
  apiKey: string
  /** Standardmodell, wenn der Browser keines wählt. */
  model: string
  /** Im Browser wählbare Modelle (Allowlist, enthält immer `model`). */
  models: string[]
  effort: Effort
  /** Maximale Größe des Request-Bodys in Bytes. */
  maxBodyBytes: number
  /** Maximale Textmenge (Zeichen) pro Analyse-Request. */
  maxChars: number
  /** Maximale Dokumenttextmenge (Zeichen) für Fragen/Zusammenfassen. */
  maxAskChars: number
  /** Zeitlimit für einen Aufruf der Anthropic API. */
  timeoutMs: number
  /**
   * Optional: Admin-Key (sk-ant-admin…) nur für den Kostenrechner (GET /api/costs).
   * null = Kostenrechner aus.
   */
  adminKey: string | null
  /** JSON-Datei der eigenen Kostenzählung (USAGE_FILE, sonst systemd-StateDirectory). */
  usageFile: string
}

export class ConfigError extends Error {
  override name = 'ConfigError'
}

/** Standard-Port; muss zu proxy_pass in deploy/nginx-pdf-editor-privat.conf passen. */
export const DEFAULT_PORT = 3417

function int(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number) {
  const raw = env[key]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(
      `${key} muss eine ganze Zahl zwischen ${min} und ${max} sein (ist: ${raw}).`,
    )
  }
  return n
}

/** Standardauswahl im Browser: aktuelle Opus-, Sonnet-, Haiku- und Fable-Modelle. */
export const DEFAULT_MODELS = [
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
  'claude-fable-5-2',
] as const

const MODEL_ID = /^claude-[a-z0-9][a-z0-9.-]{0,62}$/

function parseModels(raw: string | undefined, model: string): string[] {
  const list =
    raw === undefined || raw.trim() === ''
      ? [...DEFAULT_MODELS]
      : raw
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean)
  for (const m of list) {
    if (!MODEL_ID.test(m)) throw new ConfigError(`ANTHROPIC_MODELS: ungültige Modell-ID "${m}".`)
  }
  // Standardmodell steht immer zur Wahl und vorne.
  return [...new Set([model, ...list])]
}

/** USAGE_FILE, sonst <StateDirectory>/usage.json (systemd), sonst data/usage.json. */
function usageFileOf(env: NodeJS.ProcessEnv): string {
  const explicit = env.USAGE_FILE?.trim()
  if (explicit) return explicit
  const state = env.STATE_DIRECTORY?.split(':')[0]?.trim()
  return state ? `${state.replace(/\/+$/, '')}/usage.json` : 'data/usage.json'
}

function parseAdminKey(raw: string | undefined, apiKey: string): string | null {
  const key = raw?.trim() ?? ''
  if (!key) return null
  if (key === apiKey) {
    throw new ConfigError(
      'ANTHROPIC_ADMIN_KEY darf nicht der normale API-Key sein (Admin-Key: sk-ant-admin…).',
    )
  }
  return key
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env.ANTHROPIC_API_KEY?.trim() ?? ''
  if (!apiKey) {
    throw new ConfigError(
      'ANTHROPIC_API_KEY fehlt (siehe deploy/pdf-editor-privat-api.env.example).',
    )
  }
  const effort = (env.ANTHROPIC_EFFORT?.trim() || 'medium') as Effort
  if (!EFFORTS.includes(effort)) {
    throw new ConfigError(`ANTHROPIC_EFFORT muss einer von ${EFFORTS.join(', ')} sein.`)
  }
  const host = env.HOST?.trim() || '127.0.0.1'
  const model = env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5-5'
  if (!MODEL_ID.test(model))
    throw new ConfigError(`ANTHROPIC_MODEL: ungültige Modell-ID "${model}".`)
  return {
    host,
    port: int(env, 'PORT', DEFAULT_PORT, 1024, 65535),
    apiKey,
    model,
    models: parseModels(env.ANTHROPIC_MODELS, model),
    effort,
    maxBodyBytes: int(env, 'MAX_BODY_BYTES', 1_000_000, 10_000, 10_000_000),
    maxChars: int(env, 'MAX_CHARS', 60_000, 1_000, 400_000),
    // Passt mit Puffer in MAX_BODY_BYTES (1 MB) bzw. client_max_body_size 1m.
    maxAskChars: int(env, 'MAX_ASK_CHARS', 400_000, 1_000, 2_000_000),
    timeoutMs: int(env, 'TIMEOUT_MS', 180_000, 5_000, 600_000),
    adminKey: parseAdminKey(env.ANTHROPIC_ADMIN_KEY, apiKey),
    usageFile: usageFileOf(env),
  }
}
