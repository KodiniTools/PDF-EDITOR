/**
 * Zeichen, die der private Export nicht darstellen kann: weder in den
 * PDF-Standardschriften (WinAnsiEncoding) noch in der eingebetteten
 * Unicode-Schrift (fonts/unicode.ts, Latein inkl. Latin Extended-A, z. B. č, ć, đ).
 * Der Export ersetzt sie durch „?“ – hier für eine Vorab-Warnung.
 */
const EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')

/** Abgedeckte Bereiche der DejaVu-Teilmengen (muss zu pyftsubset --unicodes passen). */
export const UNICODE_FONT_RANGES: readonly (readonly [number, number])[] = [
  [0x0020, 0x007e],
  [0x00a0, 0x017f],
  [0x01c4, 0x01cc],
  [0x0218, 0x021b],
  [0x2010, 0x2027],
  [0x2030, 0x203a],
  [0x20ac, 0x20ac],
  [0x2122, 0x2122],
  [0x2190, 0x2193],
  [0x2212, 0x2212],
]

export function inUnicodeFont(codePoint: number): boolean {
  return UNICODE_FONT_RANGES.some(([a, b]) => codePoint >= a && codePoint <= b)
}

/** Reines WinAnsi (Standardschriften), ohne Unicode-Schrift. */
export function isWinAnsi(text: string): boolean {
  return [...text].every((ch) => {
    const c = ch.codePointAt(0) ?? 0
    return (
      ch === '\n' ||
      ch === '\t' ||
      (c >= 0x20 && c <= 0x7e) ||
      (c >= 0xa0 && c <= 0xff) ||
      EXTRA.has(ch)
    )
  })
}

function supported(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  return (
    ch === '\n' ||
    ch === '\t' ||
    (c >= 0x20 && c <= 0x7e) ||
    (c >= 0xa0 && c <= 0xff) ||
    EXTRA.has(ch) ||
    inUnicodeFont(c)
  )
}

/** Liefert die nicht darstellbaren Zeichen (ohne Duplikate, in Reihenfolge). */
export function unsupportedChars(text: string): string[] {
  return [...new Set([...text].filter((ch) => !supported(ch)))]
}
