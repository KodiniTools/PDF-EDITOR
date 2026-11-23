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

export function wrapTextToWidth(text: string, maxWidth: number, measure: MeasureText): WrapResult {
  const inserted: number[] = []
  if (!(maxWidth > 0)) return { text, inserted }
  let base = 0
  const lines = text.split('\n').map((line) => {
    let out = ''
    let pos = 0
    while (line.length - pos > 1 && measure(line.slice(pos)) > maxWidth) {
      const n = fitCount(line, pos, maxWidth, measure)
      // Letztes Leerzeichen im passenden Stück (oder direkt dahinter), nicht am Zeilenanfang.
      const space = line.lastIndexOf(' ', pos + n)
      if (space > pos) {
        out += `${line.slice(pos, space)}\n`
        pos = space + 1
      } else {
        out += `${line.slice(pos, pos + n)}\n`
        inserted.push(base + pos + n)
        pos += n
      }
    }
    base += line.length + 1
    return out + line.slice(pos)
  })
  return { text: lines.join('\n'), inserted }
}

/** Position der Schreibmarke nach dem Umbruch (verschiebt sich nur durch Wortteilungen). */
export function caretAfterWrap(caret: number, result: WrapResult): number {
  return caret + result.inserted.filter((i) => i < caret).length
}
