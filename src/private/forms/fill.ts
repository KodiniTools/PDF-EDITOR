/**
 * Füllt Formularfelder in einer exportierten PDF aus und bettet sie fest ein
 * (MuPDF, nur privater Build). Der Export kopiert Seiten in ein neues Dokument
 * ohne AcroForm – die Felder wären dort ohnehin nicht mehr ausfüllbar. Darum
 * werden alle Widgets nach dem Ausfüllen in den Seiteninhalt übernommen.
 */
import type * as MuPDF from 'mupdf'

import { loadMupdf, RedactionError } from '../redaction/trueRedaction'

/** Wert je Feldname: Text/Auswahl als String, Checkbox als boolean. */
export type FieldValues = ReadonlyMap<string, string | boolean>

function onStates(widget: MuPDF.PDFWidget): string[] {
  const states: string[] = []
  const normal = widget.getObject().get('AP').get('N')
  if (normal.isDictionary()) {
    normal.forEach((_v: MuPDF.PDFObject, key: string | number) => {
      if (String(key) !== 'Off') states.push(String(key))
    })
  }
  return states
}

function isOn(widget: MuPDF.PDFWidget): boolean {
  const as = widget.getObject().get('AS')
  return as.isName() && as.asName() !== 'Off'
}

/** Radio-Widget passt zum Wert: Ein-Zustand oder /Opt-Eintrag gleichen Index. */
function radioMatches(widget: MuPDF.PDFWidget, value: string): boolean {
  const on = onStates(widget)[0]
  if (on === undefined) return false
  if (on === value) return true
  const opts = widget.getOptions()
  const i = Number(on)
  return Number.isInteger(i) && opts[i] === value
}

/**
 * @param valuesByPage Werte je Seite (Index = Seitenindex in `pdf`); Seiten ohne
 *   Werte werden nur eingebettet.
 * @returns neue PDF und Anzahl ausgefüllter Widgets
 */
export async function fillFormFields(
  pdf: Uint8Array,
  valuesByPage: ReadonlyArray<FieldValues | undefined>,
): Promise<{ bytes: Uint8Array; filled: number }> {
  const mupdf = await loadMupdf()
  let doc: MuPDF.PDFDocument
  try {
    doc = new mupdf.PDFDocument(pdf)
  } catch (err) {
    throw new RedactionError('Die PDF konnte zum Ausfüllen nicht geöffnet werden.', { cause: err })
  }
  let filled = 0
  try {
    for (let i = 0; i < doc.countPages(); i++) {
      const values = valuesByPage[i]
      if (!values || values.size === 0) continue
      const page = doc.loadPage(i)
      try {
        for (const widget of page.getWidgets()) {
          const value = values.get(widget.getName())
          if (value === undefined) continue
          switch (widget.getFieldType()) {
            case 'text':
              widget.setTextValue(String(value))
              break
            case 'combobox':
              widget.setChoiceValue(String(value))
              break
            case 'checkbox':
              if (Boolean(value) !== isOn(widget)) widget.toggle()
              break
            case 'radiobutton':
              if (typeof value === 'string' && radioMatches(widget, value) && !isOn(widget)) {
                widget.toggle()
              }
              break
            default:
              continue
          }
          widget.update()
          filled++
        }
      } finally {
        page.destroy()
      }
    }
    // Felder in den Seiteninhalt übernehmen (Annotationen bleiben Annotationen).
    doc.bake(false, true)
    const buffer = doc.saveToBuffer('garbage=deduplicate,compress')
    try {
      return { bytes: buffer.asUint8Array().slice(), filled }
    } finally {
      buffer.destroy()
    }
  } catch (err) {
    if (err instanceof RedactionError) throw err
    throw new RedactionError('Formular konnte nicht ausgefüllt werden.', { cause: err })
  } finally {
    doc.destroy()
  }
}
