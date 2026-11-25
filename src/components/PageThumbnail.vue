<script setup lang="ts">
import { computed, ref } from 'vue'

import PdfPageCanvas from '@/components/PdfPageCanvas.vue'
import { useVisibleOnce } from '@/composables/useVisibility'
import { useI18n } from '@/i18n'
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

const { t } = useI18n()
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
    class="pdf-thumbnail"
    :class="{ 'pdf-thumbnail-selected': selected, 'pdf-thumbnail-marked': marked }"
  >
    <button
      type="button"
      class="pdf-thumbnail-preview"
      :style="{
        width: `${THUMB_WIDTH}px`,
        minHeight: `min(${placeholderHeight}px, var(--pdf-thumbnail-max-height))`,
      }"
      :aria-label="t('pages.select', { n: index + 1 })"
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
        class="pdf-thumbnail-annotations"
        :title="t('pages.annotations', { n: page.annotations.length })"
      >
        {{ page.annotations.length }}
      </span>
    </button>
    <div class="pdf-thumbnail-controls">
      <label
        class="flex cursor-pointer items-center gap-1"
        :title="marked ? t('pages.unmarkHint') : t('pages.markHint')"
      >
        <input
          type="checkbox"
          class="h-3.5 w-3.5"
          :checked="marked"
          :aria-label="t('pages.markLabel', { n: index + 1 })"
          data-testid="page-mark"
          @change="emit('toggleMark')"
        />
        {{ index + 1 }}
      </label>
      <div class="flex gap-0.5">
        <button
          type="button"
          class="thumb-btn"
          :title="t('pages.moveUpHint')"
          :disabled="index === 0"
          @click="emit('move', index - 1)"
        >
          ↑
        </button>
        <button
          type="button"
          class="thumb-btn"
          :title="t('pages.moveDownHint')"
          :disabled="index === total - 1"
          @click="emit('move', index + 1)"
        >
          ↓
        </button>
        <button
          type="button"
          class="thumb-btn"
          :title="t('pages.rotateLeftHint')"
          @click="emit('rotate', 'ccw')"
        >
          ⟲
        </button>
        <button
          type="button"
          class="thumb-btn"
          :title="t('pages.rotateRightHint')"
          @click="emit('rotate', 'cw')"
        >
          ⟳
        </button>
        <button
          type="button"
          class="thumb-btn pdf-control-error"
          :title="t('pages.removeHint')"
          @click="emit('remove')"
        >
          ✕
        </button>
      </div>
    </div>
  </div>
</template>
