# PDF-Editor (Vue 3)

Rein clientseitiger PDF-Editor: Dateien verlassen den Browser nicht.

## Funktionen

- PDFs öffnen (Button oder Drag & Drop), mehrere Dateien = **zusammenführen**
- Seiten anzeigen (pdf.js), Miniaturen lazy gerendert
- Seiten **drehen**, **löschen**, **umsortieren** (Drag & Drop oder ↑/↓)
- **Vorhandenen Text bearbeiten**: Textzeile anklicken → wird abgedeckt und als editierbarer Text (gleiche Position/Größe, passende Standardschrift) neu gesetzt
- **Abdecken** (Weiß/Schwarz/Farbe) – nur optisch, der Inhalt darunter bleibt in der PDF auslesbar (echtes Schwärzen: siehe private Variante)
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

## Private Variante (kodinitools.com/pdf-editor-privat)

Gleicher Quellcode, eigener Build-Modus `private`. Nur für die Eigennutzung, hinter Basic Auth, nicht indexiert.

Zusätzlich zur öffentlichen App:

- **Echtes Schwärzen** (Werkzeug „Schwärzen“, Taste `R`): beim Export entfernt [MuPDF.js](https://mupdf.readthedocs.io/) Text, Vektorgrafik und Bildpixel unter den Flächen, löscht Kommentare, Links und Formularfelder (inkl. Feldwert) im Bereich, entfernt Metadaten (Info, XMP, PieceInfo, Vorschaubilder) und schreibt die Datei komplett neu. Danach wird geprüft, dass in den Flächen kein Text mehr extrahierbar ist, sonst bricht der Export ab. Im Editor sind Schwärzungen halbtransparent mit rotem Rand, im Export schwarz.
- **KI-Schwärzungsvorschläge** (Seitenleiste, Reiter „Schwärzen“): der Seitentext (pdf.js) geht über das eigene Backend an Claude; gefundene Stellen (Namen, Adressen, IBAN, Telefon, E-Mail, Geburtsdaten, IDs …) werden auf der Seite markiert, per Klick an-/abgewählt und mit „n schwärzen“ als echte Schwärzungen übernommen (ein Undo-Schritt).
- **Fragen zum Dokument** (Seitenleiste, Reiter „Fragen“): Chat über den Text aller Seiten, z. B. „Zusammenfassen“, „Fristen & Termine“, „Beträge“, „Kündigung“ oder eigene Fragen. Antworten nennen Seiten als „(S. 3)“; die Zahl springt zur Seite. Folgefragen beziehen sich auf den bisherigen Verlauf (der Dokumenttext wird im Backend per Prompt-Cache wiederverwendet). Seiten ohne Text (Scans) werden nicht berücksichtigt und angezeigt.
- **Gescannte Seiten** (ohne Textebene): werden für Schwärzungsvorschläge und Fragen per Bilderkennung (Claude Vision) gelesen. Das Seitenbild (JPEG, längste Seite 1568 px) geht einmal ans Backend, das Ergebnis wird pro Seite zwischengespeichert. Die Flächen sind dort ungenauer als bei echtem Text und werden großzügig bemessen; abschaltbar im Reiter „Schwärzen“. MuPDF schwärzt beim Export die Bildpixel.
- **Formulare ausfüllen** (Seitenleiste, Reiter „Formular“): erkennt Textfelder, Checkboxen, Radio-Gruppen und Auswahllisten samt Beschriftung auf der Seite. Werte lassen sich direkt eintragen oder mit „KI ausfüllen“ aus den **Stammdaten** vorschlagen (freier Text, nur im Browser gespeichert). Vorschläge werden einzeln oder gesammelt übernommen; auf der Seite erscheint eine Vorschau. Beim Export trägt MuPDF die Werte ein und übernimmt alle Felder fest in die Seiten (der Export enthält ohnehin kein ausfüllbares Formular mehr). Felder in geschwärzten Bereichen werden vorher entfernt. Nicht unterstützt: Listenfelder mit Mehrfachauswahl, Unterschriftsfelder, schreibgeschützte Felder.
- **Umschreiben & Übersetzen**: unter einem ausgewählten Textfeld (eigener Text oder per „Text bearbeiten“ ersetzte Zeile) erscheint eine KI-Leiste: Korrigieren, Kürzer, Förmlicher, Einfacher, Übersetzen (Deutsch, Englisch, Französisch, Spanisch, Italienisch, Niederländisch, Portugiesisch). Das Ergebnis erscheint als Vorschau und wird per „Übernehmen“ eingesetzt (ein Undo-Schritt). Ersetzte PDF-Zeilen bleiben einzeilig; Zeichen, die die PDF-Standardschrift nicht kennt, werden vorab angezeigt.

MuPDF steht unter AGPL und landet **nur** im privaten Build: privater Code liegt in `src/private/` und wird nur hinter `__PRIVATE__` (Build-Konstante) dynamisch importiert. `deploy/deploy.sh` bricht ab, falls `dist/` doch MuPDF enthält.

```bash
pnpm dev:privat        # http://localhost:5173/pdf-editor-privat/ (API-Proxy auf 127.0.0.1:3417)
pnpm build:privat      # -> dist-privat/
cd server && pnpm install && ANTHROPIC_API_KEY=… pnpm dev   # Backend lokal (oder server/.env)
cd server && pnpm test && pnpm type-check
```

### Backend (`server/`)

Kleiner Node-Server ohne Framework (`node:http`, TypeScript direkt per Node-Type-Stripping, Node `^22.18` / `>=24.12`), einzige Abhängigkeit `@anthropic-ai/sdk`. Lauscht nur auf `127.0.0.1`; nginx übernimmt TLS und Zugriffsschutz.

- `GET /api/health` → `{ ok, model }`
- `POST /api/redaction-suggestions` mit `{ pages: [{ page, lines: [...] }] }` → `{ findings: [{ page, text, category, reason }] }`
- `POST /api/form-suggestions` mit `{ fields: [{ id, type: 'text' | 'checkbox' | 'radio' | 'choice', label, context, page, options?, multiline?, maxLength? }], profile, pages? }` → `{ suggestions: [{ id, value, reason }] }`
- `POST /api/ocr` mit `{ image: <base64>, mediaType: 'image/jpeg' | 'image/png', width, height }` → `{ lines: [{ text, box: [x0, y0, x1, y1] }] }` (Bildpixel)
- `POST /api/rewrite` mit `{ text, mode: 'correct' | 'shorter' | 'formal' | 'simple' | 'translate', language?, singleLine? }` → `{ text }`
- `POST /api/ask` mit `{ pages, messages: [{ role: 'user' | 'assistant', content }] }` (abwechselnd, letzte = Frage, höchstens 40) → `{ answer }`

Der API-Key steht nur in `/etc/kodini/pdf-editor-privat-api.env` (Vorlage: `deploy/pdf-editor-privat-api.env.example`) und verlässt den Server nie. Modell: `claude-opus-5-5` (über `ANTHROPIC_MODEL` änderbar), strukturierte JSON-Ausgabe, automatischer Fallback bei Ablehnung. Das Backend verwirft Treffer, die nicht wörtlich im Seitentext stehen, und loggt keinen Dokumentinhalt. Größenlimits: 1 MB Body, 60 000 Zeichen pro Schwärzungsanfrage (das Frontend teilt längere Dokumente auf), 400 000 Zeichen Dokumenttext pro Frage (`MAX_ASK_CHARS`; das Frontend schickt höchstens 300 000 und kürzt den Verlauf, damit die Anfrage unter 1 MB bleibt), höchstens 2 KI-Anfragen gleichzeitig.

### Einrichtung auf dem VPS (einmalig)

```bash
# 1. Freien Port prüfen (Standard 3417). Keine Ausgabe = frei.
sudo ss -tlnp | grep -w 3417

# 2. Eigener Checkout für die private Variante
git clone https://github.com/KodiniTools/PDF-EDITOR.git /opt/kodini-build/pdf-editor-privat
chmod +x /opt/kodini-build/pdf-editor-privat/deploy/deploy-privat.sh

# 3. Konfiguration mit API-Key (Port ggf. anpassen)
sudo install -d -m 755 /etc/kodini
sudo install -m 600 -o root -g root /opt/kodini-build/pdf-editor-privat/deploy/pdf-editor-privat-api.env.example /etc/kodini/pdf-editor-privat-api.env
sudo nano /etc/kodini/pdf-editor-privat-api.env

# 4. Zugangsdaten für Basic Auth (apache2-utils)
sudo htpasswd -c -B /etc/nginx/.htpasswd-pdf-editor-privat kodini

# 5. Block aus deploy/nginx-pdf-editor-privat.conf in den server{}-Block von
#    /etc/nginx/sites-enabled/kodinitools.com einfügen (Port in proxy_pass = PORT aus Schritt 3)
sudo nginx -t && sudo systemctl reload nginx

# 6. Deployen (installiert auch den systemd-Service pdf-editor-privat-api)
/opt/kodini-build/pdf-editor-privat/deploy/deploy-privat.sh -n   # Probelauf
/opt/kodini-build/pdf-editor-privat/deploy/deploy-privat.sh
```

Ist 3417 belegt: anderen Port wählen (z. B. `sudo ss -tlnp | grep -w 3427`), in der env-Datei `PORT=` und im nginx-Block `proxy_pass` ändern. `deploy-privat.sh` warnt, wenn beide nicht zusammenpassen.

Das Skript prüft Node-Version, env-Datei, API-Key, Port, htpasswd, baut und testet Frontend und Backend, installiert das Backend nach `/opt/kodini-apps/pdf-editor-privat-api/` (mit Rollback, falls `/api/health` nicht antwortet), schwenkt das Frontend atomar nach `/var/www/kodinitools.com/pdf-editor-privat/` und prüft zum Schluss, dass die Seite ohne Login **401** liefert. Mit `CHECK_AUTH=kodini:passwort` prüft es zusätzlich API und WASM-MIME-Typ über nginx.

Betrieb: `systemctl status pdf-editor-privat-api`, Logs: `journalctl -u pdf-editor-privat-api -f`. Der Dienst läuft mit `DynamicUser` und Härtung; Node muss systemweit installiert sein (nicht unter `/root` oder `/home`, z. B. nvm).

Grenzen: Gescannte Seiten ohne Textebene bekommen keine KI-Vorschläge (manuell schwärzen). Die Position innerhalb eines Textelements wird über Zeichenbreiten geschätzt; die Flächen sind leicht großzügig und können ein angrenzendes Satzzeichen mit entfernen. Ein Formularfeld mit mehreren Widgets verliert beim Schwärzen eines Widgets seinen Wert insgesamt.

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
  private/                 nur privater Build: MuPDF-Schwärzung, KI-Vorschläge (Store, Panel, Overlay)
server/                    Backend der privaten Variante (Proxy zur Anthropic API)
deploy/                    nginx-Blöcke, deploy.sh (öffentlich), deploy-privat.sh + systemd-Unit (privat)
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
