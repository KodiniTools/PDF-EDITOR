import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { downloadBytes } from '@/lib/file'
import { canShareFiles, sharePdf } from '@/lib/share'

vi.mock('@/lib/file', async (orig) => ({
  ...(await orig<typeof import('@/lib/file')>()),
  downloadBytes: vi.fn<(b: Uint8Array, n: string) => void>(),
}))

const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])

function stubShare(share?: (data: ShareData) => Promise<void>, canShare = true): void {
  vi.stubGlobal('navigator', {
    ...navigator,
    share: share ? vi.fn<(data: ShareData) => Promise<void>>(share) : undefined,
    canShare: share ? vi.fn<() => boolean>(() => canShare) : undefined,
  })
}

describe('share', () => {
  beforeEach(() => vi.mocked(downloadBytes).mockClear())
  afterEach(() => vi.unstubAllGlobals())

  it('ohne Web Share API: lädt herunter', async () => {
    stubShare()
    expect(canShareFiles()).toBe(false)
    expect(await sharePdf(bytes, 'a.pdf')).toBe('downloaded')
    expect(vi.mocked(downloadBytes)).toHaveBeenCalledWith(bytes, 'a.pdf')
  })

  it('canShare verneint Dateien: lädt herunter', async () => {
    stubShare(async () => undefined, false)
    expect(canShareFiles()).toBe(false)
    expect(await sharePdf(bytes, 'a.pdf')).toBe('downloaded')
    expect(navigator.share).not.toHaveBeenCalled()
  })

  it('teilt die PDF als Datei mit Namen und Typ', async () => {
    stubShare(async () => undefined)
    expect(canShareFiles()).toBe(true)
    expect(await sharePdf(bytes, 'brief.pdf')).toBe('shared')
    const data = vi.mocked(navigator.share).mock.calls[0]![0]!
    const file = data.files![0]!
    expect(file.name).toBe('brief.pdf')
    expect(file.type).toBe('application/pdf')
    expect(file.size).toBe(bytes.length)
    expect(vi.mocked(downloadBytes)).not.toHaveBeenCalled()
  })

  it('Abbruch im Teilen-Menü: kein Download', async () => {
    stubShare(async () => {
      throw new DOMException('abgebrochen', 'AbortError')
    })
    expect(await sharePdf(bytes, 'a.pdf')).toBe('cancelled')
    expect(vi.mocked(downloadBytes)).not.toHaveBeenCalled()
  })

  it('NotAllowedError: fordert frischen Klick an, beim zweiten Versuch Download', async () => {
    stubShare(async () => {
      throw new DOMException('keine Aktivierung', 'NotAllowedError')
    })
    expect(await sharePdf(bytes, 'a.pdf')).toBe('needs-gesture')
    expect(vi.mocked(downloadBytes)).not.toHaveBeenCalled()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await sharePdf(bytes, 'a.pdf', { fromDirectClick: true })).toBe('failed')
    expect(vi.mocked(downloadBytes)).toHaveBeenCalledTimes(1)
  })

  it('anderer Fehler: lädt stattdessen herunter', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    stubShare(async () => {
      throw new TypeError('kaputt')
    })
    expect(await sharePdf(bytes, 'a.pdf')).toBe('failed')
    expect(vi.mocked(downloadBytes)).toHaveBeenCalledTimes(1)
  })
})
