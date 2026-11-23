/**
 * Fester Zeilenumbruch für eingefügten Text: Zeilen, die breiter als `maxWidth` sind,
 * werden an Leerzeichen geteilt (das Leerzeichen wird zum Umbruch). Ohne Leerzeichen
 * wird das Wort geteilt. So zeigt der Editor dieselben Zeilen wie der Export, der nur
 * echte Umbrüche (`\n`) kennt.
 */

export interface WrapResult {
  text: string
  /** Stellen im Ausgangstext, an denen ein Umbruch zusätzlich eingefügt wurde (Wortteilung). */
  inserted: number[]
  /**
   * Stellen im Ergebnis, an denen ein Leerzeichen zum Umbruch wurde („weiche“ Umbrüche).
   * Sie lassen sich mit `unwrapSoft` zurücknehmen, z. B. wenn der Text verschoben wird.
   */
  soft: number[]
}

export type MeasureText = (text: string) => number

/** Größte Zeichenzahl ab `from`, die in die Breite passt (mindestens 1). */
function fitCount(line: string, from: number, maxWidth: number, measure: MeasureText): number {
  let lo = 1
  let hi = line.length - from
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (measure(line.slice(from, from + mid)) <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * @param splitWords `false`: Wörter ohne Leerzeichen bleiben ganz (ragen dann über die
 * Breite hinaus). So entstehen nur weiche Umbrüche, die sich vollständig zurücknehmen lassen.
 */
export function wrapTextToWidth(
  text: string,
  maxWidth: number,
  measure: MeasureText,
  splitWords = true,
): WrapResult {
  const inserted: number[] = []
  const soft: number[] = []
  if (!(maxWidth > 0)) return { text, inserted, soft }
  let base = 0
  let outBase = 0
  const lines = text.split('\n').map((line) => {
    let out = ''
    let pos = 0
    while (line.length - pos > 1 && measure(line.slice(pos)) > maxWidth) {
      const n = fitCount(line, pos, maxWidth, measure)
      // Letztes Leerzeichen im passenden Stück (oder direkt dahinter), nicht am Zeilenanfang.
      const space = line.lastIndexOf(' ', pos + n)
      if (space > pos) {
        out += `${line.slice(pos, space)}\n`
        soft.push(outBase + out.length - 1)
        pos = space + 1
      } else if (splitWords) {
        out += `${line.slice(pos, pos + n)}\n`
        inserted.push(base + pos + n)
        pos += n
      } else {
        // Überlanges Wort ganz lassen und erst am nächsten Leerzeichen umbrechen.
        const next = line.indexOf(' ', pos + n)
        if (next < 0) break
        out += `${line.slice(pos, next)}\n`
        soft.push(outBase + out.length - 1)
        pos = next + 1
      }
    }
    base += line.length + 1
    const full = out + line.slice(pos)
    outBase += full.length + 1
    return full
  })
  return { text: lines.join('\n'), inserted, soft }
}

/** Nimmt weiche Umbrüche zurück (Umbruch → Leerzeichen); die Textlänge bleibt gleich. */
export function unwrapSoft(text: string, soft: readonly number[]): string {
  if (soft.length === 0) return text
  const chars = text.split('')
  for (const i of soft) if (chars[i] === '\n') chars[i] = ' '
  return chars.join('')
}

/**
 * Überträgt weiche Umbrüche auf einen bearbeiteten Text: Stellen vor der Änderung
 * bleiben, Stellen dahinter verschieben sich, Stellen im geänderten Bereich entfallen.
 */
export function adjustSoftBreaks(
  oldText: string,
  newText: string,
  soft: readonly number[],
): number[] {
  if (soft.length === 0) return []
  const limit = Math.min(oldText.length, newText.length)
  let prefix = 0
  while (prefix < limit && oldText[prefix] === newText[prefix]) prefix++
  let suffix = 0
  while (
    suffix < limit - prefix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix++
  }
  const delta = newText.length - oldText.length
  return soft.flatMap((i) => {
    const next = i < prefix ? i : i >= oldText.length - suffix ? i + delta : -1
    return next >= 0 && newText[next] === '\n' ? [next] : []
  })
}

/** Position der Schreibmarke nach dem Umbruch (verschiebt sich nur durch Wortteilungen). */
export function caretAfterWrap(caret: number, result: Pick<WrapResult, 'inserted'>): number {
  return caret + result.inserted.filter((i) => i < caret).length
}
