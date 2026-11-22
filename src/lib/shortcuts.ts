/**
 * Tastenkürzel: gemeinsame Hilfen und die Übersicht (Taste ?) für beide Varianten.
 * Die Kürzel selbst werden dort behandelt, wo die Aktion lebt (EditorView,
 * Dialoge, privater Build in src/private/shortcuts.ts).
 */

export interface ShortcutInfo {
  /** Alternativen, z. B. ['Strg+O', 'O']. */
  keys: string[]
  label: string
}

export interface ShortcutGroup {
  title: string
  items: ShortcutInfo[]
}

/** Strg unter Windows/Linux, ⌘ auf dem Mac. */
export function isMod(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey
}

/** Tippt der Nutzer gerade (Eingabefeld, Textfeld, Auswahlliste, contenteditable)? */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

/** Ist ein modaler Dialog offen? Dann gelten nur dessen eigene Kürzel. */
export function modalOpen(): boolean {
  return typeof document !== 'undefined' && !!document.querySelector('[aria-modal="true"]')
}

/** Gemeinsame Bedingung für einfache Buchstaben-Kürzel ohne Strg/Alt. */
export function isPlainKey(e: KeyboardEvent): boolean {
  return !isMod(e) && !e.altKey && !isTypingTarget(e.target) && !modalOpen()
}

export const CORE_SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Datei',
    items: [
      { keys: ['Strg+O', 'O'], label: 'PDF öffnen bzw. hinzufügen' },
      { keys: ['F'], label: 'Scan / Foto als Seite übernehmen' },
      { keys: ['Strg+S'], label: 'Exportieren (Seitenauswahl im Dialog)' },
      { keys: ['Strg+P', 'P'], label: 'Drucken (Seitenauswahl im Dialog)' },
    ],
  },
  {
    title: 'Werkzeuge',
    items: [
      { keys: ['V'], label: 'Verschieben (Elemente auswählen)' },
      { keys: ['E'], label: 'Text bearbeiten' },
      { keys: ['T'], label: 'Text einfügen' },
      { keys: ['H'], label: 'Markieren' },
      { keys: ['A'], label: 'Abdecken' },
      { keys: ['S'], label: 'Signatur' },
      { keys: ['Umschalt+S'], label: 'Signatur neu zeichnen' },
      { keys: ['B'], label: 'Bild einfügen' },
    ],
  },
  {
    title: 'Ausgewähltes Element',
    items: [
      { keys: ['←', '↑', '→', '↓'], label: 'um 1 pt verschieben' },
      { keys: ['Umschalt+Pfeil'], label: 'um 10 pt verschieben' },
      { keys: ['Strg+D'], label: 'duplizieren' },
      { keys: ['Entf', '⌫'], label: 'löschen' },
      { keys: ['Esc'], label: 'Auswahl aufheben' },
    ],
  },
  {
    title: 'Seiten',
    items: [
      { keys: ['↑', '↓', 'Bild↑', 'Bild↓'], label: 'vorherige / nächste Seite' },
      { keys: ['Pos1', 'Ende'], label: 'erste / letzte Seite' },
      { keys: ['Alt+↑', 'Alt+↓'], label: 'Seite nach oben / unten verschieben' },
      { keys: ['Umschalt+L', 'Umschalt+R'], label: 'Seite nach links / rechts drehen' },
      { keys: ['Umschalt+Entf'], label: 'Seite löschen' },
      { keys: ['M'], label: 'Seite für Export/Druck markieren oder Markierung aufheben' },
      { keys: ['Strg+A'], label: 'alle Seiten markieren' },
      { keys: ['Strg+Umschalt+A'], label: 'Markierung aller Seiten aufheben' },
    ],
  },
  {
    title: 'Bearbeiten und Ansicht',
    items: [
      { keys: ['Strg+Z'], label: 'Rückgängig' },
      { keys: ['Strg+Y', 'Strg+Umschalt+Z'], label: 'Wiederholen' },
      { keys: ['+', '−'], label: 'Vergrößern / Verkleinern' },
      { keys: ['0'], label: 'Zoom 100 %' },
      { keys: ['?', 'F1'], label: 'diese Übersicht' },
    ],
  },
  {
    title: 'Dialog Export / Drucken',
    items: [
      { keys: ['1', '2', '3'], label: 'alle / markierte / aktuelle Seite' },
      { keys: ['Enter'], label: 'exportieren bzw. drucken' },
      { keys: ['Esc'], label: 'schließen' },
    ],
  },
]
