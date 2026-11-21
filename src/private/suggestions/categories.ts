/**
 * Kategorien sensibler Daten. Muss zu CATEGORIES in server/src/suggest.ts passen;
 * unbekannte Werte werden als 'other' behandelt.
 */
export const CATEGORY_LABELS = {
  name: 'Name',
  address: 'Adresse',
  email: 'E-Mail',
  phone: 'Telefon',
  iban: 'IBAN/Konto',
  date_of_birth: 'Geburtsdatum',
  id_number: 'Ausweis-/Kundennr.',
  tax_id: 'Steuer-/Sozialvers.-Nr.',
  health: 'Gesundheit',
  financial: 'Finanzdaten',
  signature: 'Unterschrift',
  other: 'Sonstiges',
} as const

export type Category = keyof typeof CATEGORY_LABELS

export function toCategory(value: unknown): Category {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, value)
    ? (value as Category)
    : 'other'
}
