/**
 * Teilen der exportierten PDF über das Teilen-Menü des Systems (Web Share API Level 2).
 * Alles bleibt im Browser: Die Datei wird nur an das Betriebssystem übergeben
 * (Mail, Messenger, AirDrop …), nie auf einen Server geladen.
 * Wo Dateien nicht geteilt werden können (meist am Desktop), wird heruntergeladen.
 */
import { downloadBytes } from '@/lib/file'

export type ShareResult =
  /** Teilen-Menü geöffnet und abgeschlossen. */
  | 'shared'
  /** Nutzer hat das Teilen-Menü geschlossen. */
  | 'cancelled'
  /**
   * Browser verlangt einen frischen Klick (Nutzeraktivierung durch das Erzeugen der PDF
   * abgelaufen, v. a. Safari). Aufrufer bietet einen zweiten Knopf „Jetzt teilen“ an.
   */
  | 'needs-gesture'
  /** Teilen nicht möglich: Datei wurde stattdessen heruntergeladen. */
  | 'downloaded'
  /** Teilen-Menü schlug unerwartet fehl: Datei wurde stattdessen heruntergeladen. */
  | 'failed'

function pdfFile(bytes: Uint8Array, filename: string): File {
  return new File([bytes as BlobPart], filename, { type: 'application/pdf' })
}

/** Kann dieser Browser PDF-Dateien über das System-Teilen-Menü weitergeben? */
export function canShareFiles(): boolean {
  if (typeof navigator === 'undefined') return false
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
    return false
  }
  try {
    return navigator.canShare({ files: [pdfFile(new Uint8Array(0), 'test.pdf')] })
  } catch {
    return false
  }
}

/**
 * Teilt die PDF; fällt ohne Unterstützung bzw. bei Fehlern auf den Download zurück.
 * `fromDirectClick`: Aufruf kommt unmittelbar aus einem Klick (zweiter Versuch). Ein
 * `NotAllowedError` liegt dann nicht an der Aktivierung (z. B. Berechtigungsrichtlinie),
 * also wird heruntergeladen statt erneut „needs-gesture“ zu melden.
 */
export async function sharePdf(
  bytes: Uint8Array,
  filename: string,
  { fromDirectClick = false }: { fromDirectClick?: boolean } = {},
): Promise<ShareResult> {
  const file = pdfFile(bytes, filename)
  let supported = false
  try {
    supported =
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] })
  } catch {
    supported = false
  }
  if (!supported) {
    downloadBytes(bytes, filename)
    return 'downloaded'
  }
  try {
    // Nur die Datei: Ein zusätzlicher Text landet bei manchen Zielen als eigene Nachricht.
    await navigator.share({ files: [file], title: filename })
    return 'shared'
  } catch (err) {
    const name = err instanceof Error || err instanceof DOMException ? err.name : ''
    if (name === 'AbortError') return 'cancelled'
    if (name === 'NotAllowedError' && !fromDirectClick) return 'needs-gesture'
    console.error('[pdf-editor] Teilen fehlgeschlagen', err)
    downloadBytes(bytes, filename)
    return 'failed'
  }
}
