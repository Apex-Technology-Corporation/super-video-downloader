#!/usr/bin/env bash
#
# 2-test-extension.sh — Super Video Downloader
# ─────────────────────────────────────────────────────────────────────────
# Deja la extensión lista para probar de un solo comando:
#
#   1. Abre Chrome en un perfil de pruebas AISLADO en /tmp (no toca tu
#      perfil ni tus sesiones habituales).
#   2. Activa "Developer mode" automáticamente (Chrome ya no acepta
#      extensiones descomprimidas sin esto).
#   3. Carga Super Video Downloader con el método oficial del DevTools Protocol
#      (Extensions.loadUnpacked) — el reemplazo moderno de --load-extension,
#      que Chrome empezó a ignorar si Developer mode está apagado.
#   4. Abre un video MP4 de enlace directo (o la URL que le pases) para que
#      pruebes la detección/descarga de una vez. OJO: sitios como YouTube o
#      Netflix usan streaming adaptativo (blob:/MSE) que esta extensión
#      detecta pero marca como "no descargable" a propósito — para probar
#      un caso realmente descargable usa una URL de video directo (.mp4).
#
# Uso:
#   ./tools/2-test-extension.sh
#   ./tools/2-test-extension.sh https://sitio-con-video-directo.example/video.mp4

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE_DIR="${TMPDIR:-${TMP:-/tmp}}/super-video-downloader-test-profile"
PORT=9333
URL="${1:-https://media.w3.org/2010/05/sintel/trailer.mp4}"

BROWSER=""
for bin in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge microsoft-edge-stable; do
  if command -v "$bin" >/dev/null 2>&1; then
    BROWSER="$bin"
    break
  fi
done

if [[ -z "$BROWSER" ]]; then
  for candidate in \
    "/c/Program Files/Google/Chrome/Application/chrome.exe" \
    "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" \
    "$LOCALAPPDATA/Google/Chrome/Application/chrome.exe" \
    "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
    "/c/Program Files/Microsoft/Edge/Application/msedge.exe"; do
    if [[ -n "$candidate" && -f "$candidate" ]]; then
      BROWSER="$candidate"
      break
    fi
  done
fi

if [[ -z "$BROWSER" ]]; then
  echo "No se encontró Chrome/Chromium/Edge instalado en el sistema." >&2
  exit 1
fi

PYTHON=""
for bin in python3 python py; do
  if command -v "$bin" >/dev/null 2>&1 && "$bin" -c "" >/dev/null 2>&1; then
    PYTHON="$bin"
    break
  fi
done

if [[ -z "$PYTHON" ]]; then
  echo "Se necesita python3 para automatizar la carga (no se encontró en PATH)." >&2
  exit 1
fi

if [[ ! -f "$ROOT_DIR/manifest.json" ]]; then
  echo "No se encontró manifest.json en $ROOT_DIR" >&2
  exit 1
fi

# Perfil siempre fresco: evita acumular recargas duplicadas de la extensión
# entre corridas y garantiza un estado predecible.
if command -v wmic >/dev/null 2>&1; then
  # Windows: matar solo los procesos que usan ESTE perfil de pruebas
  # (nunca todo chrome.exe, para no cerrar el Chrome normal del usuario).
  WIN_PROFILE_DIR="$(cd "$PROFILE_DIR" 2>/dev/null && pwd -W || true)"
  for pid in $(wmic process where "CommandLine like '%super-video-downloader-test-profile%'" get ProcessId 2>/dev/null | tr -d '\r' | grep -E '^[0-9]+$'); do
    taskkill //F //PID "$pid" >/dev/null 2>&1 || true
  done
else
  pkill -9 -f "user-data-dir=$PROFILE_DIR" >/dev/null 2>&1 || true
fi
sleep 0.5
rm -rf "$PROFILE_DIR"
mkdir -p "$PROFILE_DIR"

echo "Navegador: $BROWSER"
echo "Extensión: $ROOT_DIR"
echo "Perfil de pruebas: $PROFILE_DIR (aislado, no afecta tu perfil normal)"
echo

"$BROWSER" \
  --user-data-dir="$PROFILE_DIR" \
  --remote-debugging-port="$PORT" \
  --no-first-run \
  --no-default-browser-check \
  about:blank \
  >/dev/null 2>&1 &
disown

echo "Chrome abriéndose... activando Developer mode e instalando la extensión..."

if "$PYTHON" "$(dirname "${BASH_SOURCE[0]}")/_cdp_loader.py" "$PORT" "$ROOT_DIR" "$URL"; then
  echo
  echo "Listo. Super Video Downloader está instalada y activa en esta ventana de Chrome."
  echo "Abre el popup (icono de la barra de extensiones) para ver el video detectado y descargarlo."
else
  echo
  echo "No se pudo automatizar la instalación (ver error arriba)." >&2
  echo "Puedes hacerlo a mano: en la ventana que se abrió, ve a chrome://extensions," >&2
  echo "activa 'Developer mode' y usa 'Cargar descomprimida' seleccionando:" >&2
  echo "  $ROOT_DIR" >&2
  exit 1
fi
