/**
 * scripts/downloader.js — Super Video Downloader
 * ─────────────────────────────────────────────────────────────────────────
 * Envuelve chrome.downloads.download() aplicando la configuración del
 * usuario (subcarpeta, nombre automático vs. diálogo "Guardar como"). Se
 * usa desde popup.js, que es un contexto con privilegios de extensión y
 * por tanto acceso directo a chrome.downloads — a diferencia de activar
 * Picture-in-Picture, iniciar una descarga NO requiere un gesto de usuario
 * "fresco" propagado con chrome.scripting.executeScript, así que aquí no
 * hace falta ese cuidado especial.
 *
 * Después de arrancar la descarga, avisa a background.js (que vive todo el
 * tiempo que el navegador esté abierto) con el downloadId y el sitio de
 * origen, para que pueda registrar el historial y disparar la notificación
 * cuando la descarga termine — aunque el popup ya se haya cerrado para
 * entonces.
 */

(function (root) {
  'use strict';

  function buildFilename(video, settings) {
    const folder = (settings.downloadFolder || '').replace(/^\/+|\/+$/g, '');
    return folder ? `${folder}/${video.filename}` : video.filename;
  }

  /**
   * Inicia la descarga de `video` (tal como lo devuelve scripts/detector.js)
   * respetando `settings` (scripts/storage.js). Devuelve el downloadId.
   */
  async function startDownload(video, settings, siteDomain) {
    const filename = buildFilename(video, settings);

    const downloadId = await new Promise((resolve, reject) => {
      chrome.downloads.download(
        {
          url: video.url,
          filename,
          saveAs: !settings.autoName,
        },
        (id) => {
          if (chrome.runtime.lastError || id === undefined) {
            reject(new Error(chrome.runtime.lastError?.message || 'No se pudo iniciar la descarga'));
            return;
          }
          resolve(id);
        }
      );
    });

    chrome.runtime.sendMessage(
      {
        type: 'SVD_REGISTER_DOWNLOAD',
        downloadId,
        site: siteDomain || '',
        sizeHint: video.sizeBytes || 0,
      },
      () => void chrome.runtime.lastError
    );

    return downloadId;
  }

  root.SVDDownloader = { startDownload };
})(window);
