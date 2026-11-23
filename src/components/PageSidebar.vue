<script setup lang="ts">
import { ref } from 'vue'

import PageThumbnail from '@/components/PageThumbnail.vue'
import { useDocumentStore } from '@/stores/document'

const store = useDocumentStore()

const dragFrom = ref<number | null>(null)
const dragOver = ref<number | null>(null)

function onDragStart(index: number, e: DragEvent): void {
  dragFrom.value = index
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    // Markierung, damit der Datei-Drop im Editor interne Drags ignoriert.
    e.dataTransfer.setData('application/x-pdf-editor-page', String(index))
  }
}

function onDrop(index: number): void {
  if (dragFrom.value !== null) store.movePage(dragFrom.value, index)
  dragFrom.value = null
  dragOver.value = null
}

function onDragEnd(): void {
  dragFrom.value = null
  dragOver.value = null
}
</script>

<template>
  <aside class="pdf-editor-pages" aria-label="Seitenübersicht">
    <div class="pdf-pages-header">
      <div class="flex items-baseline justify-between gap-2">
        <h2>Seiten</h2>
        <span>{{ store.pages.length }}</span>
      </div>
      <p>Ziehen zum Sortieren</p>
      <div class="mt-1 flex items-center justify-between gap-1" data-testid="mark-bar">
        <span>{{ store.markedPages.length }} markiert</span>
        <button
          v-if="store.markedPages.length < store.pages.length"
          type="button"
          class="pdf-pages-link"
          @click="store.setAllMarked(true)"
        >
          Alle
        </button>
        <button
          v-if="store.markedPages.length > 0"
          type="button"
          class="pdf-pages-link"
          @click="store.setAllMarked(false)"
        >
          Keine
        </button>
      </div>
    </div>
    <ol class="pdf-pages-list">
      <li
        v-for="(page, index) in store.pages"
        :key="page.id"
        class="pdf-pages-item"
        draggable="true"
        :class="{
          'opacity-40': dragFrom === index,
          'pdf-drop-before': dragOver === index && dragFrom !== null && dragFrom > index,
          'pdf-drop-after': dragOver === index && dragFrom !== null && dragFrom < index,
        }"
        @dragstart="onDragStart(index, $event)"
        @dragover.prevent="dragOver = index"
        @dragleave="dragOver = dragOver === index ? null : dragOver"
        @drop.prevent.stop="onDrop(index)"
        @dragend="onDragEnd"
      >
        <PageThumbnail
          :page="page"
          :index="index"
          :total="store.pages.length"
          :selected="page.id === store.selectedPageId"
          :marked="store.markedPageIds.includes(page.id)"
          @select="store.selectPage(page.id)"
          @rotate="store.rotatePage(page.id, $event)"
          @remove="store.removePage(page.id)"
          @move="store.movePage(index, $event)"
          @toggle-mark="store.toggleMarked(page.id)"
        />
      </li>
    </ol>
  </aside>
</template>
