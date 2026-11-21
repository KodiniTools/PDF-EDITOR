/**
 * KI-Schwärzungsvorschläge (nur privater Build): Seitentext sammeln, beim Backend
 * analysieren lassen, Fundstellen auf der Seite verorten, vom Nutzer bestätigen lassen
 * und als echte Schwärzungen (cover + redact) in den Dokument-Store übernehmen.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { normalizeRotation } from '@/lib/geometry'
import { createId } from '@/lib/id'
import type { TextLine } from '@/lib/textLines'
import { getTextLines } from '@/services/pdfRenderer'
import { useDocumentStore } from '@/stores/document'
import type { PageRef, Rotation } from '@/types/pdf'

import { requestSuggestions, SuggestApiError, type PagePayload } from '../suggestions/api'
import type { Category } from '../suggestions/categories'
import { coverage, locateText, type Rect } from '../suggestions/locate'
import { getMeasure } from '../suggestions/measure'

/** Zeichen pro Anfrage (Backend erlaubt 60 000). */
export const MAX_CHARS_PER_REQUEST = 40_000

export interface Suggestion {
  id: string
  pageId: string
  /** Drehung der Seite, für die `rects` berechnet wurden. */
  rotation: Rotation
  text: string
  category: Category
  reason: string
  rects: Rect[]
  selected: boolean
}

export type AnalyzeScope = 'page' | 'all'

function totalRotation(p: PageRef): Rotation {
  return normalizeRotation(p.baseRotation + p.rotation)
}

/** Teilt Seiten so auf, dass jede Anfrage unter `maxChars` bleibt (mind. 1 Seite). */
export function batchPages(pages: readonly PagePayload[], maxChars: number): PagePayload[][] {
  const batches: PagePayload[][] = []
  let current: PagePayload[] = []
  let size = 0
  for (const p of pages) {
    let lines = p.lines
    let chars = lines.reduce((n, l) => n + l.length + 1, 0)
    if (chars > maxChars) {
      // Einzelne Riesenseite: kürzen statt scheitern (Hinweis über `truncated`).
      const kept: string[] = []
      let n = 0
      for (const l of lines) {
        if (n + l.length + 1 > maxChars) break
        kept.push(l)
        n += l.length + 1
      }
      lines = kept
      chars = n
    }
    if (current.length > 0 && size + chars > maxChars) {
      batches.push(current)
      current = []
      size = 0
    }
    current.push({ page: p.page, lines })
    size += chars
  }
  if (current.length > 0) batches.push(current)
  return batches
}

export const useRedactionStore = defineStore('redaction', () => {
  const doc = useDocumentStore()

  const suggestions = ref<Suggestion[]>([])
  const status = ref<'idle' | 'loading' | 'done' | 'error'>('idle')
  const error = ref<string | null>(null)
  const progress = ref({ done: 0, total: 0 })
  /** Seiten ohne erkennbaren Text (z. B. Scans) beim letzten Lauf. */
  const pagesWithoutText = ref(0)
  /** Seiten, deren Text für die Anfrage gekürzt werden musste. */
  const truncatedPages = ref(0)
  let controller: AbortController | null = null

  /** Vorschläge, deren Seite noch existiert und unverändert gedreht ist. */
  const valid = computed(() =>
    suggestions.value.filter((s) => {
      const page = doc.pages.find((p) => p.id === s.pageId)
      return page !== undefined && totalRotation(page) === s.rotation
    }),
  )
  const selectedCount = computed(() => valid.value.filter((s) => s.selected).length)
  const busy = computed(() => status.value === 'loading')

  function forPage(pageId: string): Suggestion[] {
    return valid.value.filter((s) => s.pageId === pageId)
  }

  /** Wahr, wenn eine Stelle schon von einer echten Schwärzung abgedeckt ist. */
  function alreadyRedacted(page: PageRef, rect: Rect): boolean {
    return page.annotations.some(
      (a) => a.kind === 'cover' && a.redact === true && coverage(rect, a) > 0.8,
    )
  }

  async function analyze(scope: AnalyzeScope): Promise<void> {
    if (busy.value) return
    const targets = scope === 'page' ? (doc.selectedPage ? [doc.selectedPage] : []) : [...doc.pages]
    if (targets.length === 0) return

    controller = new AbortController()
    const { signal } = controller
    status.value = 'loading'
    error.value = null
    pagesWithoutText.value = 0
    truncatedPages.value = 0
    progress.value = { done: 0, total: 0 }

    try {
      // 1. Text je Seite (aus dem pdf.js-Cache) – Seitennummer = Position in der Liste.
      const linesById = new Map<string, TextLine[]>()
      const payload: PagePayload[] = []
      const pageByNumber = new Map<number, PageRef>()
      for (const page of targets) {
        const lines = await getTextLines(page.sourceId, page.sourceIndex, totalRotation(page))
        if (signal.aborted) return
        linesById.set(page.id, lines)
        if (lines.length === 0) {
          pagesWithoutText.value++
          continue
        }
        const number = doc.pages.indexOf(page) + 1
        pageByNumber.set(number, page)
        payload.push({ page: number, lines: lines.map((l) => l.text) })
      }

      // Alte Vorschläge der geprüften Seiten ersetzen.
      const checked = new Set(targets.map((p) => p.id))
      suggestions.value = suggestions.value.filter((s) => !checked.has(s.pageId))

      const batches = batchPages(payload, MAX_CHARS_PER_REQUEST)
      truncatedPages.value = batches
        .flat()
        .filter(
          (b) => b.lines.length < (payload.find((p) => p.page === b.page)?.lines.length ?? 0),
        ).length
      progress.value = { done: 0, total: batches.length }

      // 2. Nacheinander abfragen (Backend begrenzt parallele Analysen).
      for (const batch of batches) {
        const findings = await requestSuggestions(batch, signal)
        for (const f of findings) {
          const page = pageByNumber.get(f.page)
          if (!page) continue
          // Seite inzwischen gedreht/gelöscht → Positionen passen nicht mehr.
          const rotation = totalRotation(page)
          const rects = locateText(linesById.get(page.id) ?? [], f.text, getMeasure()).filter(
            (r) => !alreadyRedacted(page, r),
          )
          if (rects.length === 0) continue
          suggestions.value.push({
            id: createId('sug'),
            pageId: page.id,
            rotation,
            text: f.text,
            category: f.category,
            reason: f.reason,
            rects,
            selected: true,
          })
        }
        progress.value = { done: progress.value.done + 1, total: batches.length }
      }
      status.value = 'done'
    } catch (err) {
      if (signal.aborted) {
        status.value = 'idle'
        return
      }
      console.error('[pdf-editor] KI-Analyse fehlgeschlagen', err)
      error.value =
        err instanceof SuggestApiError ? err.message : 'Analyse fehlgeschlagen (Text nicht lesbar).'
      status.value = 'error'
    } finally {
      if (controller?.signal === signal) controller = null
    }
  }

  function cancel(): void {
    controller?.abort()
    controller = null
    if (status.value === 'loading') status.value = 'idle'
  }

  function toggle(id: string): void {
    const s = suggestions.value.find((x) => x.id === id)
    if (s) s.selected = !s.selected
  }

  function selectAll(selected: boolean): void {
    for (const s of valid.value) s.selected = selected
  }

  function dismiss(id: string): void {
    suggestions.value = suggestions.value.filter((s) => s.id !== id)
  }

  /**
   * Übernimmt die ausgewählten Vorschläge als echte Schwärzungen
   * (ein Undo-Schritt für alle). Liefert die Anzahl angelegter Flächen.
   */
  function applySelected(): number {
    const chosen = valid.value.filter((s) => s.selected)
    if (chosen.length === 0) return 0
    const group = doc.newGroup('redact-ai')
    let count = 0
    for (const s of chosen) {
      for (const r of s.rects) {
        const id = doc.addAnnotation(
          s.pageId,
          { kind: 'cover', redact: true, color: '#000000', ...r },
          group,
        )
        if (id) count++
      }
    }
    doc.closeHistoryGroup()
    doc.selectedAnnotationId = null
    const applied = new Set(chosen.map((s) => s.id))
    suggestions.value = suggestions.value.filter((s) => !applied.has(s.id))
    return count
  }

  function clear(): void {
    cancel()
    suggestions.value = []
    status.value = 'idle'
    error.value = null
  }

  return {
    suggestions,
    valid,
    status,
    error,
    progress,
    pagesWithoutText,
    truncatedPages,
    selectedCount,
    busy,
    forPage,
    analyze,
    cancel,
    toggle,
    selectAll,
    dismiss,
    applySelected,
    clear,
  }
})
