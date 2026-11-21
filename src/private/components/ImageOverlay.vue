<script setup lang="ts">
/** Markiert gefundene Bilder auf der Seite (Nummer wie in der Liste „Bilder“). */
import { computed } from 'vue'

import { useImagesStore } from '@/private/stores/images'
import type { PageRef } from '@/types/pdf'

const props = defineProps<{ page: PageRef; zoom: number }>()
const images = useImagesStore()

/** Ganzseitige Bilder nicht umranden (verdecken sonst die ganze Seite). */
const items = computed(() =>
  images
    .forPage(props.page.id)
    .map((item, n) => ({ item, n }))
    .filter(({ item }) => !item.fullPage),
)

function px(v: number): string {
  return `${v * props.zoom}px`
}
</script>

<template>
  <div
    v-for="{ item, n } in items"
    :key="item.id"
    class="pointer-events-none absolute border-2 border-dashed"
    :class="images.hoverId === item.id ? 'border-blue-600 bg-blue-500/15' : 'border-purple-500/70'"
    :style="{
      left: px(item.rect.x),
      top: px(item.rect.y),
      width: px(item.rect.width),
      height: px(item.rect.height),
    }"
    data-testid="image-outline"
  >
    <span class="absolute -top-2.5 -left-2.5 rounded-full bg-purple-600 px-1.5 text-xs text-white">
      {{ n + 1 }}
    </span>
  </div>
</template>
