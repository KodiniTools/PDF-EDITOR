/**
 * Breitenmessung per Canvas mit einer Schrift, die der PDF-Schrift ähnelt.
 * Nur Verhältnisse innerhalb eines Textelements werden verwendet, daher genügt eine
 * ähnliche Schrift (proportional statt „jedes Zeichen gleich breit“).
 */
import type { StandardFontFamily } from '@/types/pdf'

import { measureByCharCount, type MeasureFn } from './locate'

const CSS_FONTS: Record<StandardFontFamily, string> = {
  sans: '100px Helvetica, Arial, sans-serif',
  serif: '100px "Times New Roman", Times, serif',
  mono: '100px "Courier New", Courier, monospace',
}

let cached: MeasureFn | null = null

export function getMeasure(): MeasureFn {
  if (cached) return cached
  let ctx: CanvasRenderingContext2D | null = null
  try {
    ctx = document.createElement('canvas').getContext('2d')
  } catch {
    ctx = null
  }
  if (!ctx) {
    cached = measureByCharCount
    return cached
  }
  const c = ctx
  const memo = new Map<string, number>()
  cached = (text, font) => {
    const key = `${font}|${text}`
    let w = memo.get(key)
    if (w === undefined) {
      c.font = CSS_FONTS[font]
      w = c.measureText(text).width
      if (memo.size > 5000) memo.clear()
      memo.set(key, w)
    }
    return w
  }
  return cached
}
