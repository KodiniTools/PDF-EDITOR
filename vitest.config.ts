import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default defineConfig((env) =>
  mergeConfig(
    viteConfig(env),
    defineConfig({
      test: {
        environment: 'jsdom',
        // server/ hat eigene Tests (node --test), siehe server/package.json.
        exclude: [...configDefaults.exclude, 'e2e/**', 'server/**'],
        root: fileURLToPath(new URL('./', import.meta.url)),
      },
    }),
  ),
)
