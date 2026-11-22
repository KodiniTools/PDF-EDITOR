<script setup lang="ts">
/** Übersicht aller Tastenkürzel (Taste ? oder F1). */
import { onBeforeUnmount, onMounted } from 'vue'

import type { ShortcutGroup } from '@/lib/shortcuts'

defineProps<{ groups: ShortcutGroup[] }>()
const emit = defineEmits<{ close: [] }>()

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' || e.key === '?' || e.key === 'F1') {
    e.preventDefault()
    emit('close')
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div
    class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
    @click.self="emit('close')"
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-title"
      class="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-xl bg-white p-5 text-sm shadow-xl"
      data-testid="shortcut-help"
    >
      <div class="flex items-baseline justify-between gap-2">
        <h2 id="shortcut-title" class="text-base font-semibold">Tastenkürzel</h2>
        <span class="text-xs text-gray-500">Auf dem Mac ⌘ statt Strg</span>
      </div>
      <div class="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <section v-for="g in groups" :key="g.title">
          <h3 class="mb-1 font-medium text-gray-700">{{ g.title }}</h3>
          <dl class="space-y-1">
            <div v-for="s in g.items" :key="s.label" class="flex items-start justify-between gap-3">
              <dt class="text-gray-600">{{ s.label }}</dt>
              <dd class="flex shrink-0 flex-wrap justify-end gap-1">
                <kbd
                  v-for="k in s.keys"
                  :key="k"
                  class="rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-xs"
                >
                  {{ k }}
                </kbd>
              </dd>
            </div>
          </dl>
        </section>
      </div>
      <p class="mt-4 text-xs text-gray-500">
        Buchstaben-Kürzel wirken nicht, solange ein Eingabefeld aktiv ist. Esc verlässt das Feld.
      </p>
      <div class="mt-4 flex justify-end">
        <button
          type="button"
          class="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-100"
          @click="emit('close')"
        >
          Schließen
        </button>
      </div>
    </div>
  </div>
</template>
