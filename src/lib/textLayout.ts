/**
 * Umbruch eingefügter Texte am rechten Seitenrand – gemeinsam für den Seiteneditor
 * und den Reiter „Text“ der privaten Seitenleiste.
 */
import { unwrapSoft, wrapTextToWidth } from '@/lib/textWrap'
import type { FontFamily, TextAnnotation } from '@/types/pdf'

/** Bildschirmschriften passend zu den PDF-Standardschriften im Export. */
export const CSS_FONTS: Record<FontFamily, string> = {
  sans: 'Helvetica, Arial, sans-serif',
  serif: '"Times New Roman", Times, serif',
  mono: '"Courier New", Courier, monospace',
}

export type TextStyle = Pick<TextAnnotation, 'fontSize' | 'font' | 'bold' | 'italic'>

/** CSS-Kurzschreibweise `font` für Messung und Anzeige (Größe in Seitenpunkten). */
export function cssFont(style: TextStyle): string {
  const parts = [style.italic ? 'italic' : '', style.bold ? 'bold' : '', `${style.fontSize}px`]
  return `${parts.filter(Boolean).join(' ')} ${CSS_FONTS[style.font ?? 'sans']}`
}

let measureContext: CanvasRenderingContext2D | null | undefined

/** Textbreite in Seitenpunkten; ohne Canvas (z. B. Tests) eine Schätzung. */
export function measureTextWidth(text: string, style: TextStyle): number {
  if (measureContext === undefined) {
    try {
      measureContext = document.createElement('canvas').getContext('2d')
    } catch {
      measureContext = null
    }
  }
  // Fett läuft etwas breiter (auch in der Schätzung, damit Tests den Umbruch sehen).
  if (!measureContext) return text.length * style.fontSize * (style.bold ? 0.6 : 0.55)
  measureContext.font = cssFont(style)
  return measureContext.measureText(text).width
}

/** Breite der längsten Zeile in Seitenpunkten. */
export function longestLineWidth(text: string, style: TextStyle): number {
  return Math.max(0, ...text.split('\n').map((line) => measureTextWidth(line, style)))
}

/** Schmalste Spalte, auf die Text am rechten Rand umbrochen wird. */
export function minWrapWidth(style: TextStyle): number {
  return style.fontSize * 4
}

/**
 * Platz, den ein Text rechts mindestens braucht: sein längstes Wort (Wörter werden nicht
 * geteilt), mindestens aber die schmalste Spalte und höchstens seine längste Zeile.
 */
export function minTextWidth(unwrapped: string, style: TextStyle): number {
  const longestWord = Math.max(0, ...unwrapped.split(/\s+/).map((w) => measureTextWidth(w, style)))
  return Math.min(
    longestLineWidth(unwrapped, style),
    Math.max(longestWord + style.fontSize * 0.25, minWrapWidth(style)),
  )
}

export interface Reflow {
  text: string
  softBreaks: number[]
  /** Stellen im Eingabetext, an denen ein Wort geteilt wurde (für die Schreibmarke). */
  inserted: number[]
}

export interface ReflowInput {
  /** Breite der angezeigten Seite in Punkten. */
  pageWidth: number
  /** Standard: Text der Annotation. */
  text?: string
  /** Automatische Umbrüche in `text`; Standard: die der Annotation. */
  softBreaks?: readonly number[]
  /** Standard: Position der Annotation. */
  x?: number
}

/**
 * Bricht den Text am rechten Seitenrand um. Frühere automatische Umbrüche (`softBreaks`)
 * werden zurückgenommen und neu gesetzt, von Hand gesetzte bleiben. Anzeige und Export
 * kennen nur echte Umbrüche, deshalb stehen sie im Text selbst. Wörter werden nicht geteilt.
 * Ersetzte PDF-Zeilen („Text bearbeiten“) bleiben einzeilig (`null`).
 */
export function reflowText(a: TextAnnotation, input: ReflowInput): Reflow | null {
  if (a.replacesKey !== undefined) return null
  const text = input.text ?? a.text
  const soft = input.softBreaks ?? a.softBreaks ?? []
  // Etwas Reserve, weil die PDF-Schrift geringfügig breiter laufen kann als die Bildschirmschrift.
  const available = input.pageWidth - (input.x ?? a.x) - a.fontSize * 0.25
  const result = wrapTextToWidth(
    unwrapSoft(text, soft),
    Math.max(available, minWrapWidth(a)),
    (s) => measureTextWidth(s, a),
    false,
  )
  return { text: result.text, softBreaks: result.soft, inserted: result.inserted }
}

export function sameBreaks(a: readonly number[] | undefined, b: readonly number[]): boolean {
  return a !== undefined && a.length === b.length && a.every((v, i) => v === b[i])
}
