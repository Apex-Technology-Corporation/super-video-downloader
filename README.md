# ⬇️ Super Video Downloader

Extensión de navegador **Manifest V3** para Google Chrome y navegadores basados
en Chromium (Edge, Brave, Opera) que detecta los videos descargables de la
página actual y los guarda con un clic. Además de los archivos con enlace
directo, reconstruye streams **HLS sin cifrar** (`.m3u8`) en un único `.mp4`
usando **ffmpeg.wasm** dentro del propio navegador, sin servidores
intermedios ni programas externos.

> **No elude DRM, cifrado ni protecciones de streaming.** Las fuentes
> `blob:`/MediaSource se listan para que el usuario sepa que existen, pero se
> marcan como no descargables a propósito. Los streams HLS con `#EXT-X-KEY`
> cifrado se rechazan con un error explícito.

- **Autor:** alvarosiles · alvarosiles.developer@gmail.com
- **Repositorio (remoto `origin`):** [github.com/Apex-Technology-Corporation/super-video-downloader](https://github.com/Apex-Technology-Corporation/super-video-downloader)
- **Versión:** 1.0.0 (`manifest.json`) · **Licencia:** MIT

![Popup con un video detectado sobre una página de prueba local](presentacion/01-vista-principal.png)

---

## Índice

1. [Descripción general](#1-descripción-general)
2. [Objetivo y problema que resuelve](#2-objetivo-y-problema-que-resuelve)
3. [Características principales](#3-características-principales)
4. [Arquitectura](#4-arquitectura)
5. [Estructura del proyecto](#5-estructura-del-proyecto)
6. [Tecnologías y versiones](#6-tecnologías-y-versiones)
7. [Módulos y funcionalidades](#7-módulos-y-funcionalidades)
8. [Persistencia de datos](#8-persistencia-de-datos)
9. [Backend y API (mensajería interna)](#9-backend-y-api-mensajería-interna)
10. [Configuración e instalación](#10-configuración-e-instalación)
11. [Variables de entorno](#11-variables-de-entorno)
12. [Ejecución en desarrollo](#12-ejecución-en-desarrollo)
13. [Compilación y despliegue](#13-compilación-y-despliegue)
14. [Seguridad y permisos](#14-seguridad-y-permisos)
15. [Limitaciones identificadas](#15-limitaciones-identificadas)
16. [Preguntas frecuentes](#16-preguntas-frecuentes)

---

## 1. Descripción general

Super Video Downloader escanea la pestaña activa en busca de elementos
`<video>`, `<source>` y enlaces `<a>` a archivos de video, y además observa
las peticiones de red de la pestaña para capturar manifiestos HLS/DASH que el
DOM nunca expone (cuando el reproductor usa MediaSource, el `<video>` solo
muestra un `blob:`). Con esa información, el popup lista cada video con
miniatura, duración, calidades disponibles y tamaño, y permite descargarlo o
copiar su URL.

Todo el procesamiento ocurre en el navegador: no hay backend propio, ni
analítica, ni código remoto. `ffmpeg.wasm` va empaquetado en `vendor/ffmpeg/`.

## 2. Objetivo y problema que resuelve

Muchos sitios publican videos descargables (archivos directos o HLS sin
cifrar), pero no ofrecen un botón de descarga, o la URL real queda oculta
detrás de un reproductor JavaScript. Para obtener el archivo, el usuario
tendría que inspeccionar la red con DevTools y, en el caso de HLS, unir los
segmentos con herramientas de línea de comandos.

La extensión automatiza ese proceso dentro de los límites del navegador:
detecta la fuente, elige la calidad y genera el archivo final localmente,
respetando explícitamente el contenido protegido con DRM.

## 3. Características principales

- **Detección en el DOM** de `<video>`/`<source>` con URL `http(s)`/`data:`,
  incluidos los que aparecen después de cargar la página (`MutationObserver`).
- **Detección por red** de manifiestos `.m3u8` y `.mpd` con `chrome.webRequest`
  (solo lectura de URLs; no se bloquea ni modifica tráfico).
- **Reconstrucción HLS → MP4** con ffmpeg.wasm en un *offscreen document*:
  descarga de segmentos, `concat` y remux sin recodificar (`-c copy`).
- **Selector de calidad**: agrupa variantes de un mismo video (`<source>`
  múltiples, variantes HLS, enlaces "480p/720p/1080p") en una sola tarjeta.
- **Progreso** con porcentaje y velocidad, botón para cancelar, y progreso
  en el *badge* del icono aunque el popup se cierre.
- **Botón flotante** sobre cada `<video>` visible (Shadow DOM cerrado) que
  abre el popup con el selector de calidad desplegado.
- **Menú contextual** con los videos detectados en la pestaña.
- **Badge** con el número de videos detectados por pestaña.
- **Filtro de anuncios**: descarta clips de menos de 25 s si en la página hay
  un video más largo.
- **Opciones**: subcarpeta de descarga, nombre automático o "Guardar como",
  notificaciones, tema oscuro/claro, idioma (es/en), actualización automática.
- **Historial** de descargas (fecha, archivo, tamaño, sitio) con borrado
  individual o total; máximo 200 entradas.

## 4. Arquitectura

Extensión MV3 sin framework ni bundler. Cinco contextos de ejecución se
comunican por `chrome.runtime` / `chrome.tabs` mensajes:

```
 Página web
 ├─ content.js + scripts/detector.js ── escanea el DOM, responde SVD_GET_VIDEOS,
 │                                       informa el conteo (SVD_BADGE_COUNT)
 └─ overlay.js (all_frames) ─────────── botón flotante → SVD_OPEN_POPUP
            │
            ▼
 background.js (service worker)
 ├─ webRequest: registra .m3u8/.mpd por pestaña
 ├─ badge, menú contextual, historial y notificaciones (downloads.onChanged)
 ├─ declarativeNetRequest: fija Referer/Origin temporalmente para el CDN
 └─ crea/cierra el offscreen document y reenvía el progreso
            │
            ▼
 offscreen/offscreen.js ── ffmpeg.wasm: segmentos → concat → output.mp4 (blob:)
            │
            ▼
 chrome.downloads.download(blob:) → historial + notificación

 popup/ (UI principal)  ·  options/ (configuración + historial)
```

Decisiones técnicas verificables en el código:

- **Scripts clásicos compartidos** (`scripts/utils.js`, `scripts/storage.js`)
  cargados en content scripts, popup, opciones y service worker
  (`importScripts`), para no duplicar lógica sin necesitar un bundler.
- **Única puerta a `chrome.storage.local`** en `scripts/storage.js`.
- **Una instancia de ffmpeg.wasm por descarga**, terminada con `.terminate()`,
  porque la memoria lineal de WebAssembly no se libera dentro de la misma
  instancia. El offscreen document se cierra cuando no quedan descargas.
- **Segmentos escritos directamente al FS virtual de ffmpeg** para reducir el
  pico de memoria en JavaScript.
- **Regla dinámica de `declarativeNetRequest`** (ID 9001) que se agrega justo
  antes de pedir el manifiesto y se elimina en un `finally`.
- **Escaneo "barato" vs. "caro"**: el conteo del badge no hace peticiones; el
  tamaño (`HEAD`) solo se pide cuando el popup se abre.

## 5. Estructura del proyecto

```
super-video-downloader/
├── manifest.json            # MV3: permisos, content scripts, CSP, Chrome ≥ 109
├── background.js            # Service worker: red, badge, menú, historial, offscreen
├── content.js               # Orquesta la detección en la pestaña
├── overlay.js               # Botón flotante sobre cada <video>
├── scripts/                 # Módulos compartidos (scripts clásicos)
│   ├── utils.js             # Formatos, MIME, nombres de archivo, i18n es/en
│   ├── storage.js           # Ajustes e historial en chrome.storage.local
│   ├── detector.js          # Escaneo del DOM, tamaños vía HEAD, observer
│   ├── downloader.js        # Envoltorio de chrome.downloads.download()
│   └── hls-parser.js        # Parser mínimo de playlists HLS (RFC 8216)
├── offscreen/               # Documento offscreen que ejecuta ffmpeg.wasm
├── vendor/ffmpeg/           # ffmpeg.wasm empaquetado localmente (~31 MB el .wasm)
├── popup/                   # UI principal (html, css, js)
├── options/                 # Configuración e historial (html, css, js)
├── assets/icons/            # Iconos 16/32/48/128
├── gen_icons.py             # Regenera los iconos (Pillow)
├── tools/                   # Scripts de desarrollo (no van en el paquete)
│   ├── 1-install.sh         # Abre chrome://extensions en el Chrome del usuario
│   ├── 2-test-extension.sh/.ps1  # Chrome con perfil aislado + extensión cargada
│   ├── _cdp_loader.py       # Cliente CDP sin dependencias (WebSocket manual)
│   └── 3-build.sh/.ps1      # Valida y empaqueta en dist/
├── docs/                    # Landing y política de privacidad (GitHub Pages)
├── store-assets/            # Ficha, capturas y promos para la Chrome Web Store
├── presentacion web/        # Página de presentación + paquete descargable
├── presentacion/            # Capturas de la aplicación en funcionamiento
├── PUBLISHING.md · CHANGELOG.md · LICENSE · README.md
└── version-portafolio.md    # Documentación para el portafolio
```

## 6. Tecnologías y versiones

| Categoría | Tecnología | Versión / evidencia |
|---|---|---|
| Lenguaje | JavaScript (ES2020+, sin módulos ES) | `?.`, `??`, `async/await` en el código |
| Plataforma | Chrome Extensions Manifest V3 | `manifest_version: 3`, `minimum_chrome_version: "109"` |
| UI | HTML5 + CSS3 (variables, tema claro/oscuro) | `popup/`, `options/` |
| Procesamiento de video | ffmpeg.wasm (WebAssembly) | `@ffmpeg/core@0.12.9` referenciado en `vendor/ffmpeg/814.ffmpeg.js` |
| Persistencia | `chrome.storage.local` | `scripts/storage.js` |
| Scripts de desarrollo | Bash, PowerShell, Python 3 (stdlib) | `tools/` |
| Generación de iconos | Python + Pillow | `gen_icons.py` |
| Validación de sintaxis | Node.js (`node --check`, opcional) | `tools/3-build.*` |

No hay `package.json`, bundler, framework de UI ni tests automatizados.

## 7. Módulos y funcionalidades

| Módulo | Responsabilidad |
|---|---|
| `scripts/detector.js` | Recoge candidatos de `<video>`, `<source>` (con `label`/`size`) y `<a href>` a archivos de video; deduplica por URL; agrupa variantes por reproductor; filtra anuncios cortos; `enrichWithSize()` hace `HEAD` para `Content-Length`. |
| `content.js` | Responde `SVD_GET_VIDEOS` (con dominio y `og:image` como miniatura de respaldo) y envía `SVD_BADGE_COUNT`; activa el observer si "actualización automática" está encendida. |
| `overlay.js` | Dibuja un botón (≥ 80 px de video visible) reposicionado en cada frame; busca `<video>` también dentro de Shadow DOM abierto. |
| `background.js` | Registro de streams por pestaña (limpieza en navegación/cierre), badge, menú contextual, descargas desde el menú, orquestación de ffmpeg.wasm, historial y notificaciones. |
| `offscreen/offscreen.js` | Resuelve playlist maestra → de medios, descarga segmentos con `AbortController`, `ffmpeg -f concat -c copy -bsf:a aac_adtstoasc`, progreso 0–70 % descarga / 70–100 % remux. |
| `scripts/hls-parser.js` | Distingue maestro/medios, resuelve URLs relativas; rechaza `EXT-X-BYTERANGE` y `EXT-X-KEY` cifrado. |
| `popup/popup.js` | Lista de videos, selector de calidad, descarga directa o vía wasm, copiar URL, progreso con velocidad, reanudación del progreso al reabrir, estado "Completado" con Reproducir / Mostrar en carpeta. |
| `options/options.js` | Guarda ajustes, aplica tema e idioma, notifica a las pestañas (`SVD_SETTINGS_CHANGED`) y gestiona el historial. |

Pantallas: **popup** (vista principal), **opciones/historial**, **botón
flotante** en la página y **menú contextual**. No hay roles ni autenticación:
es una herramienta de un solo usuario local.

## 8. Persistencia de datos

No hay base de datos ni migraciones. Se usan dos claves de
`chrome.storage.local`:

**`svdSettings`** (objeto, se combina con los valores por defecto):

| Campo | Tipo | Por defecto |
|---|---|---|
| `downloadFolder` | string | `"SuperVideoDownloader"` |
| `autoName` | boolean | `true` |
| `showNotifications` | boolean | `true` |
| `theme` | `"dark"` \| `"light"` | `"dark"` |
| `language` | `"es"` \| `"en"` | `"es"` |
| `autoRefresh` | boolean | `true` |

**`svdHistory`** (array, más reciente primero, máx. 200):

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | number | `downloadId` de `chrome.downloads` |
| `date` | number | Timestamp (ms) |
| `filename` | string | Nombre final del archivo |
| `size` | number | Bytes (de `chrome.downloads` o estimado) |
| `site` | string | Dominio de origen |
| `url` | string | URL de origen (vacía si vino de un `blob:` de ffmpeg) |

Estado en memoria del service worker (no persistente): `streamsByTab`,
`menuVideosByTab`, `pendingDownloads`, `activeWasmProgress`.

## 9. Backend y API (mensajería interna)

No existe backend HTTP ni endpoints propios. La "API" es el protocolo de
mensajes entre contextos (`message.type`):

| Mensaje | Origen → destino | Función |
|---|---|---|
| `SVD_GET_VIDEOS` | popup → content | Videos del DOM con tamaño |
| `SVD_BADGE_COUNT` | content → background | Conteo + lista compacta para el menú |
| `SVD_GET_STREAMS` | popup → background | Manifiestos vistos por red en la pestaña |
| `SVD_REGISTER_DOWNLOAD` | popup → background | Asociar `downloadId` con sitio/tamaño |
| `SVD_WASM_DOWNLOAD` | popup → background → offscreen | Reconstruir un stream HLS |
| `SVD_WASM_PROGRESS` | offscreen → background/popup | Porcentaje y bytes descargados |
| `SVD_WASM_CANCEL` | popup → offscreen | Abortar la descarga |
| `SVD_WASM_DONE` | background → popup (broadcast) | Fin de la reconstrucción |
| `SVD_GET_ACTIVE_DOWNLOADS` | popup → background | Reanudar progreso al reabrir |
| `SVD_OPEN_POPUP` / `SVD_CONSUME_AUTO_EXPAND` | overlay/popup → background | Abrir popup y desplegar calidades |
| `SVD_SETTINGS_CHANGED` | options → content | Aplicar "actualización automática" |

Validaciones relevantes: todos los listeners ignoran mensajes sin `type`
string; las URLs descargables deben ser `http(s)`/`data:`; nombres de archivo
saneados (`sanitizeFilename`); la subcarpeta se limpia de barras iniciales y
finales.

Peticiones de red que realiza la extensión (siempre hacia el sitio que el
usuario visita): `HEAD` para tamaños, `fetch` del manifiesto y de los
segmentos HLS.

## 10. Configuración e instalación

**Requisitos:** Chrome/Chromium ≥ 109 (o Edge, Brave, Opera). No hay
dependencias que instalar para ejecutar la extensión.

### Paquete descargable

`presentacion web/extension/super-video-downloader-v1.0.0.zip` contiene la
carpeta `super-video-downloader/` lista para cargar.

### Carga manual (modo desarrollador)

1. Descarga o clona el repositorio (o descomprime el paquete).
2. Abre `chrome://extensions` (`edge://extensions`).
3. Activa **Modo desarrollador**.
4. **Cargar descomprimida** → elige la carpeta que contiene `manifest.json`.

## 11. Variables de entorno

La extensión **no usa variables de entorno** ni credenciales. Los scripts de
desarrollo solo leen variables del sistema para localizar el navegador o el
perfil temporal (`ProgramFiles`, `LOCALAPPDATA`, `TEMP` en
`tools/2-test-extension.ps1`).

## 12. Ejecución en desarrollo

```bash
./tools/1-install.sh          # Abre chrome://extensions en tu Chrome habitual
./tools/2-test-extension.sh   # Chrome con perfil aislado y la extensión cargada
```

```powershell
powershell -File tools\2-test-extension.ps1
powershell -File tools\2-test-extension.ps1 https://sitio/video.mp4
```

`2-test-extension` requiere **Python 3** (sin paquetes externos): usa
`tools/_cdp_loader.py` para activar el Modo desarrollador y cargar la
extensión mediante `Extensions.loadUnpacked` del DevTools Protocol. Por
defecto abre un MP4 público de prueba.

Para iterar: edita el código y pulsa **Recargar** en `chrome://extensions`.

## 13. Compilación y despliegue

```bash
./tools/3-build.sh                    # Linux/macOS (requiere zip y python3)
```
```powershell
powershell -File tools\3-build.ps1    # Windows
```

Ambos validan `manifest.json` (JSON y `description` ≤ 132 caracteres),
comprueban los archivos requeridos, ejecutan `node --check` si Node está
disponible y generan `dist/super-video-downloader-v<versión>.zip`. La versión
de Bash además rechaza el build si `manifest.json`, `store-assets/`,
`README.md` o `docs/` mencionan marcas de plataformas de terceros.

Despliegue:

- **Chrome Web Store**: guía paso a paso en [PUBLISHING.md](PUBLISHING.md);
  textos de la ficha en `store-assets/LISTING.md`.
- **Política de privacidad**: `docs/privacy.html`, pensada para GitHub Pages
  (rama `main`, carpeta `/docs`).

> ⚠️ Ver [Limitaciones](#15-limitaciones-identificadas): la lista de
> archivos de los scripts de build no incluye `overlay.js`.

## 14. Seguridad y permisos

| Permiso | Uso en el código |
|---|---|
| `storage` | Ajustes e historial (`chrome.storage.local`). |
| `downloads` | Iniciar descargas y detectar su finalización. |
| `downloads.open` | Botón "Reproducir" tras completar. |
| `notifications` | Aviso al completar (configurable) y errores del menú contextual. |
| `webRequest` | Observar URLs `.m3u8`/`.mpd`; no bloquea ni modifica tráfico. |
| `webNavigation` | Limpiar los streams de una pestaña al navegar. |
| `declarativeNetRequest` | Fijar `Referer`/`Origin`/`User-Agent` solo durante la reconstrucción HLS. |
| `offscreen` | Ejecutar ffmpeg.wasm (Worker + WebAssembly). |
| `contextMenus` | Menú "Super Video Downloader" con los videos detectados. |
| `host_permissions: <all_urls>` | Inyectar el detector en cualquier sitio. |

Consideraciones:

- CSP de páginas de extensión: `script-src 'self' 'wasm-unsafe-eval'`; sin
  `eval`, sin scripts remotos. ffmpeg.wasm se carga desde el paquete.
- Sin analítica, telemetría ni servidores propios; los datos quedan en
  `chrome.storage.local`.
- El botón flotante usa Shadow DOM **cerrado** para aislarse del sitio.
- DRM: no se intenta descifrar `blob:`/MediaSource ni HLS con `EXT-X-KEY`.
- `<all_urls>` es un permiso amplio que la tienda revisa con más detalle.

## 15. Limitaciones identificadas

- **`overlay.js` no está en la lista de `tools/3-build.sh` ni `3-build.ps1`**,
  aunque `manifest.json` lo declara como content script. Un `.zip` generado
  con esos scripts no cargaría en Chrome. El paquete de
  `presentacion web/extension/` sí lo incluye y fue verificado cargándolo en
  Chrome 155.
- **DASH no soportado**: se detecta (`.mpd`) pero el popup muestra
  "DASH todavía no está soportado".
- **HLS** sin `EXT-X-BYTERANGE` ni cifrado; los streams muy largos pueden
  agotar la memoria disponible para WebAssembly.
- Si la URL capturada es un manifiesto maestro, `offscreen.js` elige la
  variante de **menor** ancho de banda.
- El tamaño solo aparece si el servidor responde `Content-Length` al `HEAD`.
- Las calidades alternativas solo se detectan si el sitio las expone en el DOM
  o por red.
- i18n parcial: algunos textos (por ejemplo "Download", "Refresh") están en
  inglés también en el diccionario español, y varios mensajes de estado están
  escritos directamente en español.
- Sin tests automatizados ni CI.
- El enlace de ayuda del popup apunta a `github.com/alvarosiles/...`, distinto
  del remoto `origin` actual.
- Publicación en la Chrome Web Store: pendiente según la documentación.

## 16. Preguntas frecuentes

**¿Puede descargar videos de plataformas con DRM?**
No. Se detectan, pero se marcan como "No disponible para descarga directa".

**¿Por qué no puedo elegir cualquier carpeta del sistema?**
Las extensiones solo pueden escribir dentro de la carpeta de Descargas. Puedes
definir una subcarpeta en Opciones o desactivar "Nombre automático" para que
el navegador pregunte dónde guardar.

**¿La extensión envía mis datos a algún servidor?**
No. Toda la detección, reconstrucción y descarga ocurre localmente.

**¿Funciona en Edge/Brave/Opera?**
Están basados en Chromium y soportan Manifest V3; las pruebas documentadas en
este repositorio se hicieron en Chrome.

---

Licencia MIT — ver [LICENSE](LICENSE).
