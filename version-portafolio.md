# Super Video Downloader

## Descripción breve (tarjeta)

Extensión Manifest V3 para Chrome que detecta los videos de la página actual,
incluidos streams HLS ocultos tras el reproductor, y los guarda con un clic.
Reconstruye HLS en MP4 con ffmpeg.wasm, localmente y sin servidores.

**Etiquetas:** JavaScript · Chrome Extensions MV3 · WebAssembly · ffmpeg.wasm · HLS · Service Workers

---

## Descripción completa

Super Video Downloader es una extensión para Chrome y navegadores basados en
Chromium que analiza la pestaña activa en dos niveles. En el DOM busca
elementos `<video>`, `<source>` y enlaces a archivos de video. En la red
observa las peticiones de la pestaña para capturar manifiestos `.m3u8`/`.mpd`,
que nunca aparecen en el DOM cuando el reproductor usa MediaSource.

El popup presenta cada video con miniatura, duración, selector de calidad y
tamaño. La descarga directa usa la API `chrome.downloads`. En los streams HLS
sin cifrar, un documento *offscreen* ejecuta ffmpeg.wasm: descarga los
segmentos, los une sin recodificar y entrega un único `.mp4`, con progreso,
velocidad y cancelación. La extensión incluye un botón flotante sobre cada
video, un menú contextual, el contador en el icono, una página de opciones y
un historial de descargas.

Todo ocurre en el navegador del usuario: no hay backend, analítica ni código
remoto, y el contenido protegido con DRM se detecta pero se bloquea a
propósito.

## Problema que resuelve

Muchos sitios sirven videos que técnicamente se pueden descargar, pero
esconden la URL real detrás de reproductores JavaScript o los fragmentan en
streams HLS. Obtener el archivo exigía abrir DevTools, encontrar el manifiesto
y unir los segmentos con herramientas de línea de comandos. La extensión
reduce ese proceso a elegir la calidad y pulsar "Download".

## Objetivo del proyecto

Construir una herramienta de descarga de video que:

- funcione sin instalar nada fuera del navegador;
- cumpla las políticas de la Chrome Web Store (sin código remoto y sin eludir
  DRM);
- procese todo localmente, sin enviar datos a terceros.

## Público objetivo

Usuarios de navegadores Chromium que necesitan guardar videos de libre
descarga (material educativo, recursos públicos, contenido propio) desde
sitios que no ofrecen un botón de descarga.

## Mi participación técnica

- **Confirmado por el repositorio:** todos los commits (20, entre julio y
  octubre de 2026) están firmados por Alvaro Siles Estrada / `alvarosiles`, y
  `manifest.json` declara `"author": "alvarosiles"`. El historial no registra
  otros colaboradores.
- **Pendiente de confirmar:** el reparto concreto de tareas (diseño de
  arquitectura, UI, integración de ffmpeg.wasm, scripts de automatización) y
  el uso de herramientas de asistencia. El repositorio no permite deducirlo.

## Funcionalidades destacadas

1. **Detección híbrida DOM + red**: combina el escaneo de `<video>`/`<source>`
   con la observación de manifiestos HLS/DASH mediante `chrome.webRequest`.
2. **HLS → MP4 en el navegador**: ffmpeg.wasm en un offscreen document,
   `concat` + `-c copy`, progreso en dos fases (descarga 0–70 %, remux
   70–100 %) y cancelación con `AbortController`.
3. **Selector de calidad inteligente**: agrupa las variantes del mismo video
   por reproductor o por carpeta del CDN, y muestra en tarjetas separadas los
   videos distintos de una misma página.
4. **Descarga persistente**: el progreso sigue en el badge del icono si el
   popup se cierra, y se recupera al reabrirlo.
5. **Botón flotante** sobre cada video, aislado con Shadow DOM cerrado, que
   abre el popup con el selector de calidad ya desplegado.
6. **Menú contextual** con los videos detectados, útil cuando el sitio tapa el
   `<video>` con capas.
7. **Opciones e historial**: subcarpeta, nombre automático, notificaciones,
   tema claro/oscuro, idioma es/en, y registro de las últimas 200 descargas.
8. **Filtro de anuncios**: descarta clips de menos de 25 s si hay un video
   principal más largo.

## Tecnologías utilizadas

| Categoría | Tecnologías |
|---|---|
| Lenguajes | JavaScript (ES2020+), HTML5, CSS3, Python 3, Bash, PowerShell |
| Plataforma | Chrome Extensions Manifest V3 (Chrome ≥ 109) |
| APIs del navegador | `downloads`, `storage`, `webRequest`, `webNavigation`, `declarativeNetRequest`, `offscreen`, `contextMenus`, `notifications`, `action` |
| Procesamiento multimedia | ffmpeg.wasm (`@ffmpeg/core` 0.12.9), WebAssembly, parser HLS propio (RFC 8216) |
| Persistencia | `chrome.storage.local` |
| Herramientas | Chrome DevTools Protocol (cliente WebSocket propio en Python), Node.js (`node --check`), Pillow (iconos) |
| Distribución | Chrome Web Store (preparada), GitHub Pages para la política de privacidad |

## Arquitectura y características técnicas

- **Cinco contextos aislados** (content script, overlay, service worker,
  offscreen document y páginas de extensión) coordinados por un protocolo de
  mensajes propio (`SVD_*`).
- **Sin bundler ni framework**: los módulos compartidos se cargan como
  scripts clásicos en todos los contextos, incluido el service worker con
  `importScripts`, para reutilizar la misma lógica.
- **Gestión de memoria de WebAssembly**: se crea una instancia de ffmpeg por
  descarga y se destruye con `terminate()`, los segmentos se escriben
  directamente al sistema de archivos virtual y el offscreen document se
  cierra cuando no quedan descargas activas.
- **Cabeceras controladas**: `fetch()` no permite fijar `Referer`/`Origin`,
  así que se aplica una regla dinámica de `declarativeNetRequest` solo
  durante la descarga y se elimina en un bloque `finally`.
- **Escaneo en dos niveles**: el conteo del badge no hace peticiones de red;
  el tamaño (peticiones `HEAD`) solo se consulta al abrir el popup.
- **Automatización de pruebas manuales**: los scripts lanzan Chrome con un
  perfil aislado, activan el Modo desarrollador y cargan la extensión por CDP
  (`Extensions.loadUnpacked`).

## Integraciones importantes

- **ffmpeg.wasm**, empaquetado localmente en `vendor/ffmpeg/` (sin CDN).
- **Chrome Downloads API**: guardado, apertura y "mostrar en carpeta".
- **Chrome DevTools Protocol**, en las herramientas de desarrollo.
- **Chrome Web Store**: ficha, justificación de permisos, capturas y política
  de privacidad preparadas en `store-assets/`, `docs/` y `PUBLISHING.md`.

## Seguridad

- No elude DRM: las fuentes `blob:`/MediaSource se marcan como no
  descargables, y los HLS con `#EXT-X-KEY` cifrado se rechazan.
- Sin código remoto: CSP `script-src 'self' 'wasm-unsafe-eval'` y sin `eval`.
- Sin recolección de datos: ajustes e historial solo en
  `chrome.storage.local`.
- `webRequest` en modo de solo lectura; las cabeceras se modifican de forma
  temporal y limitada al dominio del stream.
- La UI inyectada usa Shadow DOM cerrado para no interferir con el sitio.

## Retos técnicos

- Detectar videos cuyo `<video>` solo expone un `blob:`, lo que obliga a
  observar la red en lugar del DOM.
- Ejecutar ffmpeg.wasm en MV3, donde el service worker no admite este caso;
  se resolvió con un offscreen document y una espera activa hasta que el
  documento registra su listener.
- Contener el consumo de memoria con streams grandes.
- CDNs que exigen `Referer`/`Origin`, cabeceras que `fetch()` no puede
  establecer.
- Mantener el progreso visible cuando el popup se cierra durante la
  descarga.
- Ajustar textos y build a las políticas de la tienda: validación de la
  longitud de la descripción y de menciones a marcas de terceros.

## Mejoras futuras recomendadas

1. Incluir `overlay.js` en la lista de archivos de `tools/3-build.*`; hoy el
   `.zip` generado por esos scripts no cargaría.
2. Añadir soporte para DASH (`.mpd`), que hoy se detecta pero no se descarga.
3. Permitir elegir la variante en manifiestos maestros, en lugar de usar
   siempre la de menor ancho de banda.
4. Completar la internacionalización (textos fijos en popup y background).
5. Añadir tests automatizados del parser HLS y del detector, y CI con
   validación del manifest.
6. Unificar la URL del repositorio usada en el botón de ayuda.

## Estado del proyecto

- **Versión 1.0.0** funcional. En esta revisión se probó en Chrome 155: se
  cargó la extensión, se detectó un video con dos calidades, se completó una
  descarga y se registró en el historial.
- La descarga HLS está implementada en el código, pero no se ejercitó en las
  capturas de esta revisión (no había un stream HLS local disponible).
- **Publicación en la Chrome Web Store: pendiente** según la documentación del
  repositorio; los materiales de la ficha están preparados.
- Hay un paquete descargable en
  `presentacion web/extension/super-video-downloader-v1.0.0.zip`.

## Capturas

Capturas tomadas de la extensión real, cargada en Chrome 155 con un perfil
aislado, sobre una página de prueba local (`127.0.0.1`) con un video
sintético de demostración. No contienen datos personales.

| Archivo | Contenido |
|---|---|
| `presentacion/01-vista-principal.png` | Página de prueba con el botón flotante sobre el video y el popup abierto: sitio actual, contador, miniatura, duración 00:32, calidad 1280×720 y tamaño 5.8 MB. |
| `presentacion/02-funcionalidad-principal.png` | El mismo popup después de pulsar "Download": la descarga real se completó y se muestran "Completado", "Reproducir" y "Mostrar en carpeta". |
| `presentacion/03-funcionalidad-complementaria.png` | Página de opciones (subcarpeta, nombre automático, notificaciones, actualización automática, tema, idioma) y el historial con la descarga anterior. |

> Las capturas 01 y 02 combinan dos capturas reales de la misma sesión: la
> página y el popup, obtenidos por separado con el DevTools Protocol porque
> el popup se renderiza en su propia ventana. El popup se colocó en su
> posición habitual, bajo la barra de herramientas, y a la misma escala.
