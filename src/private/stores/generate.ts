/**
 * „Neues Dokument“: leere Seiten im gewählten Format oder Inhalt von Claude.
 * Das erzeugte PDF wird wie eine geöffnete Datei in den Editor geladen
 * (bei offenem Dokument angehängt, per Rückgängig entfernbar).
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

import { useDocumentStore } from '@/stores/document'

import { requestDocument, type GenerateInput } from '../generate/api'
import { renderDocument, renderEmpty } from '../generate/render'
import type { Orientation, PageFormat } from '../generate/types'

export interface CreateOptions {
  format: PageFormat
  orientation: Orientation
  /** Nur für leere Dokumente. */
  pages: number
}

/** Pfad- und Steuerzeichen, die in Dateinamen stören. */
const UNSAFE_FILENAME = /[\\/:*?"<>|]+/g
const stripControls = (s: string) =>
  [...s].map((ch) => (ch.charCodeAt(0) < 0x20 ? ' ' : ch)).join('')

/** Dateiname aus dem Titel (ohne Pfadzeichen, max. 80 Zeichen). */
export function fileNameFor(title: string): string {
  const base = stripControls(title)
    .replace(UNSAFE_FILENAME, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${base || 'Neues Dokument'}.pdf`
}

export const useGenerateStore = defineStore('privateGenerate', () => {
  const busy = ref(false)
  const error = ref<string | null>(null)
  let controller: AbortController | null = null

  async function open(bytes: Uint8Array, title: string): Promise<boolean> {
    const doc = useDocumentStore()
    const file = new File([bytes as BlobPart], fileNameFor(title), { type: 'application/pdf' })
    const before = doc.pages.length
    const result = await doc.addFiles([file])
    if (result.added === 0) {
      error.value = result.errors.join('\n') || 'Das Dokument konnte nicht geöffnet werden.'
      return false
    }
    // Erste neue Seite anzeigen (auch wenn schon ein Dokument offen war).
    const first = doc.pages[before]
    if (first) doc.selectPage(first.id)
    return true
  }

  /** Leeres Dokument (ohne KI, ohne Kosten). */
  async function createEmpty(opts: CreateOptions): Promise<boolean> {
    if (busy.value) return false
    busy.value = true
    error.value = null
    try {
      return await open(await renderEmpty(opts), 'Neues Dokument')
    } catch (err) {
      console.error('[pdf-editor] Neues Dokument:', err)
      error.value = 'Das Dokument konnte nicht erstellt werden.'
      return false
    } finally {
      busy.value = false
    }
  }

  /** Inhalt von Claude im gewählten Modell, dann lokal gesetzt. */
  async function createWithAi(input: GenerateInput): Promise<boolean> {
    if (busy.value) return false
    busy.value = true
    error.value = null
    controller = new AbortController()
    try {
      const content = await requestDocument(input, controller.signal)
      const bytes = await renderDocument(content, input)
      return await open(bytes, content.title)
    } catch (err) {
      if (controller?.signal.aborted) return false
      console.error('[pdf-editor] Neues Dokument (KI):', err)
      error.value =
        err instanceof Error && err.name === 'SuggestApiError'
          ? err.message
          : 'Das Dokument konnte nicht erstellt werden.'
      return false
    } finally {
      busy.value = false
      controller = null
    }
  }

  function cancel(): void {
    controller?.abort()
  }

  return { busy, error, createEmpty, createWithAi, cancel }
})
