/**
 * popup.js — Super Video Downloader
 * ─────────────────────────────────────────────────────────────────────────
 * UI del popup: pide a content.js la lista de videos de la pestaña activa
 * (con tamaño en bytes incluido — ver scripts/detector.js sobre por qué
 * esa parte es "bajo demanda") y ofrece descargarlos o copiar su URL.
 */

(() => {
  'use strict';

  const { formatBytes, formatDuration, t, applyTranslations } = window.SVDUtils;

  const els = {
    root: document.documentElement,
    refreshBtn: document.getElementById('refreshBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    favicon: document.getElementById('siteFavicon'),
    domain: document.getElementById('siteDomain'),
    countBadge: document.getElementById('countBadge'),
    videoList: document.getElementById('videoList'),
    emptyState: document.getElementById('emptyState'),
    protectedNotice: document.getElementById('protectedNotice'),
    status: document.getElementById('statusMessage'),
    template: document.getElementById('videoItemTemplate'),
    rescanBtn: document.getElementById('rescanBtn'),
    historyBtn: document.getElementById('historyBtn'),
    downloadsFolderBtn: document.getElementById('downloadsFolderBtn'),
    clearHistoryBtn: document.getElementById('clearHistoryBtn'),
    helpBtn: document.getElementById('helpBtn'),
  };

  const local = { tabId: null, domain: '', settings: null };

  function showStatus(text) {
    els.status.textContent = text;
    clearTimeout(showStatus._t);
    showStatus._t = setTimeout(() => {
      els.status.textContent = '';
    }, 2000);
  }

  function sendToContentScript(message) {
    return new Promise((resolve) => {
      if (local.tabId == null) return resolve(null);
      chrome.tabs.sendMessage(local.tabId, message, (response) => {
        void chrome.runtime.lastError;
        resolve(response || null);
      });
    });
  }

  function qualityLabel(variant) {
    if (variant.width && variant.height) return `${variant.width}×${variant.height}`;
    return variant.qualityLabel || (variant.mime ? variant.mime.replace('video/', '').toUpperCase() : '');
  }

  function sizeText(variant) {
    const lang = local.settings.language;
    return variant.downloadable ? formatBytes(variant.sizeBytes) || t(lang, 'unknown') : '';
  }

  function renderVideos(videos, activeDownloads) {
    activeDownloads = activeDownloads || new Map();
    const lang = local.settings.language;
    els.videoList.innerHTML = '';
    els.countBadge.textContent = String(videos.length);
    els.emptyState.classList.toggle('hidden', videos.length > 0);
    els.protectedNotice.classList.toggle('hidden', !videos.some((v) => !v.variants.some((variant) => variant.downloadable)));

    for (const video of videos) {
      const node = els.template.content.firstElementChild.cloneNode(true);
      node.querySelector('.video-item__name').textContent = video.filename;

      const poster = node.querySelector('.video-item__poster');
      if (video.poster) {
        poster.src = video.poster;
        poster.classList.remove('hidden');
        poster.onerror = () => poster.classList.add('hidden');
      }

      const durationEl = node.querySelector('.video-item__duration');
      const duration = formatDuration(video.duration);
      if (duration) {
        durationEl.textContent = duration;
        durationEl.classList.remove('hidden');
      }

      const badge = node.querySelector('.protected-badge');
      const sizeEl = node.querySelector('.video-item__size');
      const qualitySelect = node.querySelector('.video-item__quality');
      const downloadBtn = node.querySelector('.btn--download');
      const copyBtn = node.querySelector('.icon-btn--copy');
      const progressBox = node.querySelector('.video-item__progress');
      const progressFill = node.querySelector('.video-item__progress-fill');
      const progressLabel = node.querySelector('.video-item__progress-label');
      const cancelBtn = node.querySelector('.btn--cancel');
      const doneBox = node.querySelector('.video-item__done');
      const playBtn = node.querySelector('.btn--play');
      const folderBtn = node.querySelector('.icon-btn--folder');
      downloadBtn.textContent = t(lang, 'download');
      cancelBtn.textContent = t(lang, 'cancel');

      video.variants.forEach((variant, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = qualityLabel(variant) || `#${index + 1}`;
        qualitySelect.appendChild(option);
      });
      qualitySelect.disabled = video.variants.length <= 1;

      function applyVariant(index) {
        const variant = video.variants[index];
        qualitySelect.value = String(index);
        node.classList.toggle('is-disabled', !variant.downloadable);
        sizeEl.textContent = sizeText(variant);
        badge.classList.toggle('hidden', variant.downloadable);
        badge.querySelector('.protected-badge__text').textContent = t(lang, 'notDownloadable');
        downloadBtn.disabled = !variant.downloadable;
        downloadBtn.title = variant.downloadable ? '' : t(lang, 'notDownloadableTooltip');
      }

      applyVariant(video.selectedIndex || 0);

      qualitySelect.addEventListener('change', () => {
        applyVariant(Number(qualitySelect.value));
      });

      function setDownloading(isDownloading) {
        downloadBtn.classList.toggle('hidden', isDownloading);
        copyBtn.classList.toggle('hidden', isDownloading);
        qualitySelect.disabled = isDownloading || video.variants.length <= 1;
        progressBox.classList.toggle('hidden', !isDownloading);
        if (!isDownloading) {
          progressFill.style.width = '0%';
          progressLabel.textContent = '';
        }
      }

      function setDone(downloadId) {
        downloadBtn.classList.add('hidden');
        copyBtn.classList.add('hidden');
        progressBox.classList.add('hidden');
        doneBox.classList.remove('hidden');
        playBtn.onclick = () => chrome.downloads.open(downloadId);
        folderBtn.onclick = () => chrome.downloads.show(downloadId);
      }

      const activeVariantIndex = video.variants.findIndex((v) => activeDownloads.has(v.url));
      if (activeVariantIndex !== -1) {
        const activeVariant = video.variants[activeVariantIndex];
        applyVariant(activeVariantIndex);
        setDownloading(true);
        const initialPercent = activeDownloads.get(activeVariant.url);
        if (initialPercent != null) progressFill.style.width = `${initialPercent}%`;
        progressLabel.textContent = `${initialPercent ?? 0}%`;
        cancelBtn.onclick = () => cancelWasmDownload(activeVariant.url);
        resumeWasmProgress(activeVariant, progressFill, progressLabel, setDownloading, setDone);
      }

      downloadBtn.addEventListener('click', async () => {
        const variant = video.variants[Number(qualitySelect.value)];
        try {
          if (variant.kind === 'dash') {
            throw new Error('DASH todavía no está soportado (solo HLS por ahora).');
          } else if (variant.kind === 'hls') {
            setDownloading(true);
            cancelBtn.onclick = () => cancelWasmDownload(variant.url);
            const downloadId = await downloadViaWasm(variant, progressFill, progressLabel);
            showStatus(`${t(lang, 'download')}: ${variant.filename}`);
            setDone(downloadId);
            return;
          } else {
            downloadBtn.disabled = true;
            const downloadId = await window.SVDDownloader.startDownload(variant, local.settings, local.domain);
            showStatus(`${t(lang, 'download')}: ${variant.filename}`);
            setDone(downloadId);
            return;
          }
        } catch (err) {
          showStatus(err.message || 'Error');
          downloadBtn.disabled = !variant.downloadable;
          setDownloading(false);
        }
      });

      copyBtn.addEventListener('click', async () => {
        const variant = video.variants[Number(qualitySelect.value)];
        try {
          await navigator.clipboard.writeText(variant.url);
          showStatus(t(lang, 'copied'));
        } catch (_err) {
          showStatus(variant.url);
        }
      });

      els.videoList.appendChild(node);
    }
  }

  /**
   * Cabeceras a mandarle al fetch de la playlist/segmentos. Muchos CDNs de
   * streaming comprueban Referer/Origin para rechazar peticiones que no
   * vienen "del reproductor real" — fetch() nunca puede ponerlas por sí
   * solo, así que background.js las fuerza con declarativeNetRequest justo
   * antes de pedir esto (ver withHeaderOverride en background.js).
   */
  function streamDownloadHeaders() {
    const headers = { 'User-Agent': navigator.userAgent };
    if (local.tabUrl) {
      headers.Referer = local.tabUrl;
      try {
        headers.Origin = new URL(local.tabUrl).origin;
      } catch (_err) {}
    }
    return headers;
  }

  /**
   * Descarga un stream HLS reconstruyéndolo con ffmpeg.wasm en un offscreen
   * document (ver offscreen/offscreen.js) — sin instalar nada aparte, lo
   * que hace esto compatible con publicar la extensión en la Chrome Web
   * Store sin pasos extra para el usuario. El progreso llega por broadcast
   * mientras el popup siga abierto.
   */
  function downloadViaWasm(variant, progressFill, progressLabel) {
    return new Promise((resolve, reject) => {
      let lastBytes = 0;
      let lastTime = Date.now();

      const onProgress = (message) => {
        if (!message || message.url !== variant.url || message.type !== 'SVD_WASM_PROGRESS') return;
        if (message.percent != null) progressFill.style.width = `${message.percent}%`;

        let speedText = '';
        if (message.bytesSoFar != null) {
          const now = Date.now();
          const deltaBytes = message.bytesSoFar - lastBytes;
          const deltaSeconds = (now - lastTime) / 1000;
          if (deltaSeconds > 0.2) {
            const speed = formatBytes(deltaBytes / deltaSeconds);
            if (speed) speedText = ` · ${speed}/s`;
            lastBytes = message.bytesSoFar;
            lastTime = now;
          }
        }
        progressLabel.textContent = `${message.percent ?? 0}%${speedText}`;
      };
      chrome.runtime.onMessage.addListener(onProgress);

      chrome.runtime.sendMessage(
        {
          type: 'SVD_WASM_DOWNLOAD',
          url: variant.url,
          filename: variant.filename,
          site: local.domain,
          headers: streamDownloadHeaders(),
          settings: local.settings,
        },
        (response) => {
          chrome.runtime.onMessage.removeListener(onProgress);
          if (chrome.runtime.lastError) {
            reject(new Error('No se pudo iniciar la reconstrucción del stream.'));
            return;
          }
          if (response && response.ok) {
            resolve(response.downloadId);
          } else {
            reject(new Error((response && response.error) || 'Error reconstruyendo el stream'));
          }
        }
      );
    });
  }

  /**
   * A diferencia de downloadViaWasm(), NO dispara una descarga nueva — solo
   * escucha el progreso de una que background.js ya venía corriendo desde
   * antes de que este popup existiera (ver getActiveDownloads()), hasta que
   * llegue SVD_WASM_DONE (broadcast que background.js manda cuando termina,
   * la haya iniciado el popup que sea).
   */
  function resumeWasmProgress(variant, progressFill, progressLabel, setDownloading, setDone) {
    const onMessage = (message) => {
      if (!message || message.url !== variant.url) return;

      if (message.type === 'SVD_WASM_PROGRESS') {
        if (message.percent != null) {
          progressFill.style.width = `${message.percent}%`;
          progressLabel.textContent = `${message.percent}%`;
        }
        return;
      }

      if (message.type === 'SVD_WASM_DONE') {
        chrome.runtime.onMessage.removeListener(onMessage);
        if (message.ok) {
          setDone(message.downloadId);
        } else {
          showStatus(message.error || 'Error reconstruyendo el stream.');
          setDownloading(false);
        }
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
  }

  function cancelWasmDownload(url) {
    chrome.runtime.sendMessage({ type: 'SVD_WASM_CANCEL', url }, () => void chrome.runtime.lastError);
  }

  const STREAM_QUALITY_RE = /(\d{3,4}p|4k|fhd|hd|sd)/i;

  function sanitizeForFilename(text) {
    return String(text || 'video').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  }

  /**
   * Distintas calidades del MISMO video comparten carpeta en el CDN (p. ej.
   * ".../90a40b9a-.../5/hls.m3u8" y ".../90a40b9a-.../5/hls-720p.m3u8"),
   * mientras que videos DISTINTOS en la misma página (varios reproductores
   * embebidos) caen en carpetas distintas. Agrupar por esa carpeta es lo
   * que permite mostrar una tarjeta por video real en vez de mezclar todo
   * lo detectado en la pestaña en un solo ítem.
   */
  function streamGroupKey(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname + parsed.pathname.replace(/\/[^/]*$/, '');
    } catch (_err) {
      return url;
    }
  }

  /**
   * Un mismo video HLS/DASH suele generar VARIAS peticiones de manifiesto
   * (el maestro + una por cada calidad que referencia) — sin agrupar, cada
   * una aparecía como una tarjeta duplicada idéntica en el popup. Aquí se
   * combinan las de un mismo video en un solo item con selector de calidad
   * (igual que ya se hace con los <video>/<source>), pero videos distintos
   * de la misma página quedan en tarjetas separadas.
   */
  function streamsToVideos(streams, pageTitle) {
    if (streams.length === 0) return [];

    const groups = new Map();
    for (const stream of streams) {
      const key = streamGroupKey(stream.url);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(stream);
    }

    const groupList = Array.from(groups.values());
    return groupList.map((groupStreams, groupIndex) => {
      const title = groupList.length > 1 ? `${pageTitle || 'video'} (${groupIndex + 1})` : pageTitle || 'video';
      const filename = `${sanitizeForFilename(title)}.mp4`;

      const variants = groupStreams.map((stream, index) => {
        // El badge muestra el formato de SALIDA (siempre .mp4, sea cual sea
        // el protocolo de origen) — "HLS 720P" confundía, porque el archivo
        // que termina descargando el usuario es un MP4 normal, no un .m3u8.
        // DASH sigue etiquetado aparte porque todavía no se puede descargar.
        const label = stream.kind === 'dash' ? 'DASH' : 'MP4';
        const match = STREAM_QUALITY_RE.exec(stream.url);
        return {
          url: stream.url,
          filename,
          mime: stream.kind === 'dash' ? 'application/dash+xml' : 'application/x-mpegURL',
          width: null,
          height: null,
          duration: null,
          qualityLabel: match ? `${label} ${match[1].toUpperCase()}` : `${label} #${index + 1}`,
          downloadable: true,
          kind: stream.kind,
          sizeBytes: null,
        };
      });

      return { id: `stream-group-${groupIndex}`, filename, poster: null, duration: null, selectedIndex: 0, variants };
    });
  }

  /**
   * Descargas HLS/wasm que siguen en curso en background.js aunque el popup
   * que las inició ya se haya cerrado — así, si el usuario vuelve a abrir el
   * popup mientras tanto, ve el progreso real en vez del botón "Download"
   * como si nada estuviera pasando. Devuelve un Map url -> percent.
   */
  function getActiveDownloads() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'SVD_GET_ACTIVE_DOWNLOADS' }, (resp) => {
        void chrome.runtime.lastError;
        resolve(new Map((resp && resp.active ? resp.active : []).map((e) => [e.url, e.percent])));
      });
    });
  }

  async function loadVideos() {
    const [response, streamsResponse, activeDownloads] = await Promise.all([
      sendToContentScript({ type: 'SVD_GET_VIDEOS' }),
      new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'SVD_GET_STREAMS', tabId: local.tabId }, (r) => {
          void chrome.runtime.lastError;
          resolve(r);
        });
      }),
      getActiveDownloads(),
    ]);

    const streams = streamsResponse && streamsResponse.ok ? streamsResponse.streams : [];
    const streamVideos = streamsToVideos(streams, local.pageTitle);

    // Si ya se detectó un stream HLS/DASH por red, es casi siempre EL video
    // de la página (el caso típico de esta extensión: una página, un
    // video). El <video> bloqueado (blob:) que escanea el DOM y cualquier
    // enlace <a href="...mp4"> suelto son el mismo contenido visto desde
    // otro ángulo — mostrarlos igual solo agrega tarjetas duplicadas o
    // bloqueadas sin ninguna opción real nueva.
    const domVideos = streamVideos.length > 0 ? [] : response && response.ok ? response.videos : [];

    if (streamVideos.length > 0 || (response && response.ok)) {
      local.domain = (response && response.domain) || local.domain;
      const fallbackPoster = (response && response.pageThumbnail) || null;
      const videos = [...domVideos, ...streamVideos].map((v) => ({ ...v, poster: v.poster || fallbackPoster }));
      renderVideos(videos, activeDownloads);
    } else {
      renderVideos([], activeDownloads);
      showStatus('Esta página no permite detectar videos.');
    }
  }

  async function init() {
    local.settings = await window.SVDStorage.getSettings();
    els.root.setAttribute('data-theme', local.settings.theme);
    applyTranslations(document, local.settings.language);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    local.tabId = tab.id;
    local.pageTitle = tab.title || '';
    local.tabUrl = tab.url || '';

    try {
      local.domain = new URL(tab.url).hostname.replace(/^www\./i, '');
    } catch (_err) {
      local.domain = '';
    }
    els.domain.textContent = local.domain || 'Página especial del navegador';
    els.favicon.src = tab.favIconUrl || '';
    els.favicon.onerror = () => {
      els.favicon.style.visibility = 'hidden';
    };

    await loadVideos();
    await maybeAutoExpandQuality();
  }

  /**
   * Si el popup se abrió desde el botón flotante que overlay.js dibuja sobre
   * el <video> (no desde el icono normal de la barra), despliega de una vez
   * el selector de calidad del primer video para que el usuario elija la
   * resolución con un solo clic — ver SVD_OPEN_POPUP/SVD_CONSUME_AUTO_EXPAND
   * en background.js. showPicker() no existe en navegadores viejos ni
   * funciona en un <select> deshabilitado (una sola calidad, nada que
   * elegir), así que ambos casos fallan en silencio.
   */
  function maybeAutoExpandQuality() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'SVD_CONSUME_AUTO_EXPAND' }, (resp) => {
        void chrome.runtime.lastError;
        if (resp && resp.autoExpand) {
          const select = els.videoList.querySelector('.video-item__quality');
          if (select && !select.disabled && typeof select.showPicker === 'function') {
            try {
              select.showPicker();
            } catch (_err) {
              // Requiere activación de usuario reciente; si no está disponible,
              // el <select> queda ahí, colapsado pero perfectamente usable.
            }
          }
        }
        resolve();
      });
    });
  }

  els.refreshBtn.addEventListener('click', async () => {
    els.refreshBtn.classList.add('is-spinning');
    await loadVideos();
    setTimeout(() => els.refreshBtn.classList.remove('is-spinning'), 400);
  });

  els.settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  els.rescanBtn.addEventListener('click', async () => {
    await loadVideos();
    showStatus('¿Sigue sin aparecer? Recarga la página y asegúrate de que el video ya empezó a reproducirse.');
  });

  els.historyBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  els.downloadsFolderBtn.addEventListener('click', () => {
    chrome.downloads.showDefaultFolder();
  });

  els.clearHistoryBtn.addEventListener('click', async () => {
    await window.SVDStorage.clearHistory();
    showStatus('Historial borrado.');
  });

  els.helpBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://github.com/alvarosiles/super-video-downloader#readme' });
  });

  init();
})();
