#!/usr/bin/env bash
#
# Deploy der PRIVATEN PDF-Editor-Variante (kodinitools.com/pdf-editor-privat).
#
# Baut aus demselben Repo wie die oeffentliche App, aber im Modus "private"
# (echtes Schwaerzen mit MuPDF, KI-Vorschlaege). Zwei Teile:
#   1. Frontend -> /var/www/kodinitools.com/pdf-editor-privat/ (atomar umgeschwenkt)
#   2. Backend (server/) -> /opt/kodini-apps/pdf-editor-privat-api/, systemd-Service
#      pdf-editor-privat-api auf 127.0.0.1:$PORT (Proxy zur Anthropic API)
#
# Einmalige Einrichtung auf dem Server (Details: README.md, Abschnitt "Private Variante"):
#   git clone https://github.com/KodiniTools/PDF-EDITOR.git /opt/kodini-build/pdf-editor-privat
#   chmod +x /opt/kodini-build/pdf-editor-privat/deploy/deploy-privat.sh
#   ss -tlnp | grep -w 3417 || echo "Port 3417 frei"
#   /etc/kodini/pdf-editor-privat-api.env aus deploy/pdf-editor-privat-api.env.example anlegen
#   Basic-Auth-Datei /etc/nginx/.htpasswd-pdf-editor-privat anlegen
#   nginx-Block aus deploy/nginx-pdf-editor-privat.conf einfuegen, nginx -t && systemctl reload nginx
#
# Aufruf:
#   /opt/kodini-build/pdf-editor-privat/deploy/deploy-privat.sh      # deployen
#   /opt/kodini-build/pdf-editor-privat/deploy/deploy-privat.sh -n   # Probelauf (baut + testet, aendert nichts)
#
# Konfigurierbar per Environment-Variable:
#   BRANCH=claude/feature    anderen Branch deployen (Standard: main)
#   NODE_BIN=/usr/bin/node   Node fuer den Dienst (Standard: command -v node)
#   CHECK_AUTH=user:pass     nach dem Deploy auch mit Login pruefen (API, WASM-MIME-Typ)
#
# Alles steckt in main(), damit ein "git reset" auf das Script selbst den
# laufenden Durchgang nicht zerreisst (bash liest Scripts sonst haeppchenweise).

set -euo pipefail

main() {
  local BRANCH="${BRANCH:-main}"
  local TARGET="${TARGET:-/var/www/kodinitools.com/pdf-editor-privat}"
  local OWNER="${OWNER:-www-data:www-data}"
  local URL="${URL:-https://kodinitools.com/pdf-editor-privat/}"
  local APP_DIR="${APP_DIR:-/opt/kodini-apps/pdf-editor-privat-api}"
  local ENV_FILE="${ENV_FILE:-/etc/kodini/pdf-editor-privat-api.env}"
  local HTPASSWD="${HTPASSWD:-/etc/nginx/.htpasswd-pdf-editor-privat}"
  local NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-enabled/kodinitools.com}"
  local SERVICE='pdf-editor-privat-api'
  local UNIT_FILE="/etc/systemd/system/$SERVICE.service"
  # Muss zu 'base' im Modus private in vite.config.ts passen.
  local BASE_PATH='/pdf-editor-privat/'
  local PNPM_VERSION='10.28.0'

  local dry_run=0
  case "${1:-}" in
    -n | --dry-run) dry_run=1 ;;
    -h | --help)
      sed -n '3,30p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'
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

  case "$TARGET" in
    /var/www/*/*) ;;
    *)
      err "TARGET '$TARGET' sieht nicht nach einem Tool-Verzeichnis aus (/var/www/<site>/<tool>)."
      return 1
      ;;
  esac
  case "$APP_DIR" in
    /opt/*/*) ;;
    *)
      err "APP_DIR '$APP_DIR' sieht nicht nach einem App-Verzeichnis aus (/opt/<...>/<app>)."
      return 1
      ;;
  esac

  require_cmd git
  require_cmd node
  require_cmd npx
  require_cmd curl
  require_cmd ss

  local sudo_cmd=()
  [[ $EUID -ne 0 ]] && sudo_cmd=(sudo)

  check_node_version || return 1

  local -a pnpm_cmd
  if command -v pnpm >/dev/null 2>&1; then
    pnpm_cmd=(pnpm)
  else
    pnpm_cmd=(npx -y "pnpm@$PNPM_VERSION")
  fi

  # --- 0. Voraussetzungen auf dem Server ----------------------------------
  local node_bin
  node_bin="$(readlink -f "${NODE_BIN:-$(command -v node)}")"
  case "$node_bin" in
    /root/* | /home/*)
      err "Node liegt unter $node_bin (z. B. nvm). Der Dienst laeuft mit ProtectHome und"
      err "eigenem Benutzer und kann dort nicht lesen. Bitte Node systemweit installieren"
      err "(z. B. NodeSource-Paket -> /usr/bin/node) oder NODE_BIN=/pfad/zu/node setzen."
      return 1
      ;;
  esac

  if ! "${sudo_cmd[@]}" test -f "$ENV_FILE"; then
    err "$ENV_FILE fehlt. Einmalig anlegen:"
    err "  sudo install -d -m 755 $(dirname "$ENV_FILE")"
    err "  sudo install -m 600 -o root -g root $script_dir/pdf-editor-privat-api.env.example $ENV_FILE"
    err "  sudo nano $ENV_FILE   # ANTHROPIC_API_KEY eintragen, PORT pruefen"
    return 1
  fi
  if ! "${sudo_cmd[@]}" grep -Eq '^ANTHROPIC_API_KEY=.+' "$ENV_FILE"; then
    err "In $ENV_FILE ist ANTHROPIC_API_KEY leer."
    return 1
  fi
  local port
  port="$("${sudo_cmd[@]}" sed -n 's/^PORT=\([0-9][0-9]*\).*/\1/p' "$ENV_FILE" | tail -1)"
  port="${port:-3417}"
  log "Backend-Port: $port"

  # Port belegt, aber nicht von unserem Dienst? Dann lieber abbrechen.
  if ss -Htln "sport = :$port" | grep -q .; then
    if ! systemctl is-active --quiet "$SERVICE"; then
      err "Port $port ist belegt, aber $SERVICE laeuft nicht. Wer lauscht dort?"
      err "  sudo ss -tlnp | grep -w $port"
      err "Freien Port waehlen: PORT in $ENV_FILE und proxy_pass im nginx-Block aendern."
      return 1
    fi
  fi

  if ! "${sudo_cmd[@]}" test -f "$HTPASSWD"; then
    err "$HTPASSWD fehlt -- ohne sie waere die Seite nicht geschuetzt bzw. nginx liefert 500."
    err "  sudo htpasswd -c -B $HTPASSWD kodini"
    return 1
  fi
  if [[ -r "$NGINX_SITE" ]]; then
    if ! grep -q "proxy_pass http://127.0.0.1:$port/api/" "$NGINX_SITE"; then
      warn "In $NGINX_SITE steht kein 'proxy_pass http://127.0.0.1:$port/api/'."
      warn "Ist der Block aus deploy/nginx-pdf-editor-privat.conf eingefuegt und der Port gleich?"
    fi
  fi

  if [[ ! -d "$repo_dir/.git" ]]; then
    err "$repo_dir ist kein Git-Checkout."
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

  # --- 2. Frontend bauen ---------------------------------------------------
  log "Installiere Abhaengigkeiten (Frontend) ..."
  "${pnpm_cmd[@]}" install --frozen-lockfile
  log "Teste Frontend (Vitest) ..."
  "${pnpm_cmd[@]}" run test
  log "Baue privates Frontend (Typecheck + Vite, Modus private) ..."
  "${pnpm_cmd[@]}" run build:privat

  if ! grep -q "${BASE_PATH}assets/" dist-privat/index.html 2>/dev/null; then
    err "dist-privat/index.html fehlt oder verweist nicht auf ${BASE_PATH}assets/."
    return 1
  fi
  if ! ls dist-privat/assets/pdf.worker*.mjs >/dev/null 2>&1; then
    err "pdf.js-Worker fehlt in dist-privat/assets/."
    return 1
  fi
  if ! ls dist-privat/assets/mupdf-wasm*.wasm >/dev/null 2>&1; then
    err "MuPDF-WASM fehlt in dist-privat/assets/ -- echtes Schwaerzen ginge nicht."
    return 1
  fi
  log "Frontend ok: $(find dist-privat -type f | wc -l) Dateien."

  # --- 3. Backend pruefen und paketieren -----------------------------------
  log "Teste Backend (server/) ..."
  (cd server && "${pnpm_cmd[@]}" install --frozen-lockfile && "${pnpm_cmd[@]}" run test && "${pnpm_cmd[@]}" run type-check)

  local api_build
  api_build="$(mktemp -d)"
  trap 'rm -rf "$api_build"' RETURN
  cp server/package.json server/pnpm-lock.yaml "$api_build"/
  cp -r server/src "$api_build"/src
  rm -rf "$api_build/src/__tests__"
  (cd "$api_build" && "${pnpm_cmd[@]}" install --prod --frozen-lockfile --config.node-linker=hoisted >/dev/null)
  log "Backend ok."

  if [[ $dry_run -eq 1 ]]; then
    log "PROBELAUF -- nichts wird geschrieben. Es wuerde:"
    log "  Frontend nach $TARGET/ legen ($(find dist-privat -type f | wc -l) Dateien)"
    log "  Backend nach $APP_DIR/ legen und $SERVICE (Node $node_bin, Port $port) neu starten"
    return 0
  fi

  # --- 4. Backend ausliefern + Dienst (mit Rollback) ------------------------
  local app_parent app_staging app_previous
  app_parent="$(dirname "$APP_DIR")"
  app_staging="$app_parent/.$(basename "$APP_DIR").new"
  app_previous="$app_parent/.$(basename "$APP_DIR").old"

  log "Installiere Backend nach $APP_DIR ..."
  "${sudo_cmd[@]}" mkdir -p "$app_parent"
  "${sudo_cmd[@]}" rm -rf "$app_staging" "$app_previous"
  "${sudo_cmd[@]}" cp -a "$api_build" "$app_staging"
  "${sudo_cmd[@]}" chown -R root:root "$app_staging"
  "${sudo_cmd[@]}" chmod -R u=rwX,go=rX "$app_staging"
  if [[ -d "$APP_DIR" ]]; then
    "${sudo_cmd[@]}" mv "$APP_DIR" "$app_previous"
  fi
  "${sudo_cmd[@]}" mv "$app_staging" "$APP_DIR"

  local unit_tmp
  unit_tmp="$(mktemp)"
  sed -e "s|@NODE@|$node_bin|g" -e "s|@APP_DIR@|$APP_DIR|g" "$script_dir/$SERVICE.service" >"$unit_tmp"
  if ! "${sudo_cmd[@]}" cmp -s "$unit_tmp" "$UNIT_FILE" 2>/dev/null; then
    log "Installiere/aktualisiere $UNIT_FILE ..."
    "${sudo_cmd[@]}" install -m 644 -o root -g root "$unit_tmp" "$UNIT_FILE"
    "${sudo_cmd[@]}" systemctl daemon-reload
    "${sudo_cmd[@]}" systemctl enable "$SERVICE" >/dev/null 2>&1
  fi
  rm -f "$unit_tmp"

  log "Starte $SERVICE neu ..."
  "${sudo_cmd[@]}" systemctl restart "$SERVICE"
  if ! wait_for_health "$port"; then
    err "$SERVICE antwortet nicht auf http://127.0.0.1:$port/api/health."
    "${sudo_cmd[@]}" journalctl -u "$SERVICE" -n 30 --no-pager >&2 || true
    if [[ -d "$app_previous" ]]; then
      warn "Rollback auf die vorherige Backend-Version ..."
      "${sudo_cmd[@]}" rm -rf "$APP_DIR"
      "${sudo_cmd[@]}" mv "$app_previous" "$APP_DIR"
      "${sudo_cmd[@]}" systemctl restart "$SERVICE" || true
    fi
    err "Frontend wurde nicht angefasst."
    return 1
  fi
  "${sudo_cmd[@]}" rm -rf "$app_previous"
  log "Backend laeuft (Port $port)."

  # --- 5. Frontend ausliefern ----------------------------------------------
  local parent staging previous
  parent="$(dirname "$TARGET")"
  staging="$parent/.$(basename "$TARGET").new"
  previous="$parent/.$(basename "$TARGET").old"

  log "Lege Frontend nach $TARGET ..."
  "${sudo_cmd[@]}" rm -rf "$staging" "$previous"
  "${sudo_cmd[@]}" mkdir -p "$staging"
  "${sudo_cmd[@]}" cp -a dist-privat/. "$staging"/
  "${sudo_cmd[@]}" chown -R "$OWNER" "$staging"
  "${sudo_cmd[@]}" chmod -R u=rwX,go=rX "$staging"
  if [[ -d "$TARGET" ]]; then
    "${sudo_cmd[@]}" mv "$TARGET" "$previous"
  fi
  "${sudo_cmd[@]}" mv "$staging" "$TARGET"
  "${sudo_cmd[@]}" rm -rf "$previous"

  # --- 6. Gegenprobe -------------------------------------------------------
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "$URL" || true)"
  case "$code" in
    401) log "$URL verlangt Anmeldung (401) -- Zugriffsschutz aktiv." ;;
    200)
      err "$URL ist OHNE Anmeldung erreichbar! auth_basic im nginx-Block pruefen."
      return 1
      ;;
    *)
      err "$URL antwortet mit HTTP $code (erwartet 401)."
      err "Ist der nginx-Block aus deploy/nginx-pdf-editor-privat.conf aktiv? nginx -t && systemctl reload nginx"
      return 1
      ;;
  esac

  if [[ -n "${CHECK_AUTH:-}" ]]; then
    local wasm wasm_type api
    wasm="$(basename "$(ls dist-privat/assets/mupdf-wasm*.wasm | head -1)")"
    wasm_type="$(curl -s -u "$CHECK_AUTH" -o /dev/null -w '%{content_type}' "${URL}assets/$wasm" || true)"
    if [[ "$wasm_type" != application/wasm* ]]; then
      err "MuPDF-WASM kommt als '$wasm_type' statt application/wasm (types im nginx-Block)."
      return 1
    fi
    api="$(curl -s -u "$CHECK_AUTH" "${URL}api/health" || true)"
    if [[ "$api" != *'"ok":true'* ]]; then
      err "API ueber nginx nicht erreichbar: ${URL}api/health -> $api"
      return 1
    fi
    log "Mit Login geprueft: WASM-MIME-Typ ok, API ueber nginx ok."
  fi
  log "Fertig."
}

check_node_version() {
  local node_ver node_major node_minor
  node_ver="$(node -p 'process.versions.node')"
  node_major="${node_ver%%.*}"
  node_minor="$(echo "$node_ver" | cut -d. -f2)"
  # Vite 8 / pdf.js 5 und das Backend (TypeScript direkt via Type Stripping)
  # brauchen Node ^22.18 oder >= 24.12.
  if [[ "$node_major" -lt 22 ]] ||
    [[ "$node_major" -eq 22 && "$node_minor" -lt 18 ]] ||
    [[ "$node_major" -eq 23 ]] ||
    [[ "$node_major" -eq 24 && "$node_minor" -lt 12 ]]; then
    err "Node v$node_ver ist zu alt/unpassend, gebraucht wird ^22.18 oder >= 24.12."
    return 1
  fi
}

wait_for_health() {
  local port="$1"
  for _ in $(seq 1 20); do
    if curl -fsS -o /dev/null "http://127.0.0.1:$port/api/health" 2>/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
err() { printf '\033[1;31m!!!\033[0m %s\n' "$*" >&2; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    err "'$1' ist nicht installiert."
    exit 1
  }
}

main "$@"
