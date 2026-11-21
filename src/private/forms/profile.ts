/**
 * Stammdaten für das Ausfüllen von Formularen. Bleiben nur in diesem Browser
 * (localStorage) und gehen nur beim Klick auf „KI ausfüllen“ an das Backend.
 */
const KEY = 'pdf-editor-privat:stammdaten'
export const MAX_PROFILE_LENGTH = 20_000

export function loadProfile(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

/** Liefert false, wenn der Browser nicht speichern kann (z. B. privates Fenster). */
export function saveProfile(text: string): boolean {
  try {
    if (text.trim()) localStorage.setItem(KEY, text.slice(0, MAX_PROFILE_LENGTH))
    else localStorage.removeItem(KEY)
    return true
  } catch {
    return false
  }
}
