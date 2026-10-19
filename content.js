/**
 * content.js — Super Video Downloader
 * ─────────────────────────────────────────────────────────────────────────
 * Orquesta la detección en la pestaña actual: usa scripts/detector.js para
 * escanear el DOM, responde a los mensajes del popup, y mantiene el badge
 * del icono de la extensión con el número de videos encontrados.
 *
 * El escaneo "barato" (solo contar elementos, sin pedir tamaños por red)
 * corre una vez al cargar la página y, si el usuario activó "actualización
 * automática" en Opciones, cada vez que el DOM cambia. El escaneo "caro"
 * (con tamaño en bytes vía HEAD) solo ocurre cuando el popup lo pide
 * explícitamente — nunca de forma proactiva.
 */

(() => {
  'use strict';

  if (window.__svdInjected) return;
  window.__svdInjected = true;

  const { scan, enrichWithSize, observe } = window.SVDDetector;

  let observer = null;

  function getDomain() {
    try {
      return location.hostname.replace(/^www\./i, '');
    } catch (_err) {
      return '';
    }
  }

  /**
   * Miniatura de respaldo para cuando ningún <video> tiene `poster` — muy
   * común en sitios que muestran la vista previa con una imagen aparte
   * (CSS/otro <img>) en vez del atributo poster nativo. `og:image` es el
   * metadato más consistente entre sitios para "la imagen de este video".
   */
  function pageThumbnail() {
    return (
      document.querySelector('meta[property="og:image"]')?.content ||
      document.querySelector('link[rel="image_src"]')?.href ||
      null
    );
  }

  /** Lista compacta (sin tamaños, sin red) para que background.js arme el menú contextual. */
  function compactVideoList(items) {
    return items.map((item) => {
      const variant = item.variants[item.selectedIndex] || item.variants[0];
      return { url: variant.url, filename: item.filename, downloadable: variant.downloadable };
    });
  }

  function reportBadge() {
    const items = scan();
    chrome.runtime.sendMessage(
      { type: 'SVD_BADGE_COUNT', count: items.length, videos: compactVideoList(items) },
      () => {
        void chrome.runtime.lastError;
      }
    );
  }

  async function setupAutoRefresh() {
    const settings = await window.SVDStorage.getSettings();
    if (settings.autoRefresh && !observer) {
      observer = observe(reportBadge);
    } else if (!settings.autoRefresh && observer) {
      observer.disconnect();
      observer = null;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return false;

    if (message.type === 'SVD_GET_VIDEOS') {
      (async () => {
        const videos = await enrichWithSize(scan());
        sendResponse({ ok: true, domain: getDomain(), videos, pageThumbnail: pageThumbnail() });
      })();
      return true; // respuesta asíncrona
    }

    if (message.type === 'SVD_SETTINGS_CHANGED') {
      setupAutoRefresh();
      return false;
    }

    return false;
  });

  function init() {
    reportBadge();
    setupAutoRefresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
