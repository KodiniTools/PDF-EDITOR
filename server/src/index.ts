/**
 * Einstiegspunkt: node src/index.ts (Node >= 22.18, TypeScript per Type Stripping).
 * Konfiguration siehe config.ts und deploy/pdf-editor-privat-api.env.example.
 */
import { createServer } from 'node:http'

import Anthropic from '@anthropic-ai/sdk'

import { createHandler } from './app.ts'
import { ConfigError, loadConfig } from './config.ts'
import { createCombinedCostService, createCostService } from './costs.ts'
import { createUsageStore } from './usage.ts'

function main(): void {
  let config
  try {
    config = loadConfig()
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Konfigurationsfehler: ${err.message}`)
      process.exit(78) // EX_CONFIG: systemd startet nicht endlos neu (RestartPreventExitStatus)
    }
    throw err
  }

  // Der Key bleibt hier im Prozess; er wird nie an den Browser ausgeliefert.
  const client = new Anthropic({ apiKey: config.apiKey, timeout: config.timeoutMs, maxRetries: 2 })
  // Kostenrechner: eigener Client mit Admin-Key (nur Lesen der Kosten wird genutzt).
  const admin = config.adminKey
    ? new Anthropic({ apiKey: config.adminKey, timeout: 30_000, maxRetries: 2 })
    : null
  const anthropicCosts = admin
    ? createCostService(({ signal, ...query }) =>
        admin.beta.organization.analytics.cost.list(
          {
            ...query,
            time_bucket_width: '1d',
            group_by: ['model'],
            order_by: 'time',
            order: 'asc',
            limit: 1000,
          },
          { signal },
        ),
      )
    : undefined
  // Eigene Zählung (Tokens × Listenpreis), dauerhaft in config.usageFile.
  const usage = createUsageStore({ file: config.usageFile })
  const costs = createCombinedCostService({ anthropic: anthropicCosts, local: usage })
  const handler = createHandler({
    config,
    stream: (params, options) => client.beta.messages.stream(params, options),
    costs,
    usage,
  })

  const server = createServer((req, res) => void handler(req, res))
  server.requestTimeout = config.timeoutMs + 30_000
  server.headersTimeout = 30_000

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `Port ${config.port} ist bereits belegt. Freien Port wählen (PORT=…), siehe server/README.md.`,
      )
      process.exit(78)
    }
    throw err
  })
  server.listen(config.port, config.host, () => {
    console.log(
      `pdf-editor-privat-api hört auf http://${config.host}:${config.port} (Modell ${config.model}, effort ${config.effort}, Kosten: ${admin ? 'Admin-Key, sonst ' : ''}eigene Zählung in ${config.usageFile})`,
    )
  })

  const shutdown = (signal: string) => {
    console.log(`${signal} empfangen, beende …`)
    void usage.flush() // sofort sichern, falls das Beenden per Zeitlimit endet
    server.close(() => void usage.flush().finally(() => process.exit(0)))
    setTimeout(() => process.exit(0), 10_000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main()
