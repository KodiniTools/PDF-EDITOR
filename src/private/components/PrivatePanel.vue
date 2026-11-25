<script setup lang="ts">
/** Rechte Seitenleiste des privaten Builds: Schwärzen, Fragen, Formular, Bilder, Text. */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { isMod, isPlainKey, isTypingTarget, modalOpen } from '@/lib/shortcuts'
import { useDocumentStore } from '@/stores/document'

import AskPanel from './AskPanel.vue'
import FormPanel from './FormPanel.vue'
import ImagePanel from './ImagePanel.vue'
import RedactionPanel from './RedactionPanel.vue'
import TextPanel from './TextPanel.vue'

type Tab = 'redact' | 'ask' | 'form' | 'images' | 'text'
const TABS: { id: Tab; label: string }[] = [
  { id: 'redact', label: 'Schwärzen' },
  { id: 'ask', label: 'Fragen' },
  { id: 'form', label: 'Formular' },
  { id: 'images', label: 'Bilder' },
  { id: 'text', label: 'Text' },
]
const tab = ref<Tab>('redact')
const root = ref<HTMLElement | null>(null)
const store = useDocumentStore()

// Klick auf einen eingefügten Text: Reiter „Text“ öffnen (ohne den Fokus zu verschieben).
watch(
  () => (store.selectedAnnotation?.kind === 'text' ? store.selectedAnnotation.id : null),
  (id) => {
    if (id) tab.value = 'text'
  },
)

/** Klickt den Button mit data-shortcut im sichtbaren Reiter, falls aktiv. */
function clickAction(kind: 'primary' | 'secondary' | 'apply'): boolean {
  const panel = root.value?.querySelector(`#private-panel-${tab.value}`)
  const btn = panel?.querySelector<HTMLButtonElement>(`[data-shortcut="${kind}"]`)
  if (!btn || btn.disabled) return false
  btn.click()
  return true
}

async function selectTab(id: Tab): Promise<void> {
  tab.value = id
  if (id === 'ask' || id === 'text') {
    await nextTick()
    root.value?.querySelector<HTMLTextAreaElement>(`#private-panel-${id} textarea`)?.focus()
  }
}

function onKey(e: KeyboardEvent): void {
  if (modalOpen()) return
  // Strg+Enter (+Umschalt/+Alt): Aktionen des Reiters – nicht aus fremden Textfeldern.
  if (isMod(e) && e.key === 'Enter') {
    if (isTypingTarget(e.target) && !root.value?.contains(e.target as Node)) return
    const kind = e.altKey ? 'apply' : e.shiftKey ? 'secondary' : 'primary'
    if (clickAction(kind)) e.preventDefault()
    return
  }
  if (!isPlainKey(e) || e.shiftKey) return
  const index = ['1', '2', '3', '4', '5'].indexOf(e.key)
  const id = TABS[index]?.id
  if (id) {
    e.preventDefault()
    void selectTab(id)
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <aside
    ref="root"
    class="flex w-80 shrink-0 flex-col border-l pdf-control-border pdf-control-surface text-sm"
    aria-label="KI-Werkzeuge"
  >
    <div role="tablist" class="flex border-b pdf-control-border">
      <button
        v-for="t in TABS"
        :id="`private-tab-${t.id}`"
        :key="t.id"
        type="button"
        role="tab"
        :aria-selected="tab === t.id"
        :aria-controls="`private-panel-${t.id}`"
        class="flex-1 px-1 py-2"
        :class="
          tab === t.id
            ? 'border-b-2 pdf-control-accent-border pdf-control-info'
            : 'pdf-control-muted pdf-control-text-hover'
        "
        :data-testid="`private-tab-${t.id}`"
        :title="`${t.label} (${TABS.indexOf(t) + 1})`"
        @click="tab = t.id"
      >
        {{ t.label }}
      </button>
    </div>
    <!-- v-show: Zustand (laufende Analyse, Eingabe) bleibt beim Tabwechsel erhalten. -->
    <div
      v-show="tab === 'redact'"
      id="private-panel-redact"
      role="tabpanel"
      aria-labelledby="private-tab-redact"
      class="flex min-h-0 flex-1 flex-col"
    >
      <RedactionPanel />
    </div>
    <div
      v-show="tab === 'ask'"
      id="private-panel-ask"
      role="tabpanel"
      aria-labelledby="private-tab-ask"
      class="flex min-h-0 flex-1 flex-col"
    >
      <AskPanel />
    </div>
    <div
      v-show="tab === 'form'"
      id="private-panel-form"
      role="tabpanel"
      aria-labelledby="private-tab-form"
      class="flex min-h-0 flex-1 flex-col"
    >
      <FormPanel />
    </div>
    <div
      v-show="tab === 'images'"
      id="private-panel-images"
      role="tabpanel"
      aria-labelledby="private-tab-images"
      class="flex min-h-0 flex-1 flex-col"
    >
      <ImagePanel :active="tab === 'images'" />
    </div>
    <div
      v-show="tab === 'text'"
      id="private-panel-text"
      role="tabpanel"
      aria-labelledby="private-tab-text"
      class="flex min-h-0 flex-1 flex-col"
    >
      <TextPanel />
    </div>
  </aside>
</template>
