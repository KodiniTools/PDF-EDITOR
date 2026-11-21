import { describe, expect, it } from 'vitest'

import { formatPageRanges } from '@/lib/pageRanges'

describe('formatPageRanges', () => {
  it('fasst Folgen zusammen', () => {
    expect(formatPageRanges([5, 1, 2, 3, 3])).toBe('1–3, 5')
    expect(formatPageRanges([7])).toBe('7')
    expect(formatPageRanges([1, 3, 4, 6])).toBe('1, 3–4, 6')
    expect(formatPageRanges([])).toBe('')
  })
})
