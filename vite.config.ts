import { existsSync, readFileSync } from 'node:fs'
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

/**
 * Globale Navigation aus dem vorhandenen KodiniTools-Partial einbinden.
 * Mit `enabled = false` (private Variante) entfällt die Navigation vollständig:
 * der Platzhalter wird aus index.html entfernt und das virtuelle Modul ist leer.
 */
function globalNavigation(enabled: boolean): Plugin {
  const deployedPartial = '/var/www/kodinitools.com/partials/nav.html'
  const partial =
    process.env.KODINI_NAV_PARTIAL ??
    (existsSync(deployedPartial)
      ? deployedPartial
      : fileURLToPath(new URL('./partials/nav.html', import.meta.url)))
  const script = /<script\s*>([\s\S]*?)<\/script>/gi
  const moduleId = '\0virtual:kodini-nav'

  return {
    name: 'kodini-global-navigation',
    transformIndexHtml(html) {
      if (!enabled) {
        return html.replace(/[ \t]*<div id="global-nav-slot"><!--INJECT:nav--><\/div>\r?\n?/, '')
      }
      const markup = readFileSync(partial, 'utf8').replace(script, '')
      return html.replace('<!--INJECT:nav-->', () => markup)
    },
    resolveId(id) {
      if (id === 'virtual:kodini-nav') return moduleId
    },
    load(id) {
      if (id !== moduleId) return
      if (!enabled) return ''
      this.addWatchFile(partial)
      return Array.from(readFileSync(partial, 'utf8').matchAll(script), (match) => match[1]).join(
        '\n',
      )
    },
  }
}

/**
 * Globalen Footer aus dem KodiniTools-Partial einbinden (nur öffentliche Variante).
 * Quelle: `KODINI_FOOTER_PARTIAL`, sonst das Server-Partial, sonst `partials/footer.html`.
 *
 * Skripte des Partials laufen wie bei der Navigation als gebündeltes Modul und nicht
 * inline. `document.write` funktioniert dort nicht (es würde die geladene Seite
 * ersetzen), deshalb wird die Jahreszahl über einen Platzhalter gesetzt.
 * Mit `enabled = false` (private Variante) entfällt der Footer vollständig.
 */
function globalFooter(enabled: boolean): Plugin {
  const deployedPartial = '/var/www/kodinitools.com/partials/footer.html'
  const partial =
    process.env.KODINI_FOOTER_PARTIAL ??
    (existsSync(deployedPartial)
      ? deployedPartial
      : fileURLToPath(new URL('./partials/footer.html', import.meta.url)))
  const yearScript =
    /<script\s*>\s*document\.write\(\s*new Date\(\)\.getFullYear\(\)\s*\)\s*;?\s*<\/script>/gi
  const script = /<script\s*>([\s\S]*?)<\/script>/gi
  const moduleId = '\0virtual:kodini-footer'
  const fillYear =
    "document.querySelectorAll('[data-kodini-year]').forEach(function (el) {" +
    ' el.textContent = String(new Date().getFullYear()) })'

  return {
    name: 'kodini-global-footer',
    transformIndexHtml(html) {
      if (!enabled) {
        return html.replace(
          /[ \t]*<div id="global-footer-slot"><!--INJECT:footer--><\/div>\r?\n?/,
          '',
        )
      }
      const markup = readFileSync(partial, 'utf8')
        .replace(yearScript, '<span data-kodini-year></span>')
        .replace(script, '')
      return html.replace('<!--INJECT:footer-->', () => markup)
    },
    resolveId(id) {
      if (id === 'virtual:kodini-footer') return moduleId
    },
    load(id) {
      if (id !== moduleId) return
      if (!enabled) return ''
      this.addWatchFile(partial)
      const scripts = Array.from(
        readFileSync(partial, 'utf8').replace(yearScript, '').matchAll(script),
        (match) => match[1] ?? '',
      ).filter((code) => {
        if (!code.includes('document.write')) return true
        this.warn('Footer-Partial: Skript mit document.write wurde ausgelassen.')
        return false
      })
      // Semikolon als Trenner: die Skripte sind IIFEs und würden sonst als Aufruf
      // des vorherigen Ausdrucks gelesen.
      return [fillYear, ...scripts].join(';\n')
    },
  }
}

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
    plugins: [
      vue(),
      tailwindcss(),
      vueDevTools(),
      globalNavigation(!isPrivate),
      globalFooter(!isPrivate),
      ...(isPrivate ? [privateHtml()] : []),
    ],
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
