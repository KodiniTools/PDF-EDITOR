<script setup lang="ts">
/** Zeigt KI-Vorschläge auf der Seite; Klick wählt einen Vorschlag an/ab. */
import { computed } from 'vue'

import { CATEGORY_LABELS } from '@/private/suggestions/categories'
import { useRedactionStore } from '@/private/stores/redaction'
import type { PageRef } from '@/types/pdf'

const props = defineProps<{ page: PageRef; zoom: number }>()
const redaction = useRedactionStore()

const items = computed(() => redaction.forPage(props.page.id))

function px(v: number): string {
  return `${v * props.zoom}px`
}
</script>

<template>
  <template v-for="s in items" :key="s.id">
    <button
      v-for="(r, i) in s.rects"
      :key="i"
      type="button"
      class="absolute cursor-pointer rounded-sm border-2 border-dashed p-0"
      :class="
        s.selected
          ? 'border-orange-600 bg-orange-500/35'
          : 'border-gray-400 bg-transparent hover:bg-gray-400/20'
      "
      :style="{ left: px(r.x), top: px(r.y), width: px(r.width), height: px(r.height) }"
      :title="`${CATEGORY_LABELS[s.category]}: ${s.text}${s.reason ? ` – ${s.reason}` : ''} (Klick: ${s.selected ? 'abwählen' : 'auswählen'})`"
      :aria-pressed="s.selected"
      data-testid="suggestion-rect"
      @pointerdown.stop.prevent="redaction.toggle(s.id)"
    />
  </template>
</template>
