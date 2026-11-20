let counter = 0

/** Eindeutige ID; nutzt crypto.randomUUID, wenn verfügbar (nicht in unsicheren Kontexten). */
export function createId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`
  }
  counter += 1
  return `${prefix}_${Date.now().toString(36)}_${counter}`
}
