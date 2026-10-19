#!/usr/bin/env bash
#
# 3-build.sh — Super Video Downloader
# ─────────────────────────────────────────────────────────────────────────
# Empaqueta la extensión en un .zip listo para subir a la Chrome Web Store
# (o para distribuir manualmente). Solo incluye los archivos que la
# extensión necesita en tiempo de ejecución (nada de scripts/, README,
# LICENSE, gen_icons.py, .git, etc.), y valida que manifest.json sea JSON
# válido y que todos los iconos declarados existan antes de comprimir.
#
# Uso:
#   ./tools/3-build.sh
#
# Salida:
#   dist/super-video-downloader-v<version>.zip

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
MANIFEST="$ROOT_DIR/manifest.json"

cd "$ROOT_DIR"

if ! command -v zip >/dev/null 2>&1; then
  echo "Falta el comando 'zip'. Instálalo (ej: sudo apt install zip) y reintenta." >&2
  exit 1
fi

if [[ ! -f "$MANIFEST" ]]; then
  echo "No se encontró manifest.json en $ROOT_DIR" >&2
  exit 1
fi

# ── 1. Validar manifest.json ──────────────────────────────────────────────
if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$MANIFEST" 2>/dev/null; then
  echo "manifest.json no es un JSON válido. Corrígelo antes de compilar." >&2
  exit 1
fi

VERSION="$(python3 -c "import json; print(json.load(open('$MANIFEST'))['version'])")"
echo "Versión detectada: $VERSION"

# La Chrome Web Store rechaza el .zip si "description" supera 132
# caracteres — validarlo acá evita descubrirlo recién al subir el archivo.
DESC_LEN="$(python3 -c "import json; print(len(json.load(open('$MANIFEST')).get('description','')))")"
if [[ "$DESC_LEN" -gt 132 ]]; then
  echo "manifest.json: 'description' tiene $DESC_LEN caracteres (máx. 132 para la Chrome Web Store)." >&2
  exit 1
fi

# Nombrar marcas de plataformas de terceros en textos/capturas de la ficha
# ya nos costó un rechazo por "Spam con palabras clave" (Yellow Argon en
# Super Volume) y probablemente contribuyó a otro (Yellow Nickel en este
# proyecto) — se busca en manifest.json y en todo lo que sirve de fuente
# para pegar en el Dashboard (store-assets/, README.md, docs/).
BRAND_PATTERN='\bYouTube\b|\bNetflix\b|\bTwitch\b|\bSpotify\b|\bTikTok\b|\bVimeo\b|\bFacebook\b|\bInstagram\b|\bDisney\+|\bAmazon Prime\b|\bHBO\b|\bHulu\b'
BRAND_HITS="$(grep -rniE "$BRAND_PATTERN" "$MANIFEST" store-assets/ README.md docs/ 2>/dev/null || true)"
if [[ -n "$BRAND_HITS" ]]; then
  echo "Se encontraron nombres de plataformas de terceros (posible 'Spam con palabras clave'):" >&2
  echo "$BRAND_HITS" >&2
  echo "Quitalos o generalizalos (ej: 'plataformas con protección DRM') antes de compilar." >&2
  exit 1
fi

# ── 2. Archivos que forman parte del paquete final ─────────────────────────
FILES=(
  manifest.json
  background.js
  content.js
  scripts/utils.js
  scripts/storage.js
  scripts/detector.js
  scripts/downloader.js
  scripts/hls-parser.js
  offscreen/offscreen.html
  offscreen/offscreen.js
  vendor/ffmpeg/ffmpeg.js
  vendor/ffmpeg/814.ffmpeg.js
  vendor/ffmpeg/ffmpeg-core.js
  vendor/ffmpeg/ffmpeg-core.wasm
  popup/popup.html
  popup/popup.css
  popup/popup.js
  options/options.html
  options/options.css
  options/options.js
  assets/icons/icon16.png
  assets/icons/icon32.png
  assets/icons/icon48.png
  assets/icons/icon128.png
)

MISSING=0
for f in "${FILES[@]}"; do
  if [[ ! -f "$ROOT_DIR/$f" ]]; then
    echo "Falta un archivo requerido: $f" >&2
    MISSING=1
  fi
done
if [[ "$MISSING" -eq 1 ]]; then
  echo "Compilación cancelada: hay archivos requeridos ausentes." >&2
  exit 1
fi

# ── 3. Validar sintaxis de los .js si Node está disponible ─────────────────
if command -v node >/dev/null 2>&1; then
  for js in background.js content.js scripts/utils.js scripts/storage.js scripts/detector.js scripts/downloader.js scripts/hls-parser.js offscreen/offscreen.js popup/popup.js options/options.js; do
    if ! node --check "$js"; then
      echo "Error de sintaxis en $js. Corrígelo antes de compilar." >&2
      exit 1
    fi
  done
  echo "Sintaxis de los .js OK"
fi

# ── 4. Empaquetar ───────────────────────────────────────────────────────────
mkdir -p "$DIST_DIR"
ZIP_PATH="$DIST_DIR/super-video-downloader-v${VERSION}.zip"
rm -f "$ZIP_PATH"

zip -q -X "$ZIP_PATH" "${FILES[@]}"

echo
echo "======================================================"
echo " Paquete generado: $ZIP_PATH"
echo "======================================================"
du -h "$ZIP_PATH" | cut -f1 | xargs -I{} echo "Tamaño: {}"
echo
echo "Contenido:"
unzip -l "$ZIP_PATH"
echo
echo "Listo para subir a https://chrome.google.com/webstore/devconsole"
