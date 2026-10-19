# Ficha de la Chrome Web Store — Super Video Downloader

Contenido listo para copiar/pegar en el Developer Dashboard
(chrome.google.com/webstore/devconsole).

---

## Descripción de un solo propósito (máx. 1000 caracteres)

```
Super Video Downloader detecta los videos disponibles en la página web que
estás visitando y te permite descargarlos con un clic. Funciona con videos
de enlace directo (<video>/<source> con URL http(s) o data:) y también con
streams HLS (.m3u8) sin cifrar, que reconstruye en un único archivo .mp4
usando ffmpeg.wasm dentro del propio navegador — sin instalar nada aparte
ni depender de servidores externos. No elude DRM ni protecciones de
streaming: los videos con blob:/MediaSource cifrado de plataformas con
protección DRM se detectan pero se marcan como no descargables a
propósito. Incluye selector de calidad, barra de progreso con velocidad,
historial de descargas, y opciones de subcarpeta/nombre automático/tema.
```
(actualizar el conteo de caracteres al pegar en el Dashboard)

---

## Descripción larga

```
Super Video Downloader escanea la pestaña activa en busca de videos
descargables y te deja guardarlos con un clic, directamente desde el
popup de la extensión.

CÓMO DETECTA VIDEOS
• Elementos <video>/<source> con URL directa http(s)/data:, incluidos los
  que aparecen después de cargar la página (sitios de una sola página).
• Streams HLS (.m3u8) — observando la red, porque el <video> de un
  reproductor con hls.js nunca expone esa URL en el DOM. Se reconstruyen
  en un .mp4 con ffmpeg.wasm, corriendo dentro del propio navegador.
• Si el sitio ofrece varias calidades, se listan todas en un selector —
  no solo la que está reproduciéndose. Si hay varios videos distintos en
  la misma página, cada uno aparece en su propia tarjeta.

DESCARGA CON CONTROL
• Barra de progreso con porcentaje y velocidad, y botón para cancelar en
  cualquier momento.
• Al terminar, botones para reproducir el archivo o abrir su carpeta.
• Copiar la URL directa con un clic.

RESPETA LAS PROTECCIONES DE STREAMING
Esta extensión NO elude DRM, cifrado ni protecciones de streaming.
Los videos con blob:/MediaSource cifrado — típicos de plataformas de
streaming con protección DRM — se muestran en la lista para que sepas
que existen, pero se marcan como "no disponible para descarga directa"
a propósito: ni esta extensión ni ffmpeg pueden (ni lo intentan)
descifrarlos.

PERSONALIZACIÓN
• Subcarpeta de descarga dentro de tu carpeta de Descargas.
• Nombre automático o diálogo "Guardar como" en cada descarga.
• Notificaciones al completar una descarga.
• Tema oscuro o claro, español o inglés.
• Historial de descargas con borrado individual o total.

PRIVACIDAD
Todo el procesamiento — detección, reconstrucción de streams, descarga —
ocurre localmente en tu navegador. No hay analítica, telemetría, ni se
envía ningún dato a servidores externos.

Código abierto bajo licencia MIT:
github.com/alvarosiles/super-video-downloader
```

---

## Categoría e idioma

- **Categoría:** Herramientas (Productivity / Tools)
- **Idioma:** Español (con soporte adicional para inglés en la propia extensión)

---

## Permisos — justificación para la pestaña de Privacidad

| Permiso | Justificación (texto sugerido para el campo del Dashboard) |
|---|---|
| `storage` | "Se usa chrome.storage.local para guardar la configuración del usuario (tema, idioma, subcarpeta de descarga) y el historial de descargas. Todo permanece en el dispositivo del usuario." |
| `downloads` | "Necesario para iniciar las descargas de video (chrome.downloads.download) y detectar cuándo terminan, para registrar el historial y mostrar la notificación de finalización." |
| `downloads.open` | "Permite el botón 'Reproducir' que aparece tras completar una descarga, para abrir el archivo con el reproductor por defecto del sistema (chrome.downloads.open)." |
| `notifications` | "Muestra una notificación del sistema cuando una descarga se completa, si el usuario activó esa opción en Configuración." |
| `webRequest` | "Se usa exclusivamente para observar (nunca modificar ni bloquear) peticiones de red y detectar manifiestos de streaming HLS (.m3u8). Es la única forma de encontrar esa URL cuando el sitio reproduce el video vía MediaSource (blob:), ya que el elemento <video> del DOM no la expone." |
| `webNavigation` | "Limpia la lista de streams detectados de una pestaña cuando el usuario navega a otra página, para no mostrar resultados obsoletos." |
| `declarativeNetRequest` | "Fija temporalmente la cabecera Referer/Origin en la petición de un manifiesto HLS — muchos servidores de video la exigen y fetch() no puede establecerla por sí solo. La regla se agrega justo antes de la descarga del stream y se quita apenas termina." |
| `offscreen` | "Necesario para ejecutar ffmpeg.wasm (requiere un contexto con Worker y WebAssembly) al reconstruir un stream HLS en un archivo .mp4 descargable." |
| `host_permissions: <all_urls>` | "La extensión no tiene una lista fija de sitios soportados: el propósito único es detectar videos en la página que el usuario ya está visitando, sea cual sea. Se necesita para inyectar el content script de detección y observar las peticiones de red relevantes en cualquier sitio." |

---

## ¿Usás código remoto?

**Respuesta: No.**

Verificado por grep en todo el código fuente: no hay `eval()`, no hay
`new Function()`, no hay `<script src="http...">`, y `ffmpeg.wasm` está
empaquetado localmente en `vendor/ffmpeg/` (cargado con
`chrome.runtime.getURL()`, nunca desde un CDN). Todo el JavaScript que
ejecuta la extensión está incluido en el paquete subido a la Web Store.

---

## Casillas de "Uso de datos" (Privacy practices)

Marcar que la extensión **NO recolecta** ninguna de las categorías que
suele listar el formulario (datos personales, salud, financieros,
autenticación, comunicaciones, ubicación, historial web, actividad del
usuario, información de sitios web visitados con fines de perfilado,
etc.).

Justificación: toda la detección/descarga ocurre en el navegador del
usuario; no hay servidor propio, no hay analítica ni SDKs de terceros, y
nada de lo procesado (URLs de video, metadatos, historial de descargas)
sale del dispositivo del usuario ni se transmite a la desarrolladora.

Declaración de certificación a marcar: "No recopilo datos de usuario" /
cumplimiento de la Política de Datos de Usuario de la Chrome Web Store.
