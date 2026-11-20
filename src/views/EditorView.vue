<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import AppToolbar from '@/components/AppToolbar.vue'
import PageEditor from '@/components/PageEditor.vue'
import PageSidebar from '@/components/PageSidebar.vue'
import SignatureDialog from '@/components/SignatureDialog.vue'
import { downloadBytes } from '@/lib/file'
import { useDocumentStore } from '@/stores/document'
import type { Tool } from '@/types/pdf'

const store = useDocumentStore()
const showSignature = ref(false)
const dropActive = ref(false)

async function openFiles(files: File[]): Promise<void> {
  await store.addFiles(files)
}

async function exportPdf(): Promise<void> {
  try {
    const bytes = await store.exportDocument()
    downloadBytes(bytes, store.suggestedFileName)
  } catch {
    // Meldung steht bereits in store.error
  }
}

function onSignatureSaved(dataUrl: string): void {
  store.signatureDataUrl = dataUrl
  store.setTool('signature')
  showSignature.value = false
}

function onSignatureCancel(): void {
  showSignature.value = false
  if (!store.signatureDataUrl && store.tool === 'signature') store.setTool('select')
}

function isFileDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
}

function onDragOver(e: DragEvent): void {
  if (!isFileDrag(e)) return
  e.preventDefault()
  dropActive.value = true
}

function onDrop(e: DragEvent): void {
  dropActive.value = false
  if (!isFileDrag(e)) return
  e.preventDefault()
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length > 0) void openFiles(files)
}

const shortcuts: Record<string, Tool> = {
  v: 'select',
  e: 'edit-text',
  t: 'text',
  h: 'highlight',
  a: 'cover',
  s: 'signature',
}

function onKeyDown(e: KeyboardEvent): void {
  const target = e.target as HTMLElement | null
  if (
    target &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  ) {
    return
  }
  if (showSignature.value || !store.hasDocument) return

  // Undo/Redo: Strg/Cmd+Z, Strg/Cmd+Umschalt+Z, Strg+Y
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    const key = e.key.toLowerCase()
    if (key === 'z' || key === 'y') {
      e.preventDefault()
      if (key === 'y' || e.shiftKey) store.redo()
      else store.undo()
    }
    return
  }
  if (e.altKey) return

  const page = store.selectedPage
  if ((e.key === 'Delete' || e.key === 'Backspace') && page && store.selectedAnnotationId) {
    e.preventDefault()
    store.removeAnnotation(page.id, store.selectedAnnotationId)
    return
  }
  if (e.key === 'Escape') {
    store.selectedAnnotationId = null
    return
  }
  if (e.key === 'ArrowDown' || e.key === 'PageDown') {
    const next = store.pages[store.selectedPageIndex + 1]
    if (next) store.selectPage(next.id)
    return
  }
  if (e.key === 'ArrowUp' || e.key === 'PageUp') {
    const prev = store.pages[store.selectedPageIndex - 1]
    if (prev) store.selectPage(prev.id)
    return
  }
  const tool = shortcuts[e.key.toLowerCase()]
  if (tool) {
    store.setTool(tool)
    if (tool === 'signature' && !store.signatureDataUrl) showSignature.value = true
  }
}

function onBeforeUnload(e: BeforeUnloadEvent): void {
  if (store.hasDocument) e.preventDefault()
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('beforeunload', onBeforeUnload)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('beforeunload', onBeforeUnload)
})
</script>

<template>
  <div
    class="flex h-full flex-col bg-gray-100 text-gray-900"
    @dragover="onDragOver"
    @dragleave.self="dropActive = false"
    @drop="onDrop"
  >
    <AppToolbar
      @open-files="openFiles"
      @export="exportPdf"
      @edit-signature="showSignature = true"
    />

    <div
      v-if="store.error"
      role="alert"
      class="flex items-start justify-between gap-4 border-b border-red-200 bg-red-50 px-4 py-2 text-sm whitespace-pre-line text-red-700"
    >
      <span>{{ store.error }}</span>
      <button
        type="button"
        class="font-medium"
        aria-label="Meldung schließen"
        @click="store.error = null"
      >
        ✕
      </button>
    </div>

    <div class="flex min-h-0 flex-1">
      <PageSidebar v-if="store.hasDocument" />

      <main class="relative flex-1 overflow-auto p-6">
        <div v-if="store.selectedPage" class="flex min-w-max justify-center">
          <PageEditor
            :key="store.selectedPage.id"
            :page="store.selectedPage"
            @request-signature="showSignature = true"
          />
        </div>

        <div v-else class="grid h-full place-items-center">
          <div
            class="max-w-md rounded-xl border-2 border-dashed border-gray-300 bg-white p-10 text-center"
          >
            <p class="text-lg font-medium">PDF hierher ziehen</p>
            <p class="mt-2 text-sm text-gray-500">
              oder oben „PDF öffnen“ wählen. Mehrere Dateien werden zusammengeführt. Alles läuft
              lokal im Browser, nichts wird hochgeladen.
            </p>
            <p v-if="store.busy" class="mt-4 text-sm text-blue-600">Lade…</p>
          </div>
        </div>

        <div
          v-if="dropActive"
          class="pointer-events-none absolute inset-2 grid place-items-center rounded-xl border-4 border-dashed border-blue-500 bg-blue-50/80 text-lg font-medium text-blue-700"
        >
          Loslassen zum Hinzufügen
        </div>
      </main>
    </div>

    <SignatureDialog v-if="showSignature" @save="onSignatureSaved" @cancel="onSignatureCancel" />
  </div>
</template>
