/** Formatiert 1-basierte Seitennummern kompakt, z. B. [1, 2, 3, 5] → „1–3, 5“. */
export function formatPageRanges(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)]
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b)
  const parts: string[] = []
  let start = sorted[0]
  let prev = start
  for (const n of sorted.slice(1).concat(Number.NaN)) {
    if (start === undefined || prev === undefined) break
    if (n === prev + 1) {
      prev = n
      continue
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`)
    start = n
    prev = n
  }
  return parts.join(', ')
}
