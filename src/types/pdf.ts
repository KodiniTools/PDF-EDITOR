/** Seitendrehung im Uhrzeigersinn, wie sie ein PDF-Viewer anzeigt. */
export type Rotation = 0 | 90 | 180 | 270

/** Schriftfamilie für Textannotationen; im Export eine der PDF-Standardschriften. */
export type FontFamily = 'sans' | 'serif' | 'mono'

/** Rechteck in PDF-Benutzerkoordinaten (Punkte, Ursprung unten links). */
export interface PdfBox {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

/** Eine geladene Quelldatei. Die Bytes liegen bewusst nicht im reaktiven State. */
export interface SourceDocument {
  id: string
  name: string
  pageCount: number
}

/**
 * Gemeinsame Felder aller Annotationen.
 * Koordinaten in Punkten im *angezeigten* (gedrehten) Seitenraum, Ursprung oben links.
 */
interface AnnotationBase {
  id: string
  x: number
  y: number
}

export interface TextAnnotation extends AnnotationBase {
  kind: 'text'
  text: string
  fontSize: number
  color: string
  /** Standard: 'sans' (Helvetica). */
  font?: FontFamily
  /** Gesetzt, wenn der Text eine vorhandene PDF-Zeile ersetzt (Schlüssel der Zeile). */
  replacesKey?: string
  /** Zugehörige Abdeckung; wird mit dem Text zusammen gelöscht. */
  coverId?: string
}

export interface HighlightAnnotation extends AnnotationBase {
  kind: 'highlight'
  width: number
  height: number
  color: string
}

/**
 * Deckende Fläche (Weiß-Abdeckung oder Schwärzung).
 * Achtung: verdeckt nur optisch, der darunterliegende Inhalt bleibt im PDF erhalten –
 * außer `redact` ist gesetzt und der private Build exportiert (echtes Schwärzen).
 */
export interface CoverAnnotation extends AnnotationBase {
  kind: 'cover'
  width: number
  height: number
  color: string
  /**
   * Echte Schwärzung (nur privater Build): Inhalt unter der Fläche wird beim Export
   * entfernt. Der öffentliche Build legt solche Flächen nie an.
   */
  redact?: boolean
  /** Vorschau deckend statt halbtransparent (z. B. gelöschtes Bild, nur privater Build). */
  solid?: boolean
}

export interface ImageAnnotation extends AnnotationBase {
  kind: 'image'
  width: number
  height: number
  /** PNG- oder JPEG-Data-URL (z. B. Signatur). */
  dataUrl: string
}

export type Annotation = TextAnnotation | HighlightAnnotation | CoverAnnotation | ImageAnnotation
export type AnnotationKind = Annotation['kind']

/** Verweis auf eine Seite einer Quelldatei plus Bearbeitungen. */
export interface PageRef {
  id: string
  sourceId: string
  /** 0-basierter Seitenindex in der Quelldatei. */
  sourceIndex: number
  /** Sichtbarer Seitenbereich (CropBox), ungedreht. */
  box: PdfBox
  /** /Rotate der Originaldatei. */
  baseRotation: Rotation
  /** Zusätzliche Drehung durch den Nutzer. */
  rotation: Rotation
  annotations: Annotation[]
}

/** 'redact' gibt es nur im privaten Build (siehe AppToolbar). */
export type Tool = 'select' | 'edit-text' | 'text' | 'highlight' | 'cover' | 'redact' | 'signature'

/** Omit, das über Union-Mitglieder verteilt wird. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type NewAnnotation = DistributiveOmit<Annotation, 'id'>
export type AnnotationPatch = Partial<DistributiveOmit<Annotation, 'id' | 'kind'>>
