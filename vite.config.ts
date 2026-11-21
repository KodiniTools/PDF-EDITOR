import { fileURLToPath, URL } from 'node:url'

import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import vueDevTools from 'vite-plugin-vue-devtools'

/**
 * Zwei Varianten aus einem Quellbaum:
 * - Standard (`vite build`): öffentliche App unter /pdf-editor/, rein clientseitig.
 * - `--mode private`: private App unter /pdf-editor-privat/ mit echtem Schwärzen
 *   (MuPDF, AGPL) und KI-Vorschlägen über das Backend in server/.
 *
 * `__PRIVATE__` wird zur Build-Zeit ersetzt. Code hinter `if (__PRIVATE__)` bzw.
 * `__PRIVATE__ ? import(...) : null` fällt im öffentlichen Build komplett weg
 * (deploy/deploy.sh prüft, dass dist/ kein MuPDF enthält).
 */
const PRIVATE_MODE = 'private'
/** Port des Backends (nur für `pnpm dev:privat`), siehe server/README.md. */
const API_PORT = process.env.PDF_API_PORT ?? '3417'

/** Private Seite: nicht indexieren, keine Canonical-URL der öffentlichen App. */
function privateHtml(): Plugin {
  return {
    name: 'kodini-private-html',
    transformIndexHtml(html) {
      return html
        .replace(/<title>[^<]*<\/title>/, '<title>Kodini PDF-Editor (privat)</title>')
        .replace(/\s*<meta\s+name="description"[\s\S]*?\/>/, '')
        .replace(
          /<link rel="canonical"[^>]*>/,
          '<meta name="robots" content="noindex, nofollow" />',
        )
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isPrivate = mode === PRIVATE_MODE
  // Muss zu BASE_PATH in deploy/deploy.sh bzw. deploy/deploy-privat.sh passen.
  const base = isPrivate ? '/pdf-editor-privat/' : '/pdf-editor/'

  return {
    base,
    define: {
      __PRIVATE__: JSON.stringify(isPrivate),
    },
    plugins: [vue(), tailwindcss(), vueDevTools(), ...(isPrivate ? [privateHtml()] : [])],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: isPrivate
      ? {
          proxy: {
            [`${base}api/`]: {
              target: `http://127.0.0.1:${API_PORT}`,
              rewrite: (path) => path.slice(base.length - 1),
            },
          },
        }
      : undefined,
    build: {
      outDir: isPrivate ? 'dist-privat' : 'dist',
      // pdf.js + pdf-lib landen im lazy geladenen Editor-Chunk (~860 kB, ~310 kB gzip).
      chunkSizeWarningLimit: 1000,
    },
  }
})
