# Cómo publicar Super Video Downloader en la Chrome Web Store

Guía paso a paso para subir la extensión al [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

Todo el contenido redactado (descripciones, justificación de permisos,
capturas) ya está preparado en [store-assets/](store-assets/) — esta guía
solo indica dónde pegarlo.

## 0. Generar el paquete

```powershell
powershell -File tools\3-build.ps1
# → dist\super-video-downloader-v1.0.0.zip
```

(En Linux/macOS con `zip` instalado: `./tools/3-build.sh`.)

Vuelve a correrlo cada vez que cambies el código, antes de subir una
nueva versión. Valida `manifest.json`, la sintaxis de todos los `.js`
(incluidos `offscreen/offscreen.js` y `scripts/hls-parser.js`), y que
existan los archivos de `vendor/ffmpeg/` — sin ellos la descarga de
streams HLS fallaría en producción aunque funcione en desarrollo.

## 1. Publicar la Política de Privacidad (antes de tocar el Dashboard)

`host_permissions: <all_urls>` obliga a tener una Política de Privacidad
pública. Ya está lista en [docs/privacy.html](docs/privacy.html) (y
[docs/index.html](docs/index.html) como landing).

1. En GitHub: **Settings → Pages → Source** → rama `main`, carpeta `/docs`.
2. Esperá a que publique (unos minutos) y anotá la URL, algo como
   `https://alvarosiles.github.io/super-video-downloader/`.
3. Confirmá que `privacy.html` carga **sin login** desde una ventana
   privada — el revisor de Google no tiene tu sesión.

## 2. Subir el paquete

**"+ Nuevo elemento"** → arrastrá `dist/super-video-downloader-v1.0.0.zip`.

## 3. Ficha de Play Store

Copiar/pegar directo de [store-assets/LISTING.md](store-assets/LISTING.md):

| Campo | Fuente |
|---|---|
| Descripción de un solo propósito | Sección "Descripción de un solo propósito" de LISTING.md |
| Descripción detallada | Sección "Descripción larga" de LISTING.md |
| Categoría | Herramientas |
| Idioma | Español |
| Capturas de pantalla (mín. 1, máx. 5, 1280×800) | `store-assets/screenshot-1-popup.png`, `screenshot-2-progress.png`, `screenshot-3-options.png` |
| Imagen promocional pequeña (440×280) | `store-assets/promo-small.png` |
| Imagen de marquesina (1400×560, opcional) | `store-assets/promo-marquee.png` |
| Icono de la tienda (128×128) | `assets/icons/icon128.png` |

## 4. Pestaña "Privacidad"

- **Justificación de cada permiso**: tabla completa en la sección
  "Permisos — justificación" de `store-assets/LISTING.md` — copiar cada
  fila en el campo correspondiente del permiso.
- **"¿Usás código remoto?"** → **No** (verificado por grep: sin `eval`,
  `new Function`, ni `<script src="http...">`; `ffmpeg.wasm` está
  empaquetado en `vendor/ffmpeg/`, no se carga de un CDN).
- **Casillas de "Uso de datos"**: ninguna marcada como recolectada — ver
  sección correspondiente en LISTING.md.
- **URL de Política de Privacidad**: la de GitHub Pages del paso 1.
- Mencioná explícitamente que la extensión **no elude DRM ni protecciones
  de streaming** (los recursos `blob:`/MediaSource cifrado se detectan
  pero se marcan como no descargables a propósito) — ayuda en la revisión
  manual, más estricta con extensiones de "descarga de video".

## 5. Distribución

- Visibilidad: **Público** (o "No listado" si querés probarlo primero
  con el link directo antes de listarlo).
- Precio: Gratis.
- Regiones: todas, salvo que quieras restringir alguna.

## 6. Cuenta de desarrollador

- Cuota única de registro (~$5 USD), si es tu primera publicación.
- **Verificación en 2 pasos (2FA)** obligatoria en la cuenta de Google que
  publica. Si ves *"Ocurrió un problema al subir el archivo... es
  necesario que habilites la verificación en 2 pasos"*, activala en
  [myaccount.google.com/security](https://myaccount.google.com/security)
  y reintentá.
- **Correo de contacto del publicador**: Configuración → Correo
  electrónico de contacto → verificarlo con el email que manda Google.
  Es obligatorio antes de poder publicar.

## 7. Enviar a revisión

Botón **"Enviar para revisión"**. Si aparece un diálogo de demora por
`host_permissions: <all_urls>`, es solo una advertencia — confirmá el
envío desde ahí mismo si el permiso es genuinamente necesario (lo es: no
hay lista fija de sitios soportados).

## Actualizar una versión ya publicada

1. Subí la versión en `manifest.json` (ej. `1.0.0` → `1.0.1`) y en
   `CHANGELOG.md`.
2. `powershell -File tools\3-build.ps1` de nuevo.
3. En el Dashboard, entrá al elemento publicado → **"Paquete"** → subí el
   nuevo `.zip` → enviar a revisión otra vez.
