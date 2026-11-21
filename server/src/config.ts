/** Konfiguration aus Umgebungsvariablen (systemd: EnvironmentFile, lokal: server/.env). */

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export interface Config {
  host: string
  port: number
  apiKey: string
  model: string
  effort: Effort
  /** Maximale Größe des Request-Bodys in Bytes. */
  maxBodyBytes: number
  /** Maximale Textmenge (Zeichen) pro Analyse-Request. */
  maxChars: number
  /** Zeitlimit für einen Aufruf der Anthropic API. */
  timeoutMs: number
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
  return {
    host,
    port: int(env, 'PORT', DEFAULT_PORT, 1024, 65535),
    apiKey,
    model: env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5-5',
    effort,
    maxBodyBytes: int(env, 'MAX_BODY_BYTES', 1_000_000, 10_000, 10_000_000),
    maxChars: int(env, 'MAX_CHARS', 60_000, 1_000, 400_000),
    timeoutMs: int(env, 'TIMEOUT_MS', 180_000, 5_000, 600_000),
  }
}
