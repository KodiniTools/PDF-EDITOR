<script setup lang="ts">
/**
 * Vorschau der eingetragenen Formularwerte auf der Seite (nur privater Build).
 * Rein anzeigend; bearbeitet wird im Reiter „Formular“.
 */
import { computed } from 'vue'

import { useFormStore } from '@/private/stores/forms'
import type { PageRef } from '@/types/pdf'

const props = defineProps<{ page: PageRef; zoom: number }>()
const forms = useFormStore()

/** Nur geänderte Felder: deren Darstellung weicht vom gerenderten Original ab. */
const items = computed(() =>
  forms
    .widgetsOnPage(props.page)
    .filter((w) => w.field.key in forms.values)
    .map((w) => {
      const value = forms.valueOf(w.field)
      let text = ''
      if (w.field.kind === 'checkbox') text = value === true ? '✓' : ''
      else if (w.field.kind === 'radio') text = value === w.onValue ? '●' : ''
      else text = String(value)
      return { key: `${w.field.key}|${w.rect.x}|${w.rect.y}`, rect: w.rect, text, field: w.field }
    }),
)
</script>

<template>
  <div class="pointer-events-none absolute inset-0" data-testid="form-overlay">
    <div
      v-for="item in items"
      :key="item.key"
      class="absolute overflow-hidden rounded-sm border border-blue-400 bg-blue-50/90 px-0.5 leading-tight text-blue-900"
      :class="
        item.field.kind === 'checkbox' || item.field.kind === 'radio'
          ? 'grid place-items-center'
          : item.field.multiline
            ? 'whitespace-pre-wrap'
            : 'flex items-center whitespace-nowrap'
      "
      :style="{
        left: `${item.rect.x * zoom}px`,
        top: `${item.rect.y * zoom}px`,
        width: `${item.rect.width * zoom}px`,
        height: `${item.rect.height * zoom}px`,
        fontSize: `${Math.max(6, Math.min(12, item.rect.height * 0.7)) * zoom}px`,
      }"
      :title="item.field.name"
    >
      {{ item.text }}
    </div>
  </div>
</template>
