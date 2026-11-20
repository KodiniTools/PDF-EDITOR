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

function confirmRemove(pageId: string, index: number): void {
  const page = store.pages[index]
  if (page && page.annotations.length > 0) {
    // Nur nachfragen, wenn Arbeit verloren ginge.
    if (!window.confirm(`Seite ${index + 1} mit Annotationen löschen?`)) return
  }
  store.removePage(pageId)
}
</script>

<template>
  <aside
    class="flex w-48 shrink-0 flex-col border-r border-gray-200 bg-white"
    aria-label="Seitenübersicht"
  >
    <div class="border-b border-gray-200 px-3 py-2 text-xs text-gray-500">
      {{ store.pages.length }} Seite(n) · ziehen zum Sortieren
    </div>
    <ol class="flex-1 space-y-1 overflow-y-auto p-2">
      <li
        v-for="(page, index) in store.pages"
        :key="page.id"
        draggable="true"
        :class="{
          'opacity-40': dragFrom === index,
          'border-t-4 border-blue-400': dragOver === index && dragFrom !== null && dragFrom > index,
          'border-b-4 border-blue-400': dragOver === index && dragFrom !== null && dragFrom < index,
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
          @select="store.selectPage(page.id)"
          @rotate="store.rotatePage(page.id, $event)"
          @remove="confirmRemove(page.id, index)"
          @move="store.movePage(index, $event)"
        />
      </li>
    </ol>
  </aside>
</template>
