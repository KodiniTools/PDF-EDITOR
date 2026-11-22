/** Zusätzliche Tastenkürzel des privaten Builds (für die Übersicht, Taste ?). */
import type { ShortcutGroup } from '@/lib/shortcuts'

export const PRIVATE_SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Privat: allgemein',
    items: [
      { keys: ['R'], label: 'Werkzeug Schwärzen' },
      { keys: ['N'], label: 'Neues Dokument' },
      { keys: ['K'], label: 'Kosten' },
    ],
  },
  {
    title: 'Privat: Seitenleiste rechts',
    items: [
      { keys: ['1', '2', '3', '4'], label: 'Reiter Schwärzen / Fragen / Formular / Bilder' },
      {
        keys: ['Strg+Enter'],
        label: 'Hauptaktion: Seite prüfen / KI ausfüllen / Bilder mit KI suchen',
      },
      {
        keys: ['Strg+Umschalt+Enter'],
        label: 'Schwärzen: alle Seiten prüfen · Bilder: neu suchen',
      },
      { keys: ['Strg+Alt+Enter'], label: 'Vorschläge übernehmen (Schwärzen, Formular)' },
      { keys: ['Enter', 'Umschalt+Enter'], label: 'Fragen: senden / neue Zeile' },
    ],
  },
  {
    title: 'Privat: KI-Leiste am Textfeld',
    items: [
      {
        keys: ['Alt+1', 'Alt+2', 'Alt+3', 'Alt+4'],
        label: 'Korrigieren / Kürzer / Förmlicher / Einfacher',
      },
      { keys: ['Alt+5'], label: 'Übersetzen (gewählte Sprache)' },
      { keys: ['Alt+Enter'], label: 'Vorschlag übernehmen' },
      { keys: ['Alt+⌫'], label: 'Vorschlag verwerfen bzw. Anfrage abbrechen' },
    ],
  },
  {
    title: 'Privat: Dialoge',
    items: [
      { keys: ['Strg+Enter'], label: 'Neues Dokument erstellen' },
      { keys: ['Enter'], label: 'Kosten: Zahlung eintragen (im Betragsfeld)' },
      { keys: ['Esc'], label: 'Dialog schließen' },
    ],
  },
]
