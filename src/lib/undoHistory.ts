import { computed, shallowRef, type ComputedRef } from 'vue'

export const DEFAULT_HISTORY_LIMIT = 50

interface Entry {
  /** Serialisierter Zustand vor der Änderung. */
  json: string
  /** Zusatzinfo je Eintrag (z. B. referenzierte Quellen), siehe `refs`. */
  refs: string[]
}

export interface UndoHistoryOptions<T> {
  /** Maximale Anzahl Undo-Schritte (Standard 50). */
  limit?: number
  /** Liest den aktuellen, JSON-serialisierbaren Zustand. */
  read: () => T
  /** Stellt einen Zustand wieder her (bekommt eine frische Kopie). */
  write: (state: T) => void
  /** Liefert Verweise eines Zustands, die solange gültig bleiben müssen, wie er im Verlauf ist. */
  refs?: (state: T) => string[]
  /** Wird nach jeder Änderung des Verlaufs aufgerufen. */
  onChange?: () => void
}

export interface UndoHistory {
  /**
   * Führt `fn` als einen Undo-Schritt aus. Aufrufe mit gleichem `group`-Schlüssel
   * direkt hintereinander (z. B. Ziehen, Tippen) werden zu einem Schritt gebündelt.
   * Verschachtelte Aufrufe gehören zum äußeren Schritt.
   */
  record<R>(fn: () => R, group?: string): R
  /** Wie `record`, für asynchrone Änderungen (ohne Bündelung). */
  recordAsync<R>(fn: () => Promise<R>): Promise<R>
  /** Schließt eine offene Gruppe; leere Schritte werden verworfen. */
  closeGroup(): void
  undo(): boolean
  redo(): boolean
  clear(): void
  /** Verweise aller Einträge (Undo + Redo). */
  allRefs(): Set<string>
  canUndo: ComputedRef<boolean>
  canRedo: ComputedRef<boolean>
  undoCount: ComputedRef<number>
  redoCount: ComputedRef<number>
}

/**
 * Snapshot-basierter Undo/Redo-Verlauf. Bewusst Snapshots statt Kommandos:
 * jede Änderung ist automatisch rückgängig machbar, ohne pro Aktion eine
 * Umkehrfunktion pflegen zu müssen. Bei 50 Schritten und reinen Metadaten
 * (keine PDF-Bytes) ist der Speicherbedarf gering.
 */
export function createUndoHistory<T>(options: UndoHistoryOptions<T>): UndoHistory {
  const limit = Math.max(1, options.limit ?? DEFAULT_HISTORY_LIMIT)
  const undoStack = shallowRef<Entry[]>([])
  const redoStack = shallowRef<Entry[]>([])
  let depth = 0
  let openGroup: string | null = null

  function capture(): Entry {
    const state = options.read()
    return { json: JSON.stringify(state), refs: options.refs?.(state) ?? [] }
  }

  function currentJson(): string {
    return JSON.stringify(options.read())
  }

  function push(entry: Entry): void {
    undoStack.value = [...undoStack.value, entry].slice(-limit)
    redoStack.value = []
  }

  function changed(): void {
    options.onChange?.()
  }

  function closeGroup(): void {
    if (openGroup === null) return
    openGroup = null
    const top = undoStack.value[undoStack.value.length - 1]
    if (top && top.json === currentJson()) {
      undoStack.value = undoStack.value.slice(0, -1)
      changed()
    }
  }

  function record<R>(fn: () => R, group?: string): R {
    if (depth > 0) return fn()
    if (group !== undefined && group === openGroup) {
      depth++
      try {
        return fn()
      } finally {
        depth--
      }
    }
    closeGroup()
    const before = capture()
    let result: R
    depth++
    try {
      result = fn()
    } finally {
      depth--
    }
    if (group !== undefined) {
      push(before)
      openGroup = group
      changed()
    } else if (currentJson() !== before.json) {
      push(before)
      changed()
    }
    return result
  }

  async function recordAsync<R>(fn: () => Promise<R>): Promise<R> {
    if (depth > 0) return fn()
    closeGroup()
    const before = capture()
    depth++
    try {
      return await fn()
    } finally {
      depth--
      if (currentJson() !== before.json) push(before)
      changed()
    }
  }

  function restore(entry: Entry): void {
    options.write(JSON.parse(entry.json) as T)
  }

  function undo(): boolean {
    if (depth > 0) return false
    closeGroup()
    const top = undoStack.value[undoStack.value.length - 1]
    if (!top) return false
    undoStack.value = undoStack.value.slice(0, -1)
    redoStack.value = [...redoStack.value, capture()]
    restore(top)
    changed()
    return true
  }

  function redo(): boolean {
    if (depth > 0) return false
    closeGroup()
    const top = redoStack.value[redoStack.value.length - 1]
    if (!top) return false
    redoStack.value = redoStack.value.slice(0, -1)
    undoStack.value = [...undoStack.value, capture()].slice(-limit)
    restore(top)
    changed()
    return true
  }

  function clear(): void {
    undoStack.value = []
    redoStack.value = []
    openGroup = null
    changed()
  }

  function allRefs(): Set<string> {
    const out = new Set<string>()
    for (const e of [...undoStack.value, ...redoStack.value]) {
      for (const r of e.refs) out.add(r)
    }
    return out
  }

  return {
    record,
    recordAsync,
    closeGroup,
    undo,
    redo,
    clear,
    allRefs,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    undoCount: computed(() => undoStack.value.length),
    redoCount: computed(() => redoStack.value.length),
  }
}
