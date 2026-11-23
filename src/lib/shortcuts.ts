/**
 * Tastenkürzel: gemeinsame Hilfen und die Übersicht (Taste ?) für beide Varianten.
 * Die Kürzel selbst werden dort behandelt, wo die Aktion lebt (EditorView,
 * Dialoge, privater Build in src/private/shortcuts.ts).
 */
import { keyName, t } from '@/i18n'

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

/**
 * Kürzel-Übersicht der öffentlichen Funktionen in der aktuellen Sprache.
 * In einem `computed` aufrufen, dann folgt die Liste dem Sprachwechsel.
 */
export function coreShortcuts(): ShortcutGroup[] {
  const keys = (...names: string[]): string[] => names.map(keyName)
  return [
    {
      title: t('shortcuts.file'),
      items: [
        { keys: keys('Strg+O', 'O'), label: t('shortcuts.file.open') },
        { keys: keys('F'), label: t('shortcuts.file.scan') },
        ...(__PRIVATE__ ? [] : [{ keys: keys('N'), label: t('shortcuts.file.new') }]),
        { keys: keys('Strg+S'), label: t('shortcuts.file.export') },
        { keys: keys('Strg+P', 'P'), label: t('shortcuts.file.print') },
      ],
    },
    {
      title: t('shortcuts.tools'),
      items: [
        { keys: keys('V'), label: t('shortcuts.tools.select') },
        { keys: keys('E'), label: t('shortcuts.tools.editText') },
        { keys: keys('T'), label: t('shortcuts.tools.text') },
        { keys: keys('H'), label: t('shortcuts.tools.highlight') },
        { keys: keys('A'), label: t('shortcuts.tools.cover') },
        { keys: keys('S'), label: t('shortcuts.tools.signature') },
        { keys: keys('Umschalt+S'), label: t('shortcuts.tools.signatureNew') },
        { keys: keys('B'), label: t('shortcuts.tools.image') },
      ],
    },
    {
      title: t('shortcuts.selection'),
      items: [
        { keys: keys('←', '↑', '→', '↓'), label: t('shortcuts.selection.nudge') },
        { keys: keys('Umschalt+Pfeil'), label: t('shortcuts.selection.nudgeBig') },
        { keys: keys('Strg+D'), label: t('shortcuts.selection.duplicate') },
        { keys: keys('Entf', '⌫'), label: t('shortcuts.selection.delete') },
        { keys: keys('Esc'), label: t('shortcuts.selection.deselect') },
      ],
    },
    {
      title: t('shortcuts.pages'),
      items: [
        { keys: keys('↑', '↓', 'Bild↑', 'Bild↓'), label: t('shortcuts.pages.prevNext') },
        { keys: keys('Pos1', 'Ende'), label: t('shortcuts.pages.firstLast') },
        { keys: keys('Alt+↑', 'Alt+↓'), label: t('shortcuts.pages.move') },
        { keys: keys('Umschalt+L', 'Umschalt+R'), label: t('shortcuts.pages.rotate') },
        { keys: keys('Umschalt+Entf'), label: t('shortcuts.pages.remove') },
        { keys: keys('M'), label: t('shortcuts.pages.mark') },
        { keys: keys('Strg+A'), label: t('shortcuts.pages.markAll') },
        { keys: keys('Strg+Umschalt+A'), label: t('shortcuts.pages.unmarkAll') },
      ],
    },
    {
      title: t('shortcuts.edit'),
      items: [
        { keys: keys('Strg+Z'), label: t('shortcuts.edit.undo') },
        { keys: keys('Strg+Y', 'Strg+Umschalt+Z'), label: t('shortcuts.edit.redo') },
        { keys: keys('+', '−'), label: t('shortcuts.edit.zoom') },
        { keys: keys('0'), label: t('shortcuts.edit.zoomReset') },
        { keys: keys('?', 'F1'), label: t('shortcuts.edit.help') },
      ],
    },
    {
      title: t('shortcuts.dialog'),
      items: [
        { keys: keys('1', '2', '3'), label: t('shortcuts.dialog.scope') },
        { keys: keys('Enter'), label: t('shortcuts.dialog.confirm') },
        { keys: keys('Esc'), label: t('shortcuts.dialog.close') },
      ],
    },
  ]
}
