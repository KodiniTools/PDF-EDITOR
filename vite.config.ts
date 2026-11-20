import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  // Ausgeliefert unter https://kodinitools.com/pdf-editor/
  // -> alle Asset-URLs (inkl. pdf.js-Worker) werden mit diesem Präfix gebaut.
  // Muss zu BASE_PATH in deploy/deploy.sh passen.
  base: '/pdf-editor/',
  plugins: [vue(), tailwindcss(), vueDevTools()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // pdf.js + pdf-lib landen im lazy geladenen Editor-Chunk (~860 kB, ~310 kB gzip).
    chunkSizeWarningLimit: 1000,
  },
})
