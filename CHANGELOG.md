# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [1.0.0] — 2026-07-16

### Agregado

- Detección automática de `<video>`/`<source>` con URL directa (http/https/data)
  en la pestaña activa, incluidos sitios que los montan dinámicamente.
- Popup con lista de videos detectados: nombre, formato, resolución,
  duración y tamaño (bytes, obtenido bajo demanda con `HEAD`).
- Descarga con un clic vía `chrome.downloads`, y botón "Copiar URL".
- Página de opciones: subcarpeta de descarga, nombre automático,
  notificaciones, tema claro/oscuro, idioma (es/en), actualización
  automática de la lista.
- Historial de descargas (fecha, archivo, tamaño, sitio) con borrado
  individual o total.
- Badge del icono con el número de videos detectados por pestaña.
- Fuentes blob:/mediasource: (streaming adaptativo tipo MSE) se listan
  mostrando que existen pero se marcan explícitamente como no descargables,
  por diseño y por política de la Chrome Web Store.
