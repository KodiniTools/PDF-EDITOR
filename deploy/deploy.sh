#!/usr/bin/env bash
#
# Deploy des Kodini PDF-Editors auf den VPS.
#
# Holt den aktuellen Stand von main, baut ihn und legt das Ergebnis nach
# /var/www/kodinitools.com/pdf-editor/ ab. Reine Client-App: kein Node-Prozess,
# kein PM2, kein Nginx-Reload noetig (nur einmalig fuer den nginx-Block).
#
# Einmalige Einrichtung auf dem Server:
#   git clone https://github.com/KodiniTools/PDF-EDITOR.git /opt/kodini-build/pdf-editor
#   chmod +x /opt/kodini-build/pdf-editor/deploy/deploy.sh
#   nginx-Block aus deploy/nginx-pdf-editor.conf einfuegen, nginx -t && systemctl reload nginx
#
# Aufruf:
#   /opt/kodini-build/pdf-editor/deploy/deploy.sh          # deployen
#   /opt/kodini-build/pdf-editor/deploy/deploy.sh -n       # Probelauf, aendert nichts
#
# Konfigurierbar per Environment-Variable:
#   BRANCH=claude/mein-feature ./deploy/deploy.sh          # anderen Branch deployen
#   TARGET=/var/www/staging/pdf-editor ./deploy/deploy.sh  # anderes Zielverzeichnis
#
# Alles steckt in main(), damit ein "git reset" auf das Script selbst den
# laufenden Durchgang nicht zerreisst (bash liest Scripts sonst haeppchenweise).

set -euo pipefail

main() {
  local BRANCH="${BRANCH:-main}"
  local TARGET="${TARGET:-/var/www/kodinitools.com/pdf-editor}"
  local OWNER="${OWNER:-www-data:www-data}"
  local URL="${URL:-https://kodinitools.com/pdf-editor/}"
  # Muss zu 'base' in vite.config.ts passen -- wird nach dem Build geprueft.
  local BASE_PATH='/pdf-editor/'
  # Paketmanager-Version aus package.json ("packageManager").
  local PNPM_VERSION='10.28.0'

  local dry_run=0
  case "${1:-}" in
    -n | --dry-run) dry_run=1 ;;
    -h | --help)
      sed -n '3,23p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'
      return 0
      ;;
    '') ;;
    *)
      err "Unbekannte Option: $1 (siehe --help)"
      return 2
      ;;
  esac

  local script_dir repo_dir
  script_dir="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
  repo_dir="$(dirname "$script_dir")"

  # --- Sicherheitsnetz: das Ziel wird ersetzt. Ein Tippfehler in TARGET darf
  # --- nicht /var/www oder / treffen.
  case "$TARGET" in
    /var/www/*/*) ;;
    *)
      err "TARGET '$TARGET' sieht nicht nach einem Tool-Verzeichnis aus."
      err "Erwartet wird ein Pfad der Form /var/www/<site>/<tool>."
      return 1
      ;;
  esac

  require_cmd git
  require_cmd node
  require_cmd npx

  # Vite 8 / pdf.js 5 brauchen Node ^22.18 oder >= 24.12.
  local node_ver node_major node_minor
  node_ver="$(node -p 'process.versions.node')"
  node_major="${node_ver%%.*}"
  node_minor="$(echo "$node_ver" | cut -d. -f2)"
  if [[ "$node_major" -lt 22 ]] ||
    [[ "$node_major" -eq 22 && "$node_minor" -lt 18 ]] ||
    [[ "$node_major" -eq 23 ]] ||
    [[ "$node_major" -eq 24 && "$node_minor" -lt 12 ]]; then
    err "Node v$node_ver ist zu alt/unpassend, gebraucht wird ^22.18 oder >= 24.12."
    return 1
  fi

  # pnpm: vorhandenes nehmen, sonst die gepinnte Version ueber npx.
  local -a pnpm_cmd
  if command -v pnpm >/dev/null 2>&1; then
    pnpm_cmd=(pnpm)
  else
    pnpm_cmd=(npx -y "pnpm@$PNPM_VERSION")
  fi

  if [[ ! -d "$repo_dir/.git" ]]; then
    err "$repo_dir ist kein Git-Checkout."
    err "Einmalig: git clone https://github.com/KodiniTools/PDF-EDITOR.git $repo_dir"
    return 1
  fi

  cd "$repo_dir"

  # --- 1. Quellstand holen -------------------------------------------------
  log "Hole $BRANCH von origin ..."
  git fetch --prune origin "$BRANCH"
  git checkout -q -B "$BRANCH" "origin/$BRANCH"
  git reset -q --hard "origin/$BRANCH"
  git clean -qfd
  log "Stand: $(git log -1 --format='%h %s')"

  # --- 2. Bauen ------------------------------------------------------------
  log "Installiere Abhaengigkeiten (${pnpm_cmd[*]} install --frozen-lockfile) ..."
  "${pnpm_cmd[@]}" install --frozen-lockfile

  log "Teste (Vitest) ..."
  "${pnpm_cmd[@]}" run test

  log "Baue (Typecheck + Vite) ..."
  "${pnpm_cmd[@]}" run build

  # --- 3. Build pruefen, BEVOR das Live-Verzeichnis angefasst wird ----------
  if [[ ! -f dist/index.html ]]; then
    err "dist/index.html fehlt -- der Build hat nichts erzeugt."
    return 1
  fi
  if ! grep -q "${BASE_PATH}assets/" dist/index.html; then
    err "dist/index.html verweist nicht auf ${BASE_PATH}assets/."
    err "In vite.config.ts fehlt 'base: \"${BASE_PATH}\"' -- so gebaut bliebe"
    err "die Seite unter $URL weiss (alle Assets 404)."
    err "Live-Verzeichnis wurde nicht angefasst."
    return 1
  fi
  if ! ls dist/assets/pdf.worker*.mjs >/dev/null 2>&1; then
    err "pdf.js-Worker fehlt in dist/assets/ -- PDFs liessen sich nicht anzeigen."
    return 1
  fi
  log "Build ok: $(find dist -type f | wc -l) Dateien, Asset-Praefix ${BASE_PATH} stimmt."

  # --- 4. Ausliefern -------------------------------------------------------
  # Erst vollstaendig in ein Staging-Verzeichnis daneben kopieren, dann per mv
  # umschwenken (atomares rename im selben Elternverzeichnis).
  local parent staging previous
  parent="$(dirname "$TARGET")"
  staging="$parent/.$(basename "$TARGET").new"
  previous="$parent/.$(basename "$TARGET").old"

  if [[ $dry_run -eq 1 ]]; then
    log "PROBELAUF -- es wird nichts geschrieben. Es wuerde nach $TARGET/ gehen:"
    (cd dist && find . -type f | sed 's|^\./|    |')
    log "Probelauf beendet."
    return 0
  fi

  local sudo_cmd=()
  [[ $EUID -ne 0 ]] && sudo_cmd=(sudo)

  log "Baue neue Version in $staging ..."
  "${sudo_cmd[@]}" rm -rf "$staging" "$previous"
  "${sudo_cmd[@]}" mkdir -p "$staging"
  "${sudo_cmd[@]}" cp -a dist/. "$staging"/

  log "Setze Besitzer/Rechte ($OWNER) ..."
  "${sudo_cmd[@]}" chown -R "$OWNER" "$staging"
  "${sudo_cmd[@]}" chmod -R u=rwX,go=rX "$staging"

  log "Schwenke um -> $TARGET"
  if [[ -d "$TARGET" ]]; then
    "${sudo_cmd[@]}" mv "$TARGET" "$previous"
  fi
  "${sudo_cmd[@]}" mv "$staging" "$TARGET"
  "${sudo_cmd[@]}" rm -rf "$previous"

  # --- 5. Gegenprobe -------------------------------------------------------
  if command -v curl >/dev/null 2>&1; then
    local code worker worker_type
    code="$(curl -s -o /dev/null -w '%{http_code}' "$URL" || true)"
    if [[ "$code" != "200" ]]; then
      err "$URL antwortet mit HTTP $code (erwartet 200)."
      err "Ist der nginx-Block aus deploy/nginx-pdf-editor.conf aktiv?"
      err "Pruefe: tail -5 /var/log/nginx/kodinitools.com.error.log"
      return 1
    fi
    # Der Worker muss als JavaScript ausgeliefert werden, sonst laedt pdf.js nicht.
    worker="$(basename "$(ls dist/assets/pdf.worker*.mjs | head -1)")"
    worker_type="$(curl -s -o /dev/null -w '%{content_type}' "${URL}assets/$worker" || true)"
    if [[ "$worker_type" != *javascript* ]]; then
      err "pdf.js-Worker kommt als '$worker_type' statt JavaScript."
      err "Im nginx-Block fehlt der .mjs-Typ (siehe deploy/nginx-pdf-editor.conf)."
      return 1
    fi
    log "$URL antwortet mit 200, Worker ok. Fertig."
  else
    log "Fertig. (curl nicht vorhanden, keine Gegenprobe)"
  fi
}

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m!!!\033[0m %s\n' "$*" >&2; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    err "'$1' ist nicht installiert."
    exit 1
  }
}

main "$@"
