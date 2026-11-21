import { describe, expect, it, vi } from 'vitest'

import { requestOcr } from '@/private/ocr/api'
import { ocrToTextLines } from '@/private/ocr/lines'
import { SuggestApiError } from '@/private/suggestions/api'

describe('ocrToTextLines', () => {
  it('rechnet Bildpixel in Seitenpunkte um und erweitert die Rechtecke', () => {
    const [line] = ocrToTextLines(
      [{ text: 'Max', box: [100, 200, 300, 250] }],
      { width: 1000, height: 1000 },
      { width: 500, height: 800 },
    )
    // x 50–150 pt, y 160–200 pt, Höhe 40 pt → Rand x 12, y 6
    expect(line).toMatchObject({ key: 'ocr:0', text: 'Max', fontSize: 40, font: 'sans' })
    expect(line!.x).toBeCloseTo(38)
    expect(line!.top).toBeCloseTo(154)
    expect(line!.width).toBeCloseTo(124)
    expect(line!.height).toBeCloseTo(52)
    expect(line!.segments).toEqual([{ start: 0, end: 3, x: line!.x, width: line!.width }])
  })

  it('bleibt innerhalb der Seite', () => {
    const [line] = ocrToTextLines(
      [{ text: 'Rand', box: [0, 0, 1000, 1000] }],
      { width: 1000, height: 1000 },
      { width: 500, height: 500 },
    )
    expect(line).toMatchObject({ x: 0, top: 0, width: 500, height: 500 })
  })
})

describe('requestOcr', () => {
  it('sendet das Bild und filtert ungültige Zeilen', async () => {
    const fetchFn = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            lines: [
              { text: 'A', box: [1, 2, 3, 4] },
              { text: 'B', box: [1, 2, 3] },
              { text: ' ', box: [1, 2, 3, 4] },
              { text: 'C', box: [1, 2, 3, 'x'] },
            ],
          }),
        ),
    )
    const input = { image: 'abc', mediaType: 'image/jpeg' as const, width: 10, height: 20 }
    expect(await requestOcr(input, new AbortController().signal, fetchFn)).toEqual([
      { text: 'A', box: [1, 2, 3, 4] },
    ])
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/api\/ocr$/)
    expect(JSON.parse(String(init.body))).toEqual(input)
    await expect(
      requestOcr(input, new AbortController().signal, async () => new Response('{}')),
    ).rejects.toBeInstanceOf(SuggestApiError)
  })
})
