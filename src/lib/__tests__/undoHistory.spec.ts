import { describe, expect, it, vi } from 'vitest'

import { createUndoHistory } from '@/lib/undoHistory'

function setup(limit?: number) {
  let state = { n: 0 }
  const onChange = vi.fn<() => void>()
  const history = createUndoHistory({
    limit,
    read: () => state,
    write: (s) => {
      state = s
    },
    refs: (s) => [`n${s.n}`],
    onChange,
  })
  const set = (n: number, group?: string) =>
    history.record(() => {
      state.n = n
    }, group)
  return { history, set, get: () => state.n, onChange }
}

describe('createUndoHistory', () => {
  it('Undo/Redo stellt Zustände wieder her', () => {
    const { history, set, get } = setup()
    set(1)
    set(2)
    expect(history.undo()).toBe(true)
    expect(get()).toBe(1)
    expect(history.undo()).toBe(true)
    expect(get()).toBe(0)
    expect(history.undo()).toBe(false)
    expect(history.redo()).toBe(true)
    expect(get()).toBe(1)
  })

  it('neue Änderung verwirft den Redo-Stapel', () => {
    const { history, set } = setup()
    set(1)
    history.undo()
    set(5)
    expect(history.canRedo.value).toBe(false)
  })

  it('zeichnet unveränderte Aufrufe nicht auf', () => {
    const { history, set } = setup()
    set(0)
    expect(history.canUndo.value).toBe(false)
  })

  it('bündelt Gruppen und verschachtelte Aufrufe', () => {
    const { history, set, get } = setup()
    set(1, 'g')
    set(2, 'g')
    history.record(() => {
      set(3)
      set(4)
    })
    expect(history.undoCount.value).toBe(2)
    history.undo()
    expect(get()).toBe(2)
    history.undo()
    expect(get()).toBe(0)
  })

  it('entfernt Gruppen ohne Nettoänderung', () => {
    const { history, set } = setup()
    set(1, 'g')
    set(0, 'g')
    history.closeGroup()
    expect(history.undoCount.value).toBe(0)
  })

  it('hält das Limit ein', () => {
    const { history, set } = setup(3)
    for (let i = 1; i <= 5; i++) set(i)
    expect(history.undoCount.value).toBe(3)
    expect(history.allRefs()).toEqual(new Set(['n2', 'n3', 'n4']))
  })

  it('zeichnet asynchrone Änderungen auf', async () => {
    const { history, get } = setup()
    let state = 0
    await history.recordAsync(async () => {
      state = 1
    })
    expect(state).toBe(1)
    expect(get()).toBe(0) // fremder Zustand → kein Eintrag
    expect(history.canUndo.value).toBe(false)
  })
})
