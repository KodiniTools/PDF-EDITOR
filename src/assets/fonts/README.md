# Schriften

Zwei Ordner, zwei Aufgaben. Dateien ablegen, committen, neu bauen. Code muss nicht
angepasst werden.

## `ui/` – Schrift der Oberfläche

Leisten, Knöpfe, Felder, Dialoge und die Startseite. Die Oberfläche nutzt ausschließlich
Supreme Regular und ist nirgends fett. Erwartet wird genau diese Datei:

- `Supreme-Regular.woff2`

Liegt sie hier, wird sie in den Build aufgenommen. Fehlt sie, lädt die App die
Schrift wie bisher vom Server unter `/fonts/` (siehe `serverFonts` in `vite.config.ts`).

## `editor/` – Schriften für den Seiteninhalt

Jede Schrift in diesem Ordner erscheint automatisch in der Schriftauswahl des Editors
und wird beim Export in das PDF eingebettet.

- Format: **`.ttf` oder `.otf`** (kein `.woff2`, das lässt sich nicht in ein PDF einbetten).
- Dateiname: `<Familie>-<Schnitt>.ttf`
  - Schnitt: `Regular`, `Bold`, `Italic`, `BoldItalic`
  - `_` im Familiennamen wird als Leerzeichen angezeigt: `Open_Sans-Regular.ttf` → „Open Sans“
- `Regular` ist Pflicht. Fehlt ein anderer Schnitt, zeigt der Browser Fett/Kursiv
  künstlich an; im exportierten PDF steht dann der nächstliegende vorhandene Schnitt.

Beispiel:

```
editor/
  Open_Sans-Regular.ttf
  Open_Sans-Bold.ttf
  Open_Sans-Italic.ttf
  Open_Sans-BoldItalic.ttf
  Caveat-Regular.ttf
```

## Lizenz

Das Repo ist öffentlich und die Schriften werden an jeden Besucher ausgeliefert und in
exportierte PDFs eingebettet. Nur Schriften ablegen, deren Lizenz Weitergabe, Web-Nutzung
und PDF-Einbettung erlaubt (z. B. SIL Open Font License). Lizenztext bitte daneben legen
(`<Familie>-LICENSE.txt`).
