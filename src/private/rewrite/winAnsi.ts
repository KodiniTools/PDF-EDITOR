/**
 * Zeichen, die die PDF-Standardschriften (WinAnsiEncoding) nicht darstellen können.
 * Der Export ersetzt sie durch „?“ (sanitizeForFont) – hier für eine Vorab-Warnung.
 */
const EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')

function supported(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  return (
    ch === '\n' ||
    ch === '\t' ||
    (c >= 0x20 && c <= 0x7e) ||
    (c >= 0xa0 && c <= 0xff) ||
    EXTRA.has(ch)
  )
}

/** Liefert die nicht darstellbaren Zeichen (ohne Duplikate, in Reihenfolge). */
export function unsupportedChars(text: string): string[] {
  return [...new Set([...text].filter((ch) => !supported(ch)))]
}
