<script setup lang="ts">
/** Übersicht aller Tastenkürzel (Taste ? oder F1). */
import { onBeforeUnmount, onMounted } from 'vue'

import { useI18n } from '@/i18n'
import type { ShortcutGroup } from '@/lib/shortcuts'

defineProps<{ groups: ShortcutGroup[] }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()

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
    class="fixed inset-0 z-50 grid place-items-center pdf-control-scrim p-4"
    @click.self="emit('close')"
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-title"
      class="pdf-control-dialog w-full max-w-3xl rounded-xl pdf-control-surface p-5 text-sm shadow-xl"
      data-testid="shortcut-help"
    >
      <div class="flex items-baseline justify-between gap-2">
        <h2 id="shortcut-title" class="text-base">{{ t('shortcuts.title') }}</h2>
        <span class="text-xs pdf-control-muted">{{ t('shortcuts.macNote') }}</span>
      </div>
      <div class="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <section v-for="g in groups" :key="g.title">
          <h3 class="mb-1 pdf-control-muted">{{ g.title }}</h3>
          <dl class="space-y-1">
            <div v-for="s in g.items" :key="s.label" class="flex items-start justify-between gap-3">
              <dt class="pdf-control-muted">{{ s.label }}</dt>
              <dd class="flex shrink-0 flex-wrap justify-end gap-1">
                <kbd
                  v-for="k in s.keys"
                  :key="k"
                  class="rounded border pdf-control-border pdf-control-raised px-1.5 py-0.5 text-xs"
                >
                  {{ k }}
                </kbd>
              </dd>
            </div>
          </dl>
        </section>
      </div>
      <p class="mt-4 text-xs pdf-control-muted">
        {{ t('shortcuts.note') }}
      </p>
      <div class="mt-4 flex justify-end">
        <button
          type="button"
          class="rounded-md border pdf-control-border px-3 py-1.5 pdf-control-hover"
          @click="emit('close')"
        >
          {{ t('common.close') }}
        </button>
      </div>
    </div>
  </div>
</template>
