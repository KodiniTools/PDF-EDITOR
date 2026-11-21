import { describe, expect, it, vi } from 'vitest'

import { requestSuggestions, SuggestApiError } from '@/private/suggestions/api'

function response(status: number, body: unknown, json = true): Response {
  return new Response(json ? JSON.stringify(body) : String(body), {
    status,
    headers: { 'Content-Type': json ? 'application/json' : 'text/html' },
  })
}

describe('requestSuggestions', () => {
  const pages = [{ page: 1, lines: ['x'] }]

  it('sendet JSON und liest Vorschläge', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      response(200, {
        findings: [{ page: 1, text: 'Max', category: 'name', reason: 'r' }, { page: 'x' }],
      }),
    )
    const out = await requestSuggestions(pages, new AbortController().signal, fetchFn)
    expect(out).toEqual([{ page: 1, text: 'Max', category: 'name', reason: 'r' }])
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/api\/redaction-suggestions$/)
    expect(JSON.parse(String(init.body))).toEqual({ pages })
  })

  it('übersetzt HTTP-Fehler', async () => {
    const signal = new AbortController().signal
    await expect(
      requestSuggestions(pages, signal, async () => response(401, '<html>', false)),
    ).rejects.toThrow(/Anmeldung abgelaufen/)
    await expect(
      requestSuggestions(pages, signal, async () => response(429, { error: 'Bitte warten.' })),
    ).rejects.toThrow('Bitte warten.')
    await expect(
      requestSuggestions(pages, signal, async () => response(502, '<html>', false)),
    ).rejects.toBeInstanceOf(SuggestApiError)
  })

  it('meldet Netzwerkfehler verständlich', async () => {
    await expect(
      requestSuggestions(pages, new AbortController().signal, async () => {
        throw new TypeError('fetch failed')
      }),
    ).rejects.toThrow(/nicht erreichbar/)
  })
})
