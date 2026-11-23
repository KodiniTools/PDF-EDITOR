<script setup lang="ts">
/** Seitenleiste „Fragen zum Dokument“ (nur privater Build). */
import { nextTick, ref, watch } from 'vue'

import { splitPageRefs } from '@/private/ask/pageRefs'
import { MAX_QUESTION_CHARS, useAskStore } from '@/private/stores/ask'
import { useDocumentStore } from '@/stores/document'

const doc = useDocumentStore()
const ask = useAskStore()
const input = ref('')
const list = ref<HTMLElement | null>(null)

const QUICK = [
  {
    label: 'Zusammenfassen',
    question: 'Fasse das Dokument kurz zusammen: Worum geht es, wer ist beteiligt, was ist zu tun?',
  },
  {
    label: 'Fristen & Termine',
    question:
      'Welche Fristen, Termine und Daten nennt das Dokument? Bitte als Liste mit Seitenangabe.',
  },
  {
    label: 'Beträge',
    question: 'Welche Geldbeträge, Kosten und Zahlungsbedingungen nennt das Dokument?',
  },
  { label: 'Kündigung', question: 'Was regelt das Dokument zu Kündigung, Laufzeit und Widerruf?' },
] as const

async function send(question: string): Promise<void> {
  if (!question.trim() || ask.busy) return
  input.value = ''
  const rest = await ask.ask(question)
  // Bei Fehler/Abbruch Frage zurück ins Eingabefeld, sofern dort nichts Neues steht.
  if (rest !== null && input.value === '') input.value = rest
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    void send(input.value)
  }
}

function goToPage(n: number): void {
  const page = doc.pages[n - 1]
  if (page) doc.selectPage(page.id)
}

watch(
  () => [ask.entries.length, ask.pending],
  async () => {
    await nextTick()
    if (list.value) list.value.scrollTop = list.value.scrollHeight
  },
)
</script>

<template>
  <section
    class="flex min-h-0 flex-1 flex-col"
    aria-label="Fragen zum Dokument"
    data-testid="ask-panel"
  >
    <div class="border-b pdf-control-border p-3">
      <p class="text-xs pdf-control-muted">
        Der Text aller Seiten (bei Scans einmalig das Seitenbild) wird an Claude (Anthropic)
        gesendet. Antworten können Fehler enthalten – wichtige Stellen im Dokument prüfen.
      </p>
      <div class="mt-2 flex flex-wrap gap-1">
        <button
          v-for="q in QUICK"
          :key="q.label"
          type="button"
          class="pn-chip"
          :disabled="ask.busy"
          @click="send(q.question)"
        >
          {{ q.label }}
        </button>
      </div>
    </div>

    <div ref="list" class="min-h-0 flex-1 space-y-3 overflow-auto p-3" aria-live="polite">
      <p v-if="ask.entries.length === 0 && !ask.pending" class="text-xs pdf-control-muted">
        Stelle eine Frage zum Dokument, z. B. „Bis wann muss ich zahlen?“
      </p>
      <div
        v-for="m in ask.entries"
        :key="m.id"
        :class="m.role === 'user' ? 'pn-q pdf-control-info-bg' : 'pn-a pdf-control-raised'"
        :data-testid="m.role === 'user' ? 'ask-question' : 'ask-answer'"
      >
        <template v-if="m.role === 'user'">{{ m.content }}</template>
        <template v-else>
          <template v-for="(part, i) in splitPageRefs(m.content, doc.pages.length)" :key="i">
            <button
              v-if="part.kind === 'page'"
              type="button"
              class="pdf-control-info underline pdf-control-info-hover"
              :title="`Zu Seite ${part.page}`"
              @click="goToPage(part.page)"
            >
              {{ part.label }}
            </button>
            <template v-else>{{ part.text }}</template>
          </template>
        </template>
      </div>
      <template v-if="ask.pending">
        <div class="pn-q pdf-control-info-bg">{{ ask.pending }}</div>
        <div class="flex items-center justify-between pdf-control-info">
          <span>
            <template v-if="ask.reading && ask.reading.total > 1">
              Lese Seite {{ ask.reading.done + 1 }} von {{ ask.reading.total }}…
            </template>
            <template v-else>Claude liest das Dokument…</template>
          </span>
          <button type="button" class="underline" @click="ask.cancel()">Abbrechen</button>
        </div>
      </template>
      <p v-if="ask.error" role="alert" class="pdf-control-error">{{ ask.error }}</p>
      <p v-if="ask.ocrPages > 0" class="text-xs pdf-control-muted">
        {{ ask.ocrPages }} gescannte Seite(n) per Bilderkennung gelesen.
      </p>
      <p v-if="ask.ocrError" class="text-xs pdf-control-warning">
        Bilderkennung teilweise fehlgeschlagen: {{ ask.ocrError }}
      </p>
      <p v-if="ask.pagesWithoutText > 0" class="text-xs pdf-control-warning">
        {{ ask.pagesWithoutText }} Seite(n) ohne erkennbaren Text wurden nicht berücksichtigt.
      </p>
      <p v-if="ask.truncated" class="text-xs pdf-control-warning">
        Das Dokument ist sehr lang; nur der Anfang wurde berücksichtigt.
      </p>
    </div>

    <form class="border-t pdf-control-border p-3" @submit.prevent="send(input)">
      <textarea
        v-model="input"
        rows="3"
        :maxlength="MAX_QUESTION_CHARS"
        class="w-full resize-none rounded-md border pdf-control-border p-2 text-sm pdf-control-focus-border focus:outline-none"
        placeholder="Frage stellen… (Enter senden, Umschalt+Enter neue Zeile)"
        aria-label="Frage zum Dokument"
        data-testid="ask-input"
        @keydown="onKeydown"
      />
      <div class="mt-2 flex gap-2">
        <button
          type="button"
          class="pn-btn"
          :disabled="ask.busy || ask.entries.length === 0"
          @click="ask.clear()"
        >
          Neu
        </button>
        <button
          type="submit"
          class="pn-btn pn-primary flex-1"
          :disabled="ask.busy || !input.trim()"
          data-testid="ask-send"
        >
          Fragen
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
@reference 'tailwindcss';

.pn-btn {
  @apply rounded-md border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50;
}
.pn-chip {
  @apply rounded-full border px-2 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-50;
}
.pn-q {
  @apply ml-6 rounded-lg px-3 py-2 whitespace-pre-wrap;
}
.pn-a {
  @apply mr-2 rounded-lg px-3 py-2 break-words whitespace-pre-wrap;
}
</style>
