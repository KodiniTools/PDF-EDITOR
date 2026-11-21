/**
 * Setzt ein neues PDF mit pdf-lib: leere Seiten im gewählten Format oder die von
 * Claude gelieferten Inhaltsblöcke (Überschriften, Absätze, Listen, Tabellen,
 * Ausfüllfelder) mit Zeilenumbruch und Seitenumbruch. Standardschrift Helvetica
 * (WinAnsi); nicht darstellbare Zeichen werden durch „?“ ersetzt.
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'

import { sanitizeForFont } from '@/services/pdfExport'

import { inUnicodeFont, isWinAnsi } from '../rewrite/winAnsi'

import {
  pageSize,
  type Block,
  type GeneratedDocument,
  type Orientation,
  type PageFormat,
} from './types'

export const MAX_EMPTY_PAGES = 50

export interface RenderOptions {
  format: PageFormat
  orientation: Orientation
}

const TEXT = rgb(0.1, 0.1, 0.12)
const MUTED = rgb(0.55, 0.55, 0.6)
const LINE = rgb(0.45, 0.45, 0.5)
const HEADER_BG = rgb(0.93, 0.94, 0.96)

/** Leere Seiten (ohne KI). */
export async function renderEmpty(
  opts: RenderOptions & { pages: number },
  title = 'Neues Dokument',
): Promise<Uint8Array> {
  const count = Math.min(MAX_EMPTY_PAGES, Math.max(1, Math.floor(opts.pages)))
  const doc = await PDFDocument.create()
  doc.setTitle(title)
  doc.setCreator('PDF-Editor (privat)')
  const size = pageSize(opts.format, opts.orientation)
  for (let i = 0; i < count; i++) doc.addPage(size)
  return doc.save()
}

/** Bricht Text in Zeilen der Breite `maxWidth` um (lange Wörter werden geteilt). */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = []
  const width = (s: string) => font.widthOfTextAtSize(s, size)
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      out.push('')
      continue
    }
    let line = ''
    for (let word of words) {
      // Wort länger als die Zeile: zeichenweise teilen.
      while (width(word) > maxWidth && word.length > 1) {
        if (line) {
          out.push(line)
          line = ''
        }
        let cut = word.length - 1
        while (cut > 1 && width(word.slice(0, cut)) > maxWidth) cut--
        out.push(word.slice(0, cut))
        word = word.slice(cut)
      }
      const candidate = line ? `${line} ${word}` : word
      if (line && width(candidate) > maxWidth) {
        out.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    if (line) out.push(line)
  }
  return out
}

interface Ctx {
  doc: PDFDocument
  page: PDFPage
  regular: PDFFont
  bold: PDFFont
  size: [number, number]
  margin: number
  base: number
  /** Oberkante der nächsten Zeile (PDF-Koordinaten, von unten). */
  y: number
  /** Seite enthält noch keinen Inhalt. */
  fresh: boolean
}

/** Steuerzeichen außer Zeilenumbruch (\n bleibt für Absätze). */
const stripControls = (s: string) =>
  [...s].filter((ch) => ch === '\n' || ch.charCodeAt(0) >= 0x20).join('')

/** Eingebettete Unicode-Schriften (DejaVu); andere Zeichen werden zu „?“. */
const unicodeFonts = new WeakSet<PDFFont>()

function clean(text: string, font: PDFFont): string {
  const plain = stripControls(text.replace(/\t/g, '    '))
  if (unicodeFonts.has(font)) {
    return [...plain]
      .map((ch) => (ch === '\n' || inUnicodeFont(ch.codePointAt(0) ?? 0) ? ch : '?'))
      .join('')
  }
  return sanitizeForFont(plain, font)
}

function newPage(ctx: Ctx): void {
  ctx.page = ctx.doc.addPage(ctx.size)
  ctx.y = ctx.size[1] - ctx.margin
  ctx.fresh = true
}

const contentWidth = (ctx: Ctx) => ctx.size[0] - 2 * ctx.margin
const contentHeight = (ctx: Ctx) => ctx.size[1] - 2 * ctx.margin

/** Sorgt für `height` Platz auf der aktuellen Seite, sonst neue Seite. */
function ensure(ctx: Ctx, height: number): void {
  if (!ctx.fresh && ctx.y - height < ctx.margin) newPage(ctx)
}

function gap(ctx: Ctx, amount: number): void {
  if (!ctx.fresh) ctx.y -= amount
}

function drawLine(ctx: Ctx, text: string, x: number, size: number, font: PDFFont): void {
  if (text) {
    ctx.page.drawText(text, { x, y: ctx.y - size * 0.8, size, font, color: TEXT })
  }
}

/** Absatztext mit Umbruch; `indent` und optionale Marke (•, 1.) für Listen. */
function textBlock(
  ctx: Ctx,
  text: string,
  opts: { size: number; font: PDFFont; indent?: number; marker?: string },
): void {
  const indent = opts.indent ?? 0
  const lh = opts.size * 1.4
  const lines = wrapText(clean(text, opts.font), opts.font, opts.size, contentWidth(ctx) - indent)
  lines.forEach((line, i) => {
    ensure(ctx, lh)
    if (i === 0 && opts.marker) {
      const mw = ctx.regular.widthOfTextAtSize(opts.marker, opts.size)
      ctx.page.drawText(opts.marker, {
        x: ctx.margin + indent - mw - opts.size * 0.4,
        y: ctx.y - opts.size * 0.8,
        size: opts.size,
        font: ctx.regular,
        color: TEXT,
      })
    }
    drawLine(ctx, line, ctx.margin + indent, opts.size, opts.font)
    ctx.y -= lh
    ctx.fresh = false
  })
}

function table(ctx: Ctx, rows: string[][], header: boolean): void {
  const cols = rows[0]?.length ?? 0
  if (cols === 0) return
  const size = ctx.base * 0.9
  const lh = size * 1.3
  const pad = size * 0.45
  const colW = contentWidth(ctx) / cols
  const maxLines = Math.max(1, Math.floor((contentHeight(ctx) - 2 * pad) / lh) - 2)

  const layout = (row: string[], font: PDFFont) =>
    row.map((cell) => wrapText(clean(cell, font), font, size, colW - 2 * pad).slice(0, maxLines))

  const drawRow = (row: string[], isHeader: boolean) => {
    const font = isHeader ? ctx.bold : ctx.regular
    const cells = layout(row, font)
    const height = Math.max(1, ...cells.map((c) => c.length)) * lh + 2 * pad
    const top = ctx.y
    if (isHeader) {
      ctx.page.drawRectangle({
        x: ctx.margin,
        y: top - height,
        width: contentWidth(ctx),
        height,
        color: HEADER_BG,
      })
    }
    cells.forEach((lines, c) => {
      lines.forEach((line, i) => {
        if (!line) return
        ctx.page.drawText(line, {
          x: ctx.margin + c * colW + pad,
          y: top - pad - i * lh - size * 0.85,
          size,
          font,
          color: TEXT,
        })
      })
    })
    for (let c = 0; c <= cols; c++) {
      const x = ctx.margin + c * colW
      ctx.page.drawLine({
        start: { x, y: top },
        end: { x, y: top - height },
        thickness: 0.5,
        color: LINE,
      })
    }
    ctx.page.drawLine({
      start: { x: ctx.margin, y: top },
      end: { x: ctx.margin + contentWidth(ctx), y: top },
      thickness: 0.5,
      color: LINE,
    })
    ctx.page.drawLine({
      start: { x: ctx.margin, y: top - height },
      end: { x: ctx.margin + contentWidth(ctx), y: top - height },
      thickness: 0.5,
      color: LINE,
    })
    ctx.y = top - height
    ctx.fresh = false
  }

  const rowHeight = (row: string[], font: PDFFont) =>
    Math.max(1, ...layout(row, font).map((c) => c.length)) * lh + 2 * pad

  const headRow = header ? rows[0] : undefined
  rows.forEach((row, i) => {
    const isHeader = header && i === 0
    const h = rowHeight(row, isHeader ? ctx.bold : ctx.regular)
    // Kopfzeile nicht allein am Seitenende stehen lassen.
    const needed = isHeader && rows[1] ? h + rowHeight(rows[1], ctx.regular) : h
    if (!ctx.fresh && ctx.y - needed < ctx.margin) {
      newPage(ctx)
      if (headRow && !isHeader) drawRow(headRow, true)
    }
    drawRow(row, isHeader)
  })
}

function field(ctx: Ctx, label: string): void {
  const size = ctx.base
  const height = size * 2.4
  const width = contentWidth(ctx)
  const text = clean(label, ctx.regular)
  let labelW = ctx.regular.widthOfTextAtSize(text, size)
  ensure(ctx, height)
  // Lange Beschriftung: Text umbrechen, Linie darunter über die volle Breite.
  if (labelW > width * 0.6) {
    textBlock(ctx, label, { size, font: ctx.regular })
    labelW = -size * 0.6
    ensure(ctx, height)
    ctx.y -= size * 0.9
  } else {
    ctx.y -= height - size * 1.3
    drawLine(ctx, text, ctx.margin, size, ctx.regular)
  }
  const lineY = ctx.y - size * 0.95
  ctx.page.drawLine({
    start: { x: ctx.margin + labelW + size * 0.6, y: lineY },
    end: { x: ctx.margin + width, y: lineY },
    thickness: 0.6,
    color: MUTED,
  })
  ctx.y -= size * 1.3
  ctx.fresh = false
}

function renderBlock(ctx: Ctx, block: Block, index: number, blocks: readonly Block[]): void {
  const base = ctx.base
  switch (block.type) {
    case 'heading': {
      const size = base * (block.level === 1 ? 1.9 : block.level === 2 ? 1.45 : 1.18)
      gap(ctx, base * (block.level === 1 ? 0.4 : block.level === 2 ? 1.1 : 0.8))
      // Überschrift nicht allein am Seitenende: Platz für eine Folgezeile mitprüfen.
      const next = blocks[index + 1]
      ensure(ctx, size * 1.4 + (next && next.type !== 'pagebreak' ? base * 1.4 : 0))
      textBlock(ctx, block.text, { size, font: ctx.bold })
      ctx.y -= base * 0.3
      break
    }
    case 'paragraph':
      textBlock(ctx, block.text, { size: base, font: ctx.regular })
      ctx.y -= base * 0.6
      break
    case 'bullets':
    case 'numbered':
      block.items.forEach((item, i) => {
        textBlock(ctx, item, {
          size: base,
          font: ctx.regular,
          indent: base * 1.8,
          marker: block.type === 'bullets' ? '•' : `${i + 1}.`,
        })
        ctx.y -= base * 0.2
      })
      ctx.y -= base * 0.4
      break
    case 'table':
      gap(ctx, base * 0.3)
      table(ctx, block.rows, block.header)
      ctx.y -= base * 0.9
      break
    case 'field':
      field(ctx, block.text)
      break
    case 'divider':
      gap(ctx, base * 0.5)
      ensure(ctx, base)
      ctx.page.drawLine({
        start: { x: ctx.margin, y: ctx.y },
        end: { x: ctx.margin + contentWidth(ctx), y: ctx.y },
        thickness: 0.7,
        color: LINE,
      })
      ctx.y -= base
      ctx.fresh = false
      break
    case 'spacer':
      gap(ctx, base * 1.5)
      break
    case 'pagebreak':
      if (!ctx.fresh) newPage(ctx)
      break
    default: {
      const never: never = block
      throw new Error(`Unbekannter Block: ${JSON.stringify(never)}`)
    }
  }
}

/** Alle Texte des Dokuments (für die Wahl der Schrift). */
function allText(content: GeneratedDocument): string {
  return content.blocks
    .map((b) => {
      if ('text' in b) return b.text
      if ('items' in b) return b.items.join('\n')
      if ('rows' in b) return b.rows.flat().join('\n')
      return ''
    })
    .join('\n')
}

/**
 * Helvetica, solange alles in WinAnsi passt (kleinste PDFs); sonst z. B. bei
 * Kroatisch/Bosnisch (č, ć, đ) die eingebettete Unicode-Schrift.
 */
async function embedFonts(
  doc: PDFDocument,
  content: GeneratedDocument,
): Promise<{ regular: PDFFont; bold: PDFFont }> {
  if (isWinAnsi(allText(content))) {
    return {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
    }
  }
  const { embedUnicodeFont } = await import('../fonts/unicode')
  const regular = await embedUnicodeFont(doc, 'sans')
  const bold = await embedUnicodeFont(doc, 'sans-bold')
  unicodeFonts.add(regular)
  unicodeFonts.add(bold)
  return { regular, bold }
}

/** Setzt das von Claude gelieferte Dokument im gewählten Format. */
export async function renderDocument(
  content: GeneratedDocument,
  opts: RenderOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(content.title)
  doc.setCreator('PDF-Editor (privat)')
  const size = pageSize(opts.format, opts.orientation)
  const short = Math.min(size[0], size[1])
  const ctx: Ctx = {
    doc,
    page: doc.addPage(size),
    ...(await embedFonts(doc, content)),
    size,
    margin: Math.round(short * 0.095),
    base: opts.format === 'A5' ? 9.5 : opts.format === 'A3' ? 12 : 10.5,
    y: size[1] - Math.round(short * 0.095),
    fresh: true,
  }
  // Seitenumbrüche/Abstände am Ende würden nur leere Seiten erzeugen.
  let end = content.blocks.length
  while (end > 0 && ['pagebreak', 'spacer'].includes(content.blocks[end - 1]?.type ?? '')) end--
  const blocks = content.blocks.slice(0, end)
  blocks.forEach((block, i) => renderBlock(ctx, block, i, blocks))
  return doc.save()
}
