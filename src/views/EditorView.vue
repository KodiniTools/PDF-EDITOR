<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'

import '@/assets/pdf-editor-layout.css'

import AppToolbar from '@/components/AppToolbar.vue'
import ExportDialog from '@/components/ExportDialog.vue'
import ShortcutHelp from '@/components/ShortcutHelp.vue'
import PageEditor from '@/components/PageEditor.vue'
import PageSidebar from '@/components/PageSidebar.vue'
import SignatureDialog from '@/components/SignatureDialog.vue'
import { displaySize, normalizeRotation } from '@/lib/geometry'
import {
  CORE_SHORTCUTS,
  isMod,
  isTypingTarget,
  modalOpen,
  type ShortcutGroup,
} from '@/lib/shortcuts'
import { useDocumentStore } from '@/stores/document'
import type { Tool } from '@/types/pdf'

/** KI-Werkzeuge (Schwärzen, Fragen) – nur im privaten Build (fällt sonst beim Bauen weg). */
const PrivatePanel = __PRIVATE__
  ? defineAsyncComponent(() => import('@/private/components/PrivatePanel.vue'))
  : null
const isPrivate = __PRIVATE__
const appearance = ref<'dark' | 'light' | 'system'>('dark')

const store = useDocumentStore()
const showSignature = ref(false)
const showExport = ref(false)
const showHelp = ref(false)
const toolbar = ref<InstanceType<typeof AppToolbar> | null>(null)
/** Kürzel-Übersicht; der private Build ergänzt seine Kürzel (lazy geladen). */
const shortcutGroups = ref<ShortcutGroup[]>(CORE_SHORTCUTS)
if (__PRIVATE__) {
  void import('@/private/shortcuts').then((m) => {
    shortcutGroups.value = [...CORE_SHORTCUTS, ...m.PRIVATE_SHORTCUTS]
  })
}
const outputMode = ref<'export' | 'print'>('export')

function openOutput(mode: 'export' | 'print'): void {
  outputMode.value = mode
  showExport.value = true
}
const dropActive = ref(false)

async function openFiles(files: File[]): Promise<void> {
  await store.addFiles(files)
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

const toolKeys: Record<string, Tool> = {
  v: 'select',
  e: 'edit-text',
  t: 'text',
  h: 'highlight',
  a: 'cover',
  s: 'signature',
  ...(__PRIVATE__ ? { r: 'redact' as const } : {}),
}

/** Verschiebt das ausgewählte Element (Pfeiltasten); ein Undo-Schritt je Tastenfolge. */
function nudgeSelected(dx: number, dy: number): boolean {
  const page = store.selectedPage
  const a = store.selectedAnnotation
  if (!page || !a) return false
  const size = displaySize(page.box, normalizeRotation(page.baseRotation + page.rotation))
  const w = 'width' in a ? a.width : 0
  const h = 'height' in a ? a.height : 0
  const x = Math.min(Math.max(0, a.x + dx), Math.max(0, size.width - w))
  const y = Math.min(Math.max(0, a.y + dy), Math.max(0, size.height - h))
  store.updateAnnotation(page.id, a.id, { x, y }, `nudge:${a.id}`)
  return true
}

function selectPageAt(index: number): void {
  const p = store.pages[index]
  if (p) store.selectPage(p.id)
}

function onKeyDown(e: KeyboardEvent): void {
  const key = e.key
  const lower = key.length === 1 ? key.toLowerCase() : key
  const mod = isMod(e)
  // Strg/Cmd+P und +S: auch bei offenem Dialog nicht den Browser-Druck/-Speichern zeigen.
  if (mod && !e.altKey && (lower === 'p' || lower === 's') && store.hasDocument) {
    e.preventDefault()
    if (!modalOpen() && !showSignature.value && !store.busy) {
      openOutput(lower === 'p' ? 'print' : 'export')
    }
    return
  }
  if (isTypingTarget(e.target) || showSignature.value || modalOpen()) return

  // Übersicht und Öffnen gehen auch ohne Dokument.
  if ((key === '?' || key === 'F1') && !mod) {
    e.preventDefault()
    showHelp.value = true
    return
  }
  if (mod && !e.altKey && !e.shiftKey && lower === 'o') {
    e.preventDefault()
    if (!store.busy) toolbar.value?.openFile()
    return
  }
  if (!mod && !e.altKey && !e.shiftKey && (lower === 'o' || lower === 'f')) {
    if (store.busy) return
    e.preventDefault()
    if (lower === 'o') toolbar.value?.openFile()
    else toolbar.value?.openScan()
    return
  }
  if (!store.hasDocument) return

  if (mod && !e.altKey) {
    // Undo/Redo: Strg/Cmd+Z, Strg/Cmd+Umschalt+Z, Strg+Y
    if (lower === 'z' || lower === 'y') {
      e.preventDefault()
      if (lower === 'y' || e.shiftKey) store.redo()
      else store.undo()
    } else if (lower === 'a') {
      e.preventDefault()
      store.setAllMarked(!e.shiftKey)
    } else if (lower === 'd' && store.selectedAnnotationId) {
      e.preventDefault()
      store.duplicateSelectedAnnotation()
    }
    return
  }

  const page = store.selectedPage
  if (e.altKey) {
    // Alt+↑/↓: Seite verschieben
    if (!mod && page && (key === 'ArrowUp' || key === 'ArrowDown')) {
      e.preventDefault()
      const from = store.selectedPageIndex
      const to = from + (key === 'ArrowUp' ? -1 : 1)
      if (to >= 0 && to < store.pages.length) store.movePage(from, to)
    }
    return
  }

  if (key === 'Delete' || key === 'Backspace') {
    if (e.shiftKey && page) {
      e.preventDefault()
      store.removePage(page.id)
    } else if (page && store.selectedAnnotationId) {
      e.preventDefault()
      store.removeAnnotation(page.id, store.selectedAnnotationId)
    }
    return
  }
  if (key === 'Escape') {
    store.selectedAnnotationId = null
    return
  }
  const arrows: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  }
  const dir = arrows[key]
  if (dir && store.selectedAnnotationId) {
    e.preventDefault()
    const step = e.shiftKey ? 10 : 1
    nudgeSelected(dir[0] * step, dir[1] * step)
    return
  }
  if (key === 'ArrowDown' || key === 'PageDown') {
    e.preventDefault()
    selectPageAt(store.selectedPageIndex + 1)
    return
  }
  if (key === 'ArrowUp' || key === 'PageUp') {
    e.preventDefault()
    selectPageAt(store.selectedPageIndex - 1)
    return
  }
  if (key === 'Home' || key === 'End') {
    e.preventDefault()
    selectPageAt(key === 'Home' ? 0 : store.pages.length - 1)
    return
  }
  if (key === '+' || key === '=') {
    store.setZoom(store.zoom + 0.25)
    return
  }
  if (key === '-' || key === '−') {
    store.setZoom(store.zoom - 0.25)
    return
  }
  if (key === '0') {
    store.setZoom(1)
    return
  }
  if (e.shiftKey) {
    if (lower === 'l' && page) store.rotatePage(page.id, 'ccw')
    else if (lower === 'r' && page) store.rotatePage(page.id, 'cw')
    else if (lower === 's') showSignature.value = true
    return
  }
  if (lower === 'p' && !store.busy) {
    openOutput('print')
    return
  }
  if (lower === 'm' && page) {
    store.toggleMarked(page.id)
    return
  }
  if (lower === 'b' && !store.busy) {
    toolbar.value?.openImage()
    return
  }
  const tool = toolKeys[lower]
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
    class="pdf-editor-shell"
    :data-appearance="appearance"
    @dragover="onDragOver"
    @dragleave.self="dropActive = false"
    @drop="onDrop"
  >
    <div class="pdf-editor-appearance">
      <label for="pdf-editor-appearance">Darstellung</label>
      <select id="pdf-editor-appearance" v-model="appearance">
        <option value="dark">Dunkel</option>
        <option value="light">Hell</option>
        <option value="system">System</option>
      </select>
    </div>

    <AppToolbar
      class="pdf-editor-toolbar"
      ref="toolbar"
      @open-files="openFiles"
      @help="showHelp = true"
      @export="openOutput('export')"
      @print="openOutput('print')"
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

    <div class="pdf-editor-workspace">
      <PageSidebar v-if="store.hasDocument" class="pdf-editor-pages" />

      <main class="pdf-editor-desk">
        <div v-if="store.selectedPage" class="pdf-editor-paper-row">
          <PageEditor
            :key="store.selectedPage.id"
            :page="store.selectedPage"
            @request-signature="showSignature = true"
          />
        </div>

        <div v-else class="pdf-editor-empty">
          <div class="pdf-editor-drop-card">
            <h2>PDF hierher ziehen</h2>
            <p class="pdf-editor-drop-description">
              oder oben „PDF öffnen“ wählen. Mehrere Dateien werden zusammengeführt.
              <template v-if="isPrivate">
                Die Datei bleibt im Browser; nur für KI-Vorschläge wird Seitentext an Claude
                gesendet.
              </template>
              <template v-else>Alles läuft lokal im Browser, nichts wird hochgeladen.</template>
            </p>
            <p v-if="store.busy" class="pdf-editor-drop-loading">Lade…</p>
          </div>
        </div>

        <div v-if="dropActive" class="pdf-editor-drop-active">Loslassen zum Hinzufügen</div>
      </main>

      <component
        :is="PrivatePanel"
        v-if="PrivatePanel && store.hasDocument"
        class="pdf-editor-private"
      />
    </div>

    <SignatureDialog v-if="showSignature" @save="onSignatureSaved" @cancel="onSignatureCancel" />
    <ShortcutHelp v-if="showHelp" :groups="shortcutGroups" @close="showHelp = false" />
    <ExportDialog
      v-if="showExport && store.hasDocument"
      :mode="outputMode"
      @close="showExport = false"
    />
  </div>
</template>
