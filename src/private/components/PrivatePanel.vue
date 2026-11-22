<script setup lang="ts">
/** Rechte Seitenleiste des privaten Builds: KI-Schwärzung und Fragen zum Dokument. */
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import { isMod, isPlainKey, isTypingTarget, modalOpen } from '@/lib/shortcuts'

import AskPanel from './AskPanel.vue'
import FormPanel from './FormPanel.vue'
import ImagePanel from './ImagePanel.vue'
import RedactionPanel from './RedactionPanel.vue'

type Tab = 'redact' | 'ask' | 'form' | 'images'
const TABS: { id: Tab; label: string }[] = [
  { id: 'redact', label: 'Schwärzen' },
  { id: 'ask', label: 'Fragen' },
  { id: 'form', label: 'Formular' },
  { id: 'images', label: 'Bilder' },
]
const tab = ref<Tab>('redact')
const root = ref<HTMLElement | null>(null)

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
  if (id === 'ask') {
    await nextTick()
    root.value?.querySelector<HTMLTextAreaElement>('#private-panel-ask textarea')?.focus()
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
  const index = ['1', '2', '3', '4'].indexOf(e.key)
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
    class="flex w-80 shrink-0 flex-col border-l border-gray-200 bg-white text-sm"
    aria-label="KI-Werkzeuge"
  >
    <div role="tablist" class="flex border-b border-gray-200">
      <button
        v-for="t in TABS"
        :id="`private-tab-${t.id}`"
        :key="t.id"
        type="button"
        role="tab"
        :aria-selected="tab === t.id"
        :aria-controls="`private-panel-${t.id}`"
        class="flex-1 px-2 py-2 font-medium"
        :class="
          tab === t.id
            ? 'border-b-2 border-blue-600 text-blue-700'
            : 'text-gray-500 hover:text-gray-800'
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
  </aside>
</template>
