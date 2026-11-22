<script setup lang="ts">
import { computed, ref } from 'vue'

import PdfPageCanvas from '@/components/PdfPageCanvas.vue'
import { useVisibleOnce } from '@/composables/useVisibility'
import { displaySize, normalizeRotation } from '@/lib/geometry'
import type { PageRef } from '@/types/pdf'

const THUMB_WIDTH = 132

const props = defineProps<{
  page: PageRef
  index: number
  total: number
  selected: boolean
  /** Für den Export markiert (Häkchen). */
  marked: boolean
}>()

const emit = defineEmits<{
  select: []
  rotate: [direction: 'cw' | 'ccw']
  remove: []
  move: [to: number]
  toggleMark: []
}>()

const root = ref<HTMLElement | null>(null)
const visible = useVisibleOnce(root)

const rotation = computed(() => normalizeRotation(props.page.baseRotation + props.page.rotation))
const size = computed(() => displaySize(props.page.box, rotation.value))
const scale = computed(() => THUMB_WIDTH / size.value.width)
const placeholderHeight = computed(() => Math.round(size.value.height * scale.value))
</script>

<template>
  <div
    ref="root"
    class="group rounded-lg border-2 p-2 transition-colors"
    :class="
      selected
        ? 'border-blue-500 bg-blue-50'
        : marked
          ? 'border-blue-200 bg-blue-50/50'
          : 'border-transparent hover:bg-gray-100'
    "
  >
    <button
      type="button"
      class="relative mx-auto block cursor-pointer shadow"
      :style="{ width: `${THUMB_WIDTH}px`, minHeight: `${placeholderHeight}px` }"
      :aria-label="`Seite ${index + 1} auswählen`"
      :aria-current="selected ? 'page' : undefined"
      @click="emit('select')"
    >
      <PdfPageCanvas
        v-if="visible"
        :source-id="page.sourceId"
        :page-index="page.sourceIndex"
        :rotation="rotation"
        :scale="scale"
      />
      <span
        v-if="page.annotations.length > 0"
        class="absolute top-1 right-1 rounded bg-blue-600 px-1 text-[10px] text-white"
        :title="`${page.annotations.length} Annotation(en)`"
      >
        {{ page.annotations.length }}
      </span>
    </button>
    <div class="mt-1 flex items-center justify-between text-xs text-gray-600">
      <label
        class="flex cursor-pointer items-center gap-1 font-medium"
        :title="
          marked ? 'Markierung aufheben (M)' : 'Seite für Export/Druck markieren (M, alle: Strg+A)'
        "
      >
        <input
          type="checkbox"
          class="h-3.5 w-3.5"
          :checked="marked"
          :aria-label="`Seite ${index + 1} markieren`"
          data-testid="page-mark"
          @change="emit('toggleMark')"
        />
        {{ index + 1 }}
      </label>
      <div class="flex gap-0.5">
        <button
          type="button"
          class="thumb-btn"
          title="Nach oben (Alt+↑)"
          :disabled="index === 0"
          @click="emit('move', index - 1)"
        >
          ↑
        </button>
        <button
          type="button"
          class="thumb-btn"
          title="Nach unten (Alt+↓)"
          :disabled="index === total - 1"
          @click="emit('move', index + 1)"
        >
          ↓
        </button>
        <button
          type="button"
          class="thumb-btn"
          title="Links drehen (Umschalt+L)"
          @click="emit('rotate', 'ccw')"
        >
          ⟲
        </button>
        <button
          type="button"
          class="thumb-btn"
          title="Rechts drehen (Umschalt+R)"
          @click="emit('rotate', 'cw')"
        >
          ⟳
        </button>
        <button
          type="button"
          class="thumb-btn text-red-600"
          title="Seite löschen (Umschalt+Entf)"
          @click="emit('remove')"
        >
          ✕
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference 'tailwindcss';

.thumb-btn {
  @apply rounded px-1.5 py-0.5 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-30;
}
</style>
