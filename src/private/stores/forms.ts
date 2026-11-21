/**
 * Formularfelder ausfüllen (nur privater Build): Felder erkennen (pdf.js), Werte
 * bearbeiten, KI-Vorschläge aus Stammdaten holen. Die Werte werden beim Export
 * per MuPDF eingetragen und fest eingebettet (siehe forms/fill.ts).
 */
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { normalizeRotation } from '@/lib/geometry'
import { getFormFields, getTextLines, type RawFormField } from '@/services/pdfRenderer'
import { useDocumentStore } from '@/stores/document'
import type { PageRef } from '@/types/pdf'

import { requestFormSuggestions, type FieldKind, type FieldPayload } from '../forms/api'
import { pdfRectToDisplay, type DisplayRect } from '../forms/geometry'
import { nearbyLabel, rightLabel } from '../forms/labels'
import type { FieldValues } from '../forms/fill'
import { loadProfile, saveProfile } from '../forms/profile'
import { SuggestApiError, type PagePayload } from '../suggestions/api'

/** Text der Formularseiten pro Anfrage (Backend erlaubt 60 000 Zeichen). */
const MAX_CONTEXT_CHARS = 40_000

export type FieldValue = string | boolean

export interface FormWidget {
  rect: [number, number, number, number]
  /** Checkbox/Radio: Ein-Zustand. */
  onValue: string
}

export interface FormField {
  /** `${sourceId}|${name}` – Felder gleichen Namens teilen ihren Wert. */
  key: string
  name: string
  sourceId: string
  kind: FieldKind
  /** Tooltip (/TU) oder letzter Teil des Feldnamens. */
  label: string
  /** Beschriftung auf der Seite neben/über dem Feld. */
  context: string
  options: string[]
  /** Anzeigetext je Option (Radio: Beschriftung neben dem Knopf), sonst der Wert selbst. */
  optionLabels: Record<string, string>
  multiline: boolean
  maxLength: number
  /** Wert in der Original-PDF. */
  original: FieldValue
  /** Widgets je Seiten-ID (ein Feld kann mehrere haben, z. B. Radio-Gruppen). */
  widgets: Map<string, FormWidget[]>
}

export interface Suggestion {
  value: FieldValue
  reason: string
}

function toKind(f: RawFormField): FieldKind | null {
  switch (f.type) {
    case 'text':
      return 'text'
    case 'checkbox':
      return 'checkbox'
    case 'radio':
      return 'radio'
    case 'combo':
      return 'choice'
    case 'listbox':
    case 'other':
      return null
    default: {
      const never: never = f.type
      throw new Error(`Unbekannter Feldtyp: ${String(never)}`)
    }
  }
}

function originalValue(kind: FieldKind, f: RawFormField): FieldValue {
  if (kind === 'checkbox') return f.value !== '' && f.value !== 'Off'
  if (kind === 'radio') return f.value === 'Off' ? '' : f.value
  return f.value
}

function totalRotation(p: PageRef) {
  return normalizeRotation(p.baseRotation + p.rotation)
}

export const useFormStore = defineStore('forms', () => {
  const doc = useDocumentStore()

  const fields = ref<FormField[]>([])
  /** Vom Nutzer gesetzte Werte (nur Abweichungen vom Original). */
  const values = ref<Record<string, FieldValue>>({})
  const suggestions = ref<Record<string, Suggestion>>({})
  const status = ref<'idle' | 'detecting' | 'suggesting'>('idle')
  const error = ref<string | null>(null)
  const unsupported = ref(0)
  const profile = ref(loadProfile())
  /** Signatur der Seitenliste beim letzten Erkennen (Quellen/Seiten). */
  let detectedFor = ''
  let controller: AbortController | null = null

  const busy = computed(() => status.value !== 'idle')
  const changedCount = computed(() => Object.keys(values.value).length)
  const suggestionCount = computed(() => Object.keys(suggestions.value).length)

  function valueOf(field: FormField): FieldValue {
    return values.value[field.key] ?? field.original
  }

  function setValue(field: FormField, value: FieldValue): void {
    if (value === field.original) delete values.value[field.key]
    else values.value[field.key] = value
    delete suggestions.value[field.key]
  }

  /** Texte der Optionen für die KI (eindeutig; sonst Text + Wert). */
  function optionTexts(field: FormField): string[] {
    const texts = field.options.map((o) => field.optionLabels[o] ?? o)
    return texts.map((t, i) =>
      texts.indexOf(t) === i && texts.lastIndexOf(t) === i ? t : `${t} (${field.options[i]})`,
    )
  }

  /** Optionstext aus der KI-Antwort → Exportwert des Felds. */
  function optionValue(field: FormField, text: string): string {
    if (field.kind !== 'choice' && field.kind !== 'radio') return text
    const i = optionTexts(field).indexOf(text)
    return i >= 0 ? (field.options[i] ?? text) : text
  }

  function pagesSignature(): string {
    return doc.pages.map((p) => `${p.sourceId}:${p.sourceIndex}`).join(',')
  }

  /** Erkennt die Felder aller Seiten (erneut nur, wenn sich die Seiten geändert haben). */
  async function detect(force = false): Promise<void> {
    const signature = pagesSignature()
    if (!force && signature === detectedFor) return
    if (status.value === 'detecting') return
    status.value = 'detecting'
    error.value = null
    try {
      const byKey = new Map<string, FormField>()
      let skipped = 0
      const known = new Set<string>()
      for (const page of doc.pages) {
        // Dieselbe Quellseite mehrfach in der Liste: Widgets nur einmal je Seite zählen.
        const raw = await getFormFields(page.sourceId, page.sourceIndex)
        const lines =
          raw.length > 0
            ? await getTextLines(page.sourceId, page.sourceIndex, totalRotation(page))
            : []
        for (const f of raw) {
          const kind = toKind(f)
          if (!kind || f.readOnly) {
            const id = `${page.sourceId}|${f.name}`
            if (!known.has(id)) skipped++
            known.add(id)
            continue
          }
          const key = `${page.sourceId}|${f.name}`
          let field = byKey.get(key)
          if (!field) {
            const rect = pdfRectToDisplay(f.rect, page.box, totalRotation(page))
            field = {
              key,
              name: f.name,
              sourceId: page.sourceId,
              kind,
              label: f.alternativeText || f.name.split('.').pop() || f.name,
              context: nearbyLabel(rect, lines),
              options: kind === 'choice' ? f.options : [],
              optionLabels: {},
              multiline: f.multiline,
              maxLength: f.maxLength,
              original: originalValue(kind, f),
              widgets: new Map(),
            }
            byKey.set(key, field)
          }
          if (kind === 'radio' && f.onValue && !field.options.includes(f.onValue)) {
            field.options.push(f.onValue)
            const label = rightLabel(pdfRectToDisplay(f.rect, page.box, totalRotation(page)), lines)
            if (label) field.optionLabels[f.onValue] = label
          }
          const list = field.widgets.get(page.id) ?? []
          list.push({ rect: f.rect, onValue: f.onValue })
          field.widgets.set(page.id, list)
        }
      }
      fields.value = [...byKey.values()]
      unsupported.value = skipped
      detectedFor = signature
      // Werte/Vorschläge zu Feldern, die es nicht mehr gibt, verwerfen.
      for (const key of Object.keys(values.value)) if (!byKey.has(key)) delete values.value[key]
      for (const key of Object.keys(suggestions.value)) {
        if (!byKey.has(key)) delete suggestions.value[key]
      }
    } catch (err) {
      console.error('[pdf-editor] Formularfelder nicht lesbar', err)
      error.value = 'Formularfelder konnten nicht gelesen werden.'
    } finally {
      status.value = 'idle'
    }
  }

  /** Erste Seite (in der aktuellen Reihenfolge), auf der ein Feld vorkommt. */
  function firstPage(field: FormField): { page: PageRef; number: number } | null {
    for (const [i, p] of doc.pages.entries()) {
      if (field.widgets.has(p.id)) return { page: p, number: i + 1 }
    }
    return null
  }

  /** Widget-Rechtecke einer Seite im angezeigten Raum (für die Vorschau auf der Seite). */
  function widgetsOnPage(
    page: PageRef,
  ): { field: FormField; rect: DisplayRect; onValue: string }[] {
    const rotation = totalRotation(page)
    return fields.value.flatMap((field) =>
      (field.widgets.get(page.id) ?? []).map((w) => ({
        field,
        rect: pdfRectToDisplay(w.rect, page.box, rotation),
        onValue: w.onValue,
      })),
    )
  }

  function storeProfile(text: string): boolean {
    profile.value = text
    return saveProfile(text)
  }

  async function suggest(): Promise<void> {
    if (busy.value || fields.value.length === 0) return
    controller = new AbortController()
    const { signal } = controller
    status.value = 'suggesting'
    error.value = null
    try {
      const ids = new Map<string, FormField>()
      const payload: FieldPayload[] = []
      const pageNumbers = new Set<number>()
      for (const field of fields.value) {
        const first = firstPage(field)
        if (!first) continue
        const id = `f${payload.length + 1}`
        ids.set(id, field)
        pageNumbers.add(first.number)
        payload.push({
          id,
          type: field.kind,
          label: field.label.slice(0, 300),
          context: field.context.slice(0, 500),
          page: first.number,
          ...(field.kind === 'choice' || field.kind === 'radio'
            ? { options: optionTexts(field).slice(0, 200) }
            : {}),
          ...(field.multiline ? { multiline: true } : {}),
          ...(field.maxLength > 0 ? { maxLength: field.maxLength } : {}),
        })
      }
      // Formulartext als Kontext (Hinweise wie „in Druckbuchstaben“), begrenzt.
      const pages: PagePayload[] = []
      let chars = 0
      for (const n of [...pageNumbers].sort((a, b) => a - b)) {
        const page = doc.pages[n - 1]
        if (!page) continue
        const lines = (await getTextLines(page.sourceId, page.sourceIndex, totalRotation(page)))
          .map((l) => l.text)
          .filter((t) => t.trim())
        const size = lines.reduce((s, l) => s + l.length + 1, 0)
        if (lines.length === 0 || chars + size > MAX_CONTEXT_CHARS) continue
        chars += size
        pages.push({ page: n, lines })
      }
      if (signal.aborted) return
      const result = await requestFormSuggestions(
        { fields: payload.slice(0, 500), profile: profile.value, pages },
        signal,
      )
      const next: Record<string, Suggestion> = {}
      for (const s of result) {
        const field = ids.get(s.id)
        if (!field) continue
        const value: FieldValue =
          field.kind === 'checkbox' ? s.value === 'true' : optionValue(field, s.value)
        if (value === valueOf(field)) continue // nichts zu ändern
        next[field.key] = { value, reason: s.reason }
      }
      suggestions.value = next
      if (result.length === 0) error.value = 'Keine passenden Angaben in den Stammdaten gefunden.'
    } catch (err) {
      if (signal.aborted) return
      console.error('[pdf-editor] Formularvorschläge fehlgeschlagen', err)
      error.value =
        err instanceof SuggestApiError ? err.message : 'Vorschläge konnten nicht geladen werden.'
    } finally {
      if (controller?.signal === signal) {
        controller = null
        status.value = 'idle'
      }
    }
  }

  function cancel(): void {
    controller?.abort()
    controller = null
    if (status.value === 'suggesting') status.value = 'idle'
  }

  function applySuggestion(key: string): void {
    const s = suggestions.value[key]
    const field = fields.value.find((f) => f.key === key)
    if (s && field) setValue(field, s.value)
  }

  function applyAllSuggestions(): void {
    for (const key of Object.keys(suggestions.value)) applySuggestion(key)
  }

  function dismissSuggestion(key: string): void {
    delete suggestions.value[key]
  }

  function resetValues(): void {
    values.value = {}
  }

  /**
   * Werte je Seite der aktuellen Liste für den Export (Feldname → Wert).
   * Nur geänderte Felder; leer, wenn nichts geändert wurde.
   */
  function valuesForExport(pages: readonly PageRef[]): FieldValues[] {
    if (changedCount.value === 0) return []
    return pages.map((page) => {
      const map = new Map<string, FieldValue>()
      for (const field of fields.value) {
        if (!field.widgets.has(page.id) || !(field.key in values.value)) continue
        map.set(field.name, values.value[field.key]!)
      }
      return map
    })
  }

  function clear(): void {
    cancel()
    fields.value = []
    values.value = {}
    suggestions.value = {}
    error.value = null
    unsupported.value = 0
    detectedFor = ''
  }

  watch(
    () => doc.hasDocument,
    (has) => {
      if (!has) clear()
    },
  )

  function optionLabel(field: FormField, value: string): string {
    return field.optionLabels[value] ?? value
  }

  return {
    optionLabel,
    fields,
    values,
    suggestions,
    status,
    error,
    unsupported,
    profile,
    busy,
    changedCount,
    suggestionCount,
    valueOf,
    setValue,
    detect,
    firstPage,
    widgetsOnPage,
    storeProfile,
    suggest,
    cancel,
    applySuggestion,
    applyAllSuggestions,
    dismissSuggestion,
    resetValues,
    valuesForExport,
    clear,
  }
})
