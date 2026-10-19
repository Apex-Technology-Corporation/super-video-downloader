#!/usr/bin/env bash
#
# 1-install.sh — Super Video Downloader
# ─────────────────────────────────────────────────────────────────────────
# Chrome no permite instalar una extensión descomprimida de forma 100%
# silenciosa por línea de comandos (por seguridad, "Cargar descomprimida"
# siempre requiere un clic manual del usuario). Este script hace todo lo
# demás por ti: abre tu Chrome habitual en chrome://extensions, copia la
# ruta del proyecto al portapapeles (si hay una herramienta disponible) e
# imprime los pasos exactos que faltan.
#
# A diferencia de 2-test-extension.sh (que usa un perfil aislado solo para
# pruebas), este script abre tu perfil REAL de Chrome, porque la idea es
# dejar la extensión instalada para uso normal.
#
# Uso:
#   ./tools/1-install.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Busca un navegador basado en Chromium disponible en el sistema.
BROWSER=""
for bin in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge microsoft-edge-stable; do
  if command -v "$bin" >/dev/null 2>&1; then
    BROWSER="$bin"
    break
  fi
done

if [[ -z "$BROWSER" ]]; then
  echo "No se encontró Chrome/Chromium/Edge instalado en el sistema." >&2
  echo "Instala Google Chrome y vuelve a ejecutar este script." >&2
  exit 1
fi

if [[ ! -f "$ROOT_DIR/manifest.json" ]]; then
  echo "No se encontró manifest.json en $ROOT_DIR" >&2
  exit 1
fi

# Intenta copiar la ruta al portapapeles con lo que haya disponible.
COPIED=""
if command -v xclip >/dev/null 2>&1; then
  printf '%s' "$ROOT_DIR" | xclip -selection clipboard && COPIED="xclip"
elif command -v xsel >/dev/null 2>&1; then
  printf '%s' "$ROOT_DIR" | xsel --clipboard --input && COPIED="xsel"
elif command -v wl-copy >/dev/null 2>&1; then
  printf '%s' "$ROOT_DIR" | wl-copy && COPIED="wl-copy"
fi

echo "======================================================"
echo " Super Video Downloader — Instalación en tu Chrome"
echo "======================================================"
echo
echo "Carpeta de la extensión:"
echo "  $ROOT_DIR"
if [[ -n "$COPIED" ]]; then
  echo "  (copiada al portapapeles con $COPIED, pégala con Ctrl+V en el diálogo)"
fi
echo
echo "Pasos:"
echo "  1. Se abrirá chrome://extensions en tu navegador."
echo "  2. Activa el interruptor 'Modo de desarrollador' (arriba a la derecha)."
echo "  3. Haz clic en 'Cargar descomprimida'."
echo "  4. Selecciona la carpeta indicada arriba."
echo "  5. Fija el icono de Super Video Downloader en la barra (icono de puzzle 🧩)."
echo

"$BROWSER" "chrome://extensions" >/dev/null 2>&1 &
disown

echo "Abriendo chrome://extensions..."
