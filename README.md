# PDF-Editor (Vue 3)

Rein clientseitiger PDF-Editor: Dateien verlassen den Browser nicht.

## Funktionen

- PDFs öffnen (Button oder Drag & Drop), mehrere Dateien = **zusammenführen**
- Seiten anzeigen (pdf.js), Miniaturen lazy gerendert
- Seiten **drehen**, **löschen**, **umsortieren** (Drag & Drop oder ↑/↓)
- **Vorhandenen Text bearbeiten**: Textzeile anklicken → wird abgedeckt und als editierbarer Text (gleiche Position/Größe, passende Standardschrift) neu gesetzt
- **Abdecken** (Weiß/Schwarz/Farbe) – nur optisch, der Inhalt darunter bleibt in der PDF auslesbar
- Annotationen: **Text** (mehrzeilig, Größe/Farbe), **Markierung** (Rechteck, Farbe), **Signatur** (zeichnen oder PNG/JPEG hochladen)
- Annotationen verschieben, Markierung/Signatur skalieren, mit Entf löschen
- **Rückgängig/Wiederholen** mit 50 Schritten (Strg+Z, Strg+Y bzw. Strg+Umschalt+Z, Buttons ↶/↷); Ziehen und Tippen zählen je als ein Schritt
- **Export** als neue PDF (pdf-lib); Drehung und Annotationen werden eingebrannt

Tastatur: `V` Auswählen, `E` Text bearbeiten, `T` Text, `A` Abdecken, `H` Markieren, `S` Signatur, `↑/↓` Seite wechseln, `Entf` Annotation löschen, `Esc` Auswahl aufheben.

## Stack

Vue 3 (`<script setup>`, TS strict), Vite, Pinia, Vue Router, Tailwind CSS v4, Vitest + Vue Test Utils, ESLint + oxlint + Prettier, pdf.js (`pdfjs-dist`), pdf-lib.

## Start

```bash
pnpm install
pnpm dev          # http://localhost:5173/pdf-editor/
pnpm test         # Vitest einmalig; Watch-Modus: pnpm test:unit
pnpm lint
pnpm build        # Type-Check + Produktions-Build nach dist/
```

Node `^22.18` oder `>=24.12`.

## Deployment (kodinitools.com/pdf-editor)

Die App wird mit `base: '/pdf-editor/'` gebaut und als statische Dateien von nginx ausgeliefert (kein Node-Prozess auf dem Server).

Einmalig auf dem VPS:

```bash
git clone https://github.com/KodiniTools/PDF-EDITOR.git /opt/kodini-build/pdf-editor
chmod +x /opt/kodini-build/pdf-editor/deploy/deploy.sh
# Block aus deploy/nginx-pdf-editor.conf in den server{}-Block von
# /etc/nginx/sites-enabled/kodinitools.com einfügen, dann:
sudo nginx -t && sudo systemctl reload nginx
```

Jedes Update:

```bash
/opt/kodini-build/pdf-editor/deploy/deploy.sh -n   # Probelauf
/opt/kodini-build/pdf-editor/deploy/deploy.sh      # bauen, testen, atomar nach /var/www/kodinitools.com/pdf-editor/
```

Das Script prüft Node-Version, Asset-Präfix und dass der pdf.js-Worker (`.mjs`) als JavaScript ausgeliefert wird.

## Architektur

```
src/
  types/pdf.ts             Datenmodell (PageRef, Annotation, Tool)
  lib/geometry.ts          Koordinaten: Anzeige (gedreht, oben links) → PDF (unten links)
  services/pdfRenderer.ts  pdf.js: Öffnen + Rendern (einzige Stelle mit pdf.js)
  services/pdfExport.ts    pdf-lib: Validierung + Export (rein, in Node testbar)
  stores/document.ts       Pinia: Quellen, Seitenliste, Annotationen, Werkzeug, Zoom, Verlauf
  lib/undoHistory.ts       Snapshot-Verlauf (Undo/Redo, Bündelung, Limit)
  components/              Toolbar, Sidebar/Miniaturen, PageEditor (Overlay), SignatureDialog
  views/EditorView.vue     Layout, Datei-Drop, Tastaturkürzel, Download
```

- Die Seitenliste ist die Single Source of Truth: jede Seite verweist auf `sourceId + sourceIndex`; Löschen/Sortieren ändert nur die Liste, die Originalbytes bleiben unverändert.
- Annotationen werden in PDF-Punkten im *angezeigten* (gedrehten) Raum gespeichert; beim Drehen werden sie mitgeführt, beim Export über `displayToPdf` umgerechnet.
- Rohbytes und pdf.js-Dokumente liegen außerhalb des reaktiven States (Performance).

## Grenzen / Follow-ups

- Verschlüsselte oder passwortgeschützte PDFs werden abgelehnt.
- Export-Text nutzt Helvetica (WinAnsi): Umlaute/€ ok, nicht darstellbare Zeichen (z. B. Emoji, Kyrillisch) werden zu `?`. Abhilfe: eigene TTF via `@pdf-lib/fontkit` einbetten.
- „Text bearbeiten“ ersetzt Zeilen optisch (Abdeckung + neuer Text) mit Helvetica/Times/Courier; die Originalschrift und Fett/Kursiv werden nicht übernommen, der Originaltext bleibt unter der Abdeckung erhalten. Gescannte PDFs (ohne Textebene) und gedreht laufender Text sind nicht bearbeitbar.
- Keine Formularfelder. Der Undo-Verlauf lebt nur im Browser-Tab (geht beim Neuladen verloren).
- Formulare/Links der Quelle bleiben beim Kopieren der Seiten erhalten, Lesezeichen (Outline) nicht.
