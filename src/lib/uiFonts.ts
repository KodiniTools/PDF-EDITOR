/**
 * Oberflächenschrift aus dem Repo: Liegt `Supreme-Regular.woff2` in `src/assets/fonts/ui/`,
 * wird sie gebündelt und hier registriert. Sonst kommt die Schrift vom Server
 * (`serverFonts` in vite.config.ts), und diese Funktion tut nichts.
 * Die Oberfläche nutzt nur den Regular-Schnitt (nirgends fett).
 */
const files = import.meta.glob<string>('@/assets/fonts/ui/Supreme-Regular.woff2', {
  query: '?url',
  import: 'default',
  eager: true,
})

export function installUiFonts(): void {
  if (typeof FontFace === 'undefined') return
  const url = Object.values(files)[0]
  if (!url) return
  const face = new FontFace('Supreme', `url(${JSON.stringify(url)})`, {
    weight: '400',
    style: 'normal',
    display: 'swap',
  })
  document.fonts.add(face)
  face.load().catch((err: unknown) => {
    console.error('[pdf-editor] Oberflächenschrift konnte nicht geladen werden', err)
  })
}
