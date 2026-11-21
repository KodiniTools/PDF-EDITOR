/**
 * „Fragen zum Dokument“ (nur privater Build): sammelt den Text aller Seiten und
 * führt mit dem Backend ein Gespräch darüber (Zusammenfassung, Fristen, …).
 */
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import type { TextLine } from '@/lib/textLines'
import { useDocumentStore } from '@/stores/document'

import { requestAnswer, type ChatMessage } from '../ask/api'
import { SuggestApiError, type PagePayload } from '../suggestions/api'
import { useOcrStore } from './ocr'

/**
 * Zeichen Dokumenttext pro Anfrage. Backend erlaubt 400 000 Zeichen, nginx und
 * Backend aber nur 1 MB Body – zusammen mit dem Verlauf (MAX_HISTORY_CHARS) und
 * Umlauten (2 Byte) bleibt die Anfrage so deutlich darunter.
 */
export const MAX_ASK_CHARS = 300_000
/** Zeichen früherer Fragen/Antworten pro Anfrage; ältere Paare fallen weg. */
export const MAX_HISTORY_CHARS = 120_000
/** Backend erlaubt 40 Nachrichten → höchstens 19 frühere Frage/Antwort-Paare. */
export const MAX_HISTORY_PAIRS = 19
/** Backend erlaubt frühere Antworten bis 16 000 Zeichen. */
const MAX_ANSWER_CHARS = 16_000
export const MAX_QUESTION_CHARS = 4_000

export interface AskEntry extends ChatMessage {
  id: number
}

/** Kürzt den Dokumenttext auf `maxChars` (ganze Zeilen, Seiten in Reihenfolge). */
export function limitPages(
  pages: readonly PagePayload[],
  maxChars: number,
): { pages: PagePayload[]; truncated: boolean } {
  const out: PagePayload[] = []
  let size = 0
  for (const p of pages) {
    const lines: string[] = []
    for (const l of p.lines) {
      if (size + l.length + 1 > maxChars) {
        if (lines.length > 0) out.push({ page: p.page, lines })
        return { pages: out, truncated: true }
      }
      lines.push(l)
      size += l.length + 1
    }
    out.push({ page: p.page, lines })
  }
  return { pages: out, truncated: false }
}

/** Verlauf für die Anfrage: letzte Paare + neue Frage, Antworten gekürzt. */
export function buildMessages(history: readonly ChatMessage[], question: string): ChatMessage[] {
  let recent = history.slice(-MAX_HISTORY_PAIRS * 2).map((m) => ({
    role: m.role,
    content: m.role === 'assistant' ? m.content.slice(0, MAX_ANSWER_CHARS) : m.content,
  }))
  // Muss mit einer Frage beginnen (Backend prüft die Reihenfolge).
  if (recent[0]?.role === 'assistant') recent = recent.slice(1)
  let size = recent.reduce((n, m) => n + m.content.length, 0)
  while (size > MAX_HISTORY_CHARS && recent.length >= 2) {
    size -= (recent[0]?.content.length ?? 0) + (recent[1]?.content.length ?? 0)
    recent = recent.slice(2)
  }
  return [...recent, { role: 'user', content: question }]
}

export const useAskStore = defineStore('ask', () => {
  const doc = useDocumentStore()
  const ocr = useOcrStore()

  const entries = ref<AskEntry[]>([])
  const pending = ref<string | null>(null)
  const error = ref<string | null>(null)
  const pagesWithoutText = ref(0)
  const truncated = ref(false)
  /** Seiten, deren Text per Bilderkennung (Scan) gelesen wurde. */
  const ocrPages = ref(0)
  const ocrError = ref<string | null>(null)
  /** Fortschritt beim ersten Lesen gescannter Seiten. */
  const reading = ref<{ done: number; total: number } | null>(null)
  const busy = computed(() => pending.value !== null)
  let controller: AbortController | null = null
  let nextId = 1

  async function collectPages(signal: AbortSignal): Promise<PagePayload[] | null> {
    const payload: PagePayload[] = []
    let empty = 0
    let scanned = 0
    ocrError.value = null
    const pages = [...doc.pages]
    for (const [index, page] of pages.entries()) {
      let lines: TextLine[] = []
      try {
        // Scans per Bilderkennung (gecacht, daher nur bei der ersten Frage langsam).
        reading.value = { done: index, total: pages.length }
        const result = await ocr.linesFor(page, signal, { ocr: true })
        if (result.source === 'ocr') scanned++
        lines = result.lines
      } catch (err) {
        if (signal.aborted) return null
        console.error('[pdf-editor] Bilderkennung fehlgeschlagen', err)
        ocrError.value =
          err instanceof SuggestApiError ? err.message : 'Bilderkennung fehlgeschlagen.'
      }
      if (signal.aborted) return null
      const text = lines.map((l) => l.text).filter((t) => t.trim() !== '')
      if (text.length === 0) {
        empty++
        continue
      }
      payload.push({ page: index + 1, lines: text })
    }
    reading.value = null
    pagesWithoutText.value = empty
    ocrPages.value = scanned
    return payload
  }

  /**
   * Stellt eine Frage. Bei Fehler bleibt der Verlauf unverändert und die Frage
   * wird zurückgegeben (zum erneuten Senden); bei Erfolg `null`.
   */
  async function ask(question: string): Promise<string | null> {
    const q = question.trim().slice(0, MAX_QUESTION_CHARS)
    if (!q || busy.value || !doc.hasDocument) return question

    controller = new AbortController()
    const { signal } = controller
    pending.value = q
    error.value = null
    try {
      const all = await collectPages(signal)
      if (!all) return question
      if (all.length === 0) {
        error.value = 'Das Dokument enthält keinen erkennbaren Text.'
        return question
      }
      const limited = limitPages(all, MAX_ASK_CHARS)
      truncated.value = limited.truncated
      const answer = await requestAnswer(limited.pages, buildMessages(entries.value, q), signal)
      if (signal.aborted) return question
      entries.value.push(
        { id: nextId++, role: 'user', content: q },
        { id: nextId++, role: 'assistant', content: answer },
      )
      return null
    } catch (err) {
      if (signal.aborted) return question
      console.error('[pdf-editor] Frage fehlgeschlagen', err)
      error.value =
        err instanceof SuggestApiError ? err.message : 'Anfrage fehlgeschlagen (Text nicht lesbar).'
      return question
    } finally {
      if (controller?.signal === signal) {
        controller = null
        pending.value = null
      }
    }
  }

  function cancel(): void {
    controller?.abort()
    controller = null
    pending.value = null
    reading.value = null
  }

  function clear(): void {
    cancel()
    entries.value = []
    error.value = null
    pagesWithoutText.value = 0
    ocrPages.value = 0
    ocrError.value = null
    truncated.value = false
  }

  // Dokument geschlossen → Gespräch gehört nicht mehr dazu.
  watch(
    () => doc.hasDocument,
    (has) => {
      if (!has) clear()
    },
  )

  return {
    entries,
    pending,
    error,
    pagesWithoutText,
    truncated,
    ocrPages,
    ocrError,
    reading,
    busy,
    ask,
    cancel,
    clear,
  }
})
