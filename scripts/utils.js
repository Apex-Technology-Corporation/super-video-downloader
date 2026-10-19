/**
 * scripts/utils.js — Super Video Downloader
 * ─────────────────────────────────────────────────────────────────────────
 * Funciones puras compartidas por TODOS los contextos de la extensión
 * (content script, popup, options, background). Se carga como script
 * clásico (sin módulos ES) en cada uno de ellos:
 *
 *   - content_scripts (manifest.json): <script src="scripts/utils.js">
 *   - popup/popup.html y options/options.html: <script src="../scripts/utils.js">
 *   - background.js (service worker): importScripts('scripts/utils.js')
 *
 * Así evitamos duplicar lógica sin necesitar un bundler ni módulos ES en
 * los content scripts (que en Manifest V3 no los soportan de forma nativa
 * para archivos declarados en "js"). Todo queda expuesto bajo el único
 * namespace global `SVDUtils` para no ensuciar `window`/`self`.
 */

(function (root) {
  'use strict';

  const MIME_BY_EXT = {
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    ogg: 'video/ogg',
    ogv: 'video/ogg',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    '3gp': 'video/3gpp',
  };

  const EXT_BY_MIME = Object.entries(MIME_BY_EXT).reduce((acc, [ext, mime]) => {
    if (!acc[mime]) acc[mime] = ext;
    return acc;
  }, {});

  /** "1234567" -> "1.18 MB". Devuelve `null` si no hay dato (el llamador decide el texto). */
  function formatBytes(bytes) {
    if (!bytes || bytes <= 0 || !isFinite(bytes)) return null;
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    const decimals = unitIndex === 0 ? 0 : 1;
    return `${value.toFixed(decimals)} ${units[unitIndex]}`;
  }

  /** 125 -> "02:05". 3725 -> "1:02:05". */
  function formatDuration(seconds) {
    if (!seconds || !isFinite(seconds) || seconds <= 0) return null;
    const total = Math.round(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function extFromUrl(url) {
    try {
      const pathname = new URL(url, location.href).pathname;
      const match = pathname.match(/\.([a-zA-Z0-9]{2,4})$/);
      return match ? match[1].toLowerCase() : '';
    } catch (_err) {
      return '';
    }
  }

  function guessMimeFromUrl(url) {
    const ext = extFromUrl(url);
    return MIME_BY_EXT[ext] || '';
  }

  function extFromMime(mime) {
    if (!mime) return '';
    return EXT_BY_MIME[mime.split(';')[0].trim()] || '';
  }

  function sanitizeFilename(name) {
    return String(name)
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 150);
  }

  /**
   * Deriva un nombre de archivo para el video. Prioriza el título de la
   * página/video (`fallbackBase`) sobre el nombre que trae la URL — la
   * mayoría de streams usan nombres de archivo genéricos en el CDN
   * ("hls.m3u8", "index-720p", un hash) que no le dicen nada al usuario,
   * mientras que el título sí identifica el video real.
   */
  function filenameFromUrl(url, fallbackBase, mime) {
    const ext = extFromUrl(url) || extFromMime(mime) || 'mp4';

    if (fallbackBase && fallbackBase.trim()) {
      return `${sanitizeFilename(fallbackBase)}.${ext}`;
    }

    let base = '';
    try {
      const pathname = new URL(url, location.href).pathname;
      base = decodeURIComponent(pathname.split('/').pop() || '');
    } catch (_err) {
      base = '';
    }
    base = base.replace(/\.[a-zA-Z0-9]{2,4}$/, '');
    base = sanitizeFilename(base || 'video');

    return `${base}.${ext}`;
  }

  // ── i18n ────────────────────────────────────────────────────────────────
  // Diccionario mínimo (es/en) para los textos de popup y options. Los
  // elementos marcan su clave de traducción con data-i18n="clave" (para
  // textContent) o data-i18n-placeholder="clave" (para el placeholder).
  const STRINGS = {
    es: {
      appName: 'Super Video Downloader',
      currentSite: 'Sitio actual',
      emptyState: 'No se detectaron videos descargables en este sitio.',
      noVideoQuestion: '¿No hay video?',
      refresh: 'Refresh',
      settings: 'Settings',
      download: 'Download',
      copyUrl: 'Copy URL',
      copied: 'URL copiada',
      cancel: 'Detener',
      downloadComplete: 'Completado',
      play: 'Reproducir',
      unknown: 'Desconocido',
      notDownloadable: 'No disponible para descarga directa',
      notDownloadableTooltip:
        'Este video usa streaming protegido (blob:/MediaSource): el sitio no ofrece un archivo descargable directo, así que Super Video Downloader no puede (ni intenta) descargarlo.',
      protectedNotice:
        'Este sitio usa streaming protegido para algunos videos: se detectan, pero no se pueden descargar directamente.',
      optionsTitle: 'Configuración',
      sectionDownloads: 'Descargas',
      downloadFolder: 'Subcarpeta de descarga (dentro de Descargas)',
      downloadFolderHint:
        'Chrome no permite elegir una carpeta absoluta del sistema desde una extensión; los archivos se guardan dentro de tu carpeta de Descargas, en esta subcarpeta.',
      autoName: 'Nombre automático',
      autoNameHint: 'Si lo desactivas, el navegador te preguntará dónde guardar cada archivo.',
      showNotifications: 'Mostrar notificaciones',
      theme: 'Tema',
      themeDark: 'Oscuro',
      themeLight: 'Claro',
      language: 'Idioma',
      autoRefresh: 'Actualización automática de la lista',
      autoRefreshHint: 'Vuelve a detectar videos cuando la página cambia (sitios de una sola página).',
      sectionHistory: 'Historial',
      clearHistory: 'Borrar historial',
      historyEmpty: 'Todavía no hay descargas registradas.',
      save: 'Guardar',
      saved: 'Guardado',
    },
    en: {
      appName: 'Super Video Downloader',
      currentSite: 'Current site',
      emptyState: 'No downloadable videos were detected on this site.',
      noVideoQuestion: "No video?",
      refresh: 'Refresh',
      settings: 'Settings',
      download: 'Download',
      copyUrl: 'Copy URL',
      copied: 'URL copied',
      cancel: 'Stop',
      downloadComplete: 'Complete',
      play: 'Play',
      unknown: 'Unknown',
      notDownloadable: 'Not directly downloadable',
      notDownloadableTooltip:
        "This video uses protected streaming (blob:/MediaSource): the site doesn't offer a direct downloadable file, so Super Video Downloader can't (and won't try to) download it.",
      protectedNotice:
        'This site uses protected streaming for some videos: they are detected, but cannot be downloaded directly.',
      optionsTitle: 'Settings',
      sectionDownloads: 'Downloads',
      downloadFolder: 'Download subfolder (inside Downloads)',
      downloadFolderHint:
        "Chrome doesn't allow extensions to pick an absolute system folder; files are saved inside your Downloads folder, under this subfolder.",
      autoName: 'Automatic filename',
      autoNameHint: 'If disabled, the browser will ask where to save each file.',
      showNotifications: 'Show notifications',
      theme: 'Theme',
      themeDark: 'Dark',
      themeLight: 'Light',
      language: 'Language',
      autoRefresh: 'Auto-refresh the list',
      autoRefreshHint: 'Re-scan for videos when the page changes (single-page sites).',
      sectionHistory: 'History',
      clearHistory: 'Clear history',
      historyEmpty: 'No downloads recorded yet.',
      save: 'Save',
      saved: 'Saved',
    },
  };

  function t(lang, key, vars) {
    const dict = STRINGS[lang] || STRINGS.es;
    let str = dict[key] ?? STRINGS.es[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(`{${k}}`, v);
      }
    }
    return str;
  }

  /** Aplica las traducciones a todo el árbol `root` según data-i18n[-placeholder]. */
  function applyTranslations(root, lang) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(lang, el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.setAttribute('placeholder', t(lang, el.getAttribute('data-i18n-placeholder')));
    });
  }

  root.SVDUtils = {
    formatBytes,
    formatDuration,
    guessMimeFromUrl,
    extFromMime,
    extFromUrl,
    sanitizeFilename,
    filenameFromUrl,
    t,
    applyTranslations,
  };
})(typeof window !== 'undefined' ? window : self);
