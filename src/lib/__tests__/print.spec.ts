import { afterEach, describe, expect, it, vi } from 'vitest'

import { printImages } from '@/lib/print'

vi.mock('@/services/pdfRenderer', () => ({
  openDocument: async () => [],
  closeDocument: async () => undefined,
  renderPage: async () => undefined,
}))

describe('printImages', () => {
  afterEach(() => vi.restoreAllMocks())

  it('zeigt Seitenbilder nur im Druck und räumt nach afterprint auf', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const revoke = vi.fn<(url: string) => void>()
    URL.revokeObjectURL = revoke
    // jsdom kennt img.decode() nicht.
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      value: () => Promise.resolve(),
      configurable: true,
    })
    await printImages(['blob:a', 'blob:b'])
    const root = document.getElementById('pdf-editor-print-root')!
    expect(root.querySelectorAll('img')).toHaveLength(2)
    expect(root.querySelector('style')?.textContent).toContain('@media print')
    expect(print).toHaveBeenCalledOnce()
    window.dispatchEvent(new Event('afterprint'))
    expect(document.getElementById('pdf-editor-print-root')).toBeNull()
    expect(revoke.mock.calls.map((c) => c[0])).toEqual(['blob:a', 'blob:b'])
  })
})
