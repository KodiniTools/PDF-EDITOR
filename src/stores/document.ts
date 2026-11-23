import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { looksLikePdf, readFileBytes } from '@/lib/file'
import { placeOnPage, readImageFile, type LoadedImage } from '@/lib/image'
import { imageToPdf, imageTypeOf, looksLikeImage, SCAN_MAX_SIDE } from '@/lib/imagePdf'
import {
  displaySize,
  normalizeRotation,
  rotateAnnotation,
  TEXT_BASELINE_RATIO,
} from '@/lib/geometry'
import type { TextLine } from '@/lib/textLines'
import { t } from '@/i18n'
import { createId } from '@/lib/id'
import { createUndoHistory } from '@/lib/undoHistory'
import { exportPdf, PdfEditorError, validatePdf } from '@/services/pdfExport'
import { closeDocument, openDocument } from '@/services/pdfRenderer'
import type {
  Annotation,
  AnnotationPatch,
  NewAnnotation,
  PageRef,
  SourceDocument,
  Tool,
} from '@/types/pdf'

/** Maximale Dateigröße pro PDF (Schutz vor Speicherproblemen im Browser). */
export const MAX_FILE_BYTES = 100 * 1024 * 1024

/** Anzahl der Undo-Schritte. */
export const HISTORY_LIMIT = 50

export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 4

export interface AddFilesResult {
  added: number
  errors: string[]
}

function messageOf(err: unknown): string {
  if (err instanceof PdfEditorError) return err.message
  if (err instanceof Error && err.name === 'ImageError') return err.message
  return t('error.unknown')
}

export const useDocumentStore = defineStore('document', () => {
  // Rohdaten liegen außerhalb des reaktiven Systems (groß, unveränderlich).
  const sourceBytes = new Map<string, Uint8Array>()

  const sources = ref<SourceDocument[]>([])
  const pages = ref<PageRef[]>([])
  const selectedPageId = ref<string | null>(null)
  /**
   * In der Seitenleiste markierte Seiten (z. B. für den Export). Gehört nicht zum
   * Undo-Verlauf; gelöschte Seiten fallen über `markedPages` automatisch heraus.
   */
  const markedPageIds = ref<string[]>([])
  const selectedAnnotationId = ref<string | null>(null)
  const tool = ref<Tool>('select')
  const zoom = ref(1)
  const busy = ref(false)
  const error = ref<string | null>(null)
  /** Zuletzt erstellte Signatur, zur Wiederverwendung. */
  const signatureDataUrl = ref<string | null>(null)
  const textColor = ref('#111827')
  const highlightColor = ref('#facc15')
  const fontSize = ref(14)
  const coverColor = ref('#ffffff')
  /** Farbe neuer echter Schwärzungen (nur privater Build). */
  const redactColor = ref('#000000')

  const hasDocument = computed(() => pages.value.length > 0)
  const selectedPage = computed(
    () => pages.value.find((p) => p.id === selectedPageId.value) ?? null,
  )
  const selectedPageIndex = computed(() =>
    pages.value.findIndex((p) => p.id === selectedPageId.value),
  )
  const selectedAnnotation = computed<Annotation | null>(
    () => selectedPage.value?.annotations.find((a) => a.id === selectedAnnotationId.value) ?? null,
  )
  const suggestedFileName = computed(() => {
    // Nur Quellen, die aktuell verwendet werden (nicht nur im Undo-Verlauf).
    const used = new Set(pages.value.map((p) => p.sourceId))
    const active = sources.value.filter((s) => used.has(s.id))
    const first = active[0]?.name.replace(/\.(pdf|jpe?g|png|webp|gif)$/i, '') ?? t('file.baseName')
    return `${first}${active.length > 1 ? t('file.suffixMerged') : t('file.suffixEdited')}.pdf`
  })

  // ---- Undo/Redo ------------------------------------------------------------
  interface HistoryState {
    pages: PageRef[]
    selectedPageId: string | null
  }

  const history = createUndoHistory<HistoryState>({
    limit: HISTORY_LIMIT,
    read: () => ({ pages: pages.value, selectedPageId: selectedPageId.value }),
    write: (state) => {
      pages.value = state.pages
      selectedPageId.value =
        state.selectedPageId && state.pages.some((p) => p.id === state.selectedPageId)
          ? state.selectedPageId
          : (state.pages[0]?.id ?? null)
      if (!selectedAnnotation.value) selectedAnnotationId.value = null
    },
    refs: (state) => [...new Set(state.pages.map((p) => p.sourceId))],
    onChange: () => collectUnusedSources(),
  })

  let groupCounter = 0
  /** Neuer Schlüssel, um zusammengehörige Änderungen (Ziehen, Tippen) zu bündeln. */
  function newGroup(prefix: string): string {
    groupCounter += 1
    return `${prefix}:${groupCounter}`
  }

  /** Gibt Quellen frei, auf die weder aktuelle Seiten noch der Verlauf verweisen. */
  function collectUnusedSources(): void {
    const used = history.allRefs()
    for (const p of pages.value) used.add(p.sourceId)
    for (const s of sources.value) {
      if (!used.has(s.id)) void releaseSource(s.id)
    }
  }

  function undo(): boolean {
    if (busy.value) return false
    return history.undo()
  }

  function redo(): boolean {
    if (busy.value) return false
    return history.redo()
  }

  function findPage(pageId: string): PageRef | undefined {
    return pages.value.find((p) => p.id === pageId)
  }

  /** Lädt PDFs und hängt deren Seiten an (Mehrfachauswahl = Zusammenführen). */
  async function addFiles(files: readonly File[]): Promise<AddFilesResult> {
    if (files.length === 0) return { added: 0, errors: [] }
    return history.recordAsync(() => loadFiles(files))
  }

  async function loadFiles(files: readonly File[]): Promise<AddFilesResult> {
    const result: AddFilesResult = { added: 0, errors: [] }
    busy.value = true
    error.value = null
    try {
      for (const file of files) {
        const label = file.name || t('file.fallbackLabel')
        try {
          if (file.size > MAX_FILE_BYTES) {
            throw new PdfEditorError(t('error.fileTooLarge'))
          }
          let bytes = await readFileBytes(file)
          if (!looksLikePdf(bytes)) {
            // Scan/Foto: als A4-Seite übernehmen.
            const type = imageTypeOf(file)
            if (!looksLikeImage(type, bytes)) {
              throw new PdfEditorError(t('error.notPdfOrImage'))
            }
            const typed = file.type ? file : new File([bytes as BlobPart], label, { type })
            bytes = await imageToPdf(await readImageFile(typed, SCAN_MAX_SIDE))
          }
          await validatePdf(bytes)

          const id = createId('src')
          const infos = await openDocument(id, bytes)
          if (infos.length === 0) {
            await closeDocument(id)
            throw new PdfEditorError(t('error.noPages'))
          }
          sourceBytes.set(id, bytes)
          sources.value.push({ id, name: label, pageCount: infos.length })
          const newPages: PageRef[] = infos.map((info, index) => ({
            id: createId('page'),
            sourceId: id,
            sourceIndex: index,
            box: info.box,
            baseRotation: info.rotation,
            rotation: 0,
            annotations: [],
          }))
          pages.value.push(...newPages)
          if (!selectedPageId.value) selectedPageId.value = newPages[0]?.id ?? null
          result.added += newPages.length
        } catch (err) {
          console.error(`[pdf-editor] ${label}:`, err)
          result.errors.push(`${label}: ${messageOf(err)}`)
        }
      }
      if (result.errors.length > 0) error.value = result.errors.join('\n')
      return result
    } finally {
      busy.value = false
    }
  }

  /** Markierte Seiten in Dokumentreihenfolge (nur noch vorhandene). */
  const markedPages = computed(() => {
    const marked = new Set(markedPageIds.value)
    return pages.value.filter((p) => marked.has(p.id))
  })

  function toggleMarked(pageId: string): void {
    if (!findPage(pageId)) return
    markedPageIds.value = markedPageIds.value.includes(pageId)
      ? markedPageIds.value.filter((id) => id !== pageId)
      : [...markedPageIds.value, pageId]
  }

  function setAllMarked(marked: boolean): void {
    markedPageIds.value = marked ? pages.value.map((p) => p.id) : []
  }

  function selectPage(pageId: string): void {
    if (findPage(pageId)) {
      selectedPageId.value = pageId
      selectedAnnotationId.value = null
    }
  }

  function removePage(pageId: string): void {
    const index = pages.value.findIndex((p) => p.id === pageId)
    if (index < 0) return
    pages.value.splice(index, 1)
    if (selectedPageId.value === pageId) {
      const next = pages.value[index] ?? pages.value[index - 1] ?? null
      selectedPageId.value = next?.id ?? null
      selectedAnnotationId.value = null
    }
    // Die Quelle bleibt geladen, solange der Undo-Verlauf auf sie verweist
    // (siehe collectUnusedSources).
  }

  async function releaseSource(sourceId: string): Promise<void> {
    sourceBytes.delete(sourceId)
    sources.value = sources.value.filter((s) => s.id !== sourceId)
    try {
      await closeDocument(sourceId)
    } catch (err) {
      console.warn('[pdf-editor] closeDocument fehlgeschlagen', err)
    }
  }

  /** Dreht eine Seite um ±90°; Annotationen werden mitgeführt. */
  function rotatePage(pageId: string, direction: 'cw' | 'ccw'): void {
    const page = findPage(pageId)
    if (!page) return
    const oldSize = displaySize(page.box, normalizeRotation(page.baseRotation + page.rotation))
    page.annotations = page.annotations.map((a) => rotateAnnotation(a, oldSize, direction))
    page.rotation = normalizeRotation(page.rotation + (direction === 'cw' ? 90 : -90))
  }

  /** Verschiebt eine Seite von `from` nach `to` (Indizes in der aktuellen Liste). */
  function movePage(from: number, to: number): void {
    const len = pages.value.length
    if (from === to || from < 0 || to < 0 || from >= len || to >= len) return
    const [moved] = pages.value.splice(from, 1)
    if (moved) pages.value.splice(to, 0, moved)
  }

  function addAnnotation(pageId: string, annotation: NewAnnotation): string | null {
    const page = findPage(pageId)
    if (!page) return null
    const id = createId('ann')
    page.annotations.push({ ...annotation, id })
    selectedAnnotationId.value = id
    return id
  }

  function updateAnnotation(pageId: string, annotationId: string, patch: AnnotationPatch): void {
    const page = findPage(pageId)
    const a = page?.annotations.find((x) => x.id === annotationId)
    if (a) Object.assign(a, patch)
  }

  /** Entfernt eine Annotation; ein ersetzter Text nimmt seine Abdeckung mit. */
  function removeAnnotation(pageId: string, annotationId: string): void {
    const page = findPage(pageId)
    if (!page) return
    const target = page.annotations.find((a) => a.id === annotationId)
    const ids = new Set([annotationId])
    if (target?.kind === 'text' && target.coverId) ids.add(target.coverId)
    page.annotations = page.annotations.filter((a) => !ids.has(a.id))
    if (selectedAnnotationId.value && ids.has(selectedAnnotationId.value)) {
      selectedAnnotationId.value = null
    }
  }

  /**
   * Ersetzt eine vorhandene Textzeile: deckt sie weiß ab und legt an gleicher
   * Stelle eine editierbare Textannotation an. Liefert die ID des Textes;
   * existiert für die Zeile schon ein Ersatz, wird dieser zurückgegeben.
   */
  function replaceTextLine(pageId: string, line: TextLine): string | null {
    const page = findPage(pageId)
    if (!page) return null
    const existing = page.annotations.find((a) => a.kind === 'text' && a.replacesKey === line.key)
    if (existing) {
      selectedAnnotationId.value = existing.id
      return existing.id
    }
    const size = Math.max(4, Math.round(line.fontSize * 2) / 2)
    const pad = Math.max(0.5, line.fontSize * 0.12)
    const coverId = addAnnotation(pageId, {
      kind: 'cover',
      color: '#ffffff',
      // Privater Build: alte Zeile beim Export echt entfernen (MuPDF), nicht nur abdecken.
      ...(__PRIVATE__ ? { redact: true } : {}),
      x: line.x - pad,
      y: line.top - pad,
      width: line.width + 2 * pad,
      height: line.height + 2 * pad,
    })
    if (!coverId) return null
    return addAnnotation(pageId, {
      kind: 'text',
      text: line.text,
      fontSize: size,
      color: '#000000',
      font: line.font,
      // Grundlinie der Ersatzzeile auf die Originalgrundlinie legen.
      x: line.x,
      y: line.baseline - size * TEXT_BASELINE_RATIO,
      replacesKey: line.key,
      coverId,
    })
  }

  function setZoom(value: number): void {
    if (!Number.isFinite(value)) return
    zoom.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100))
  }

  function setTool(next: Tool): void {
    tool.value = next
    if (next !== 'select') selectedAnnotationId.value = null
  }

  /**
   * Exportiert das Dokument; mit `pageIds` nur diese Seiten (in Dokumentreihenfolge).
   */
  async function exportDocument(pageIds?: readonly string[]): Promise<Uint8Array> {
    busy.value = true
    error.value = null
    const wanted = pageIds ? new Set(pageIds) : null
    const exportPages = wanted ? pages.value.filter((p) => wanted.has(p.id)) : pages.value
    try {
      if (__PRIVATE__) {
        // Privater Build: echte Schwärzung (MuPDF, lazy geladen). Im öffentlichen
        // Build entfällt dieser Zweig samt Import vollständig.
        const [{ exportWithRedactions }, { useFormStore }] = await Promise.all([
          import('@/private/redaction/exportRedacted'),
          import('@/private/stores/forms'),
        ])
        const formValues = useFormStore().valuesForExport(exportPages)
        return (await exportWithRedactions(sourceBytes, exportPages, { formValues })).bytes
      }
      return await exportPdf(sourceBytes, exportPages)
    } catch (err) {
      console.error('[pdf-editor] Export fehlgeschlagen', err)
      error.value = t('error.exportFailed', { message: messageOf(err) })
      throw err
    } finally {
      busy.value = false
    }
  }

  /** Originalbytes einer geladenen Quelle (z. B. für die Bildsuche im privaten Build). */
  function sourceBytesFor(sourceId: string): Uint8Array | undefined {
    return sourceBytes.get(sourceId)
  }

  /** Fügt ein Bild zentriert auf der ausgewählten Seite ein und wählt es aus. */
  function addImage(image: LoadedImage): string | null {
    const page = selectedPage.value
    if (!page) return null
    const size = displaySize(page.box, normalizeRotation(page.baseRotation + page.rotation))
    const id = recorded.addAnnotation(page.id, {
      kind: 'image',
      dataUrl: image.dataUrl,
      ...placeOnPage(image, size),
    })
    tool.value = 'select'
    selectedAnnotationId.value = id
    return id
  }

  /**
   * Dupliziert die ausgewählte Annotation 10 pt versetzt und wählt die Kopie aus.
   * Eine Kopie ersetzt keine Originalzeile mehr (ohne replacesKey/coverId).
   */
  function duplicateSelectedAnnotation(): string | null {
    const page = selectedPage.value
    const a = selectedAnnotation.value
    if (!page || !a) return null
    const { id: _id, ...rest } = a
    const copy = { ...rest, x: a.x + 10, y: a.y + 10 } as NewAnnotation
    if (copy.kind === 'text') {
      delete copy.replacesKey
      delete copy.coverId
    }
    return recorded.addAnnotation(page.id, copy)
  }

  /** Löscht die ausgewählte Annotation (ein Undo-Schritt). */
  function removeSelectedAnnotation(): boolean {
    const page = selectedPage.value
    const id = selectedAnnotationId.value
    if (!page || !id || !page.annotations.some((a) => a.id === id)) return false
    recorded.removeAnnotation(page.id, id)
    return true
  }

  // Öffentliche, im Verlauf aufgezeichnete Varianten der Änderungsfunktionen.
  // `group` bündelt aufeinanderfolgende Aufrufe zu einem Undo-Schritt.
  const recorded = {
    removePage: (pageId: string) => history.record(() => removePage(pageId)),
    rotatePage: (pageId: string, direction: 'cw' | 'ccw') =>
      history.record(() => rotatePage(pageId, direction)),
    movePage: (from: number, to: number) => history.record(() => movePage(from, to)),
    addAnnotation: (pageId: string, annotation: NewAnnotation, group?: string) =>
      history.record(() => addAnnotation(pageId, annotation), group),
    updateAnnotation: (
      pageId: string,
      annotationId: string,
      patch: AnnotationPatch,
      group?: string,
    ) => history.record(() => updateAnnotation(pageId, annotationId, patch), group),
    removeAnnotation: (pageId: string, annotationId: string, group?: string) =>
      history.record(() => removeAnnotation(pageId, annotationId), group),
    replaceTextLine: (pageId: string, line: TextLine, group?: string) =>
      history.record(() => replaceTextLine(pageId, line), group),
  }

  async function reset(): Promise<void> {
    const ids = [...sourceBytes.keys()]
    sourceBytes.clear()
    sources.value = []
    pages.value = []
    history.clear()
    selectedPageId.value = null
    selectedAnnotationId.value = null
    markedPageIds.value = []
    error.value = null
    await Promise.allSettled(ids.map((id) => closeDocument(id)))
  }

  return {
    sources,
    pages,
    selectedPageId,
    selectedAnnotationId,
    markedPageIds,
    markedPages,
    toggleMarked,
    setAllMarked,
    tool,
    zoom,
    busy,
    error,
    signatureDataUrl,
    textColor,
    highlightColor,
    fontSize,
    coverColor,
    redactColor,
    hasDocument,
    selectedAnnotation,
    selectedPage,
    selectedPageIndex,
    suggestedFileName,
    addFiles,
    selectPage,
    ...recorded,
    addImage,
    removeSelectedAnnotation,
    duplicateSelectedAnnotation,
    sourceBytesFor,
    undo,
    redo,
    newGroup,
    closeHistoryGroup: history.closeGroup,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undoCount: history.undoCount,
    setZoom,
    setTool,
    exportDocument,
    reset,
  }
})
