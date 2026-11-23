/**
 * Oberflächenschrift aus dem Repo: Liegen `Supreme-Regular.woff2` und `Supreme-Bold.woff2`
 * in `src/assets/fonts/ui/`, werden sie gebündelt und hier registriert. Sonst kommt die
 * Schrift vom Server (`serverFonts` in vite.config.ts), und diese Funktion tut nichts.
 */
const files = import.meta.glob<string>('@/assets/fonts/ui/Supreme-{Regular,Bold}.woff2', {
  query: '?url',
  import: 'default',
  eager: true,
})

const WEIGHTS: Record<string, string> = { Regular: '400', Bold: '700' }

export function installUiFonts(): void {
  if (typeof FontFace === 'undefined') return
  const entries = Object.entries(files)
  // Nur vollständig: sonst mischen sich Server- und Repo-Schnitte.
  if (entries.length < 2) return
  for (const [path, url] of entries) {
    const weight = WEIGHTS[/Supreme-(Regular|Bold)\.woff2$/.exec(path)?.[1] ?? '']
    if (!weight) continue
    const face = new FontFace('Supreme', `url(${JSON.stringify(url)})`, {
      weight,
      style: 'normal',
      display: 'swap',
    })
    document.fonts.add(face)
    face.load().catch((err: unknown) => {
      console.error('[pdf-editor] Oberflächenschrift konnte nicht geladen werden', err)
    })
  }
}
