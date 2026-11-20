/** Seitendrehung im Uhrzeigersinn, wie sie ein PDF-Viewer anzeigt. */
export type Rotation = 0 | 90 | 180 | 270

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
}

export interface HighlightAnnotation extends AnnotationBase {
  kind: 'highlight'
  width: number
  height: number
  color: string
}

export interface ImageAnnotation extends AnnotationBase {
  kind: 'image'
  width: number
  height: number
  /** PNG- oder JPEG-Data-URL (z. B. Signatur). */
  dataUrl: string
}

export type Annotation = TextAnnotation | HighlightAnnotation | ImageAnnotation
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

export type Tool = 'select' | 'text' | 'highlight' | 'signature'

/** Omit, das über Union-Mitglieder verteilt wird. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type NewAnnotation = DistributiveOmit<Annotation, 'id'>
export type AnnotationPatch = Partial<DistributiveOmit<Annotation, 'id' | 'kind'>>
