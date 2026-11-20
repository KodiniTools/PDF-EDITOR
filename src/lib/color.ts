export interface Rgb {
  r: number
  g: number
  b: number
}

/** Wandelt `#rgb` oder `#rrggbb` in RGB-Anteile 0..1 um. Ungültige Werte → Schwarz. */
export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m?.[1]) return { r: 0, g: 0, b: 0 }
  let h = m[1]
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  const n = Number.parseInt(h, 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}
