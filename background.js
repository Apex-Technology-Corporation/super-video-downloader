/**
 * background.js — Super Video Downloader
 * ─────────────────────────────────────────────────────────────────────────
 * Service worker de Manifest V3. Responsabilidades:
 *
 *   1. Mantener el badge del icono con el número de videos detectados en
 *      la pestaña activa (lo informa content.js en cada escaneo).
 *   2. Registrar en el historial cada descarga que termina, y avisar con
 *      una notificación si el usuario lo activó en Opciones. Esto vive
 *      aquí (y no en el popup) porque el popup puede cerrarse antes de que
 *      la descarga termine, y el service worker sigue activo.
 *   3. Detectar manifiestos de streaming adaptativo (HLS .m3u8 / DASH .mpd)
 *      con chrome.webRequest — un <video> nunca expone esa URL en el DOM
 *      cuando el sitio usa hls.js/dash.js (el elemento reproduce un blob:
 *      generado por MediaSource), así que la única forma honesta de verla
 *      es observar la petición de red real, no inventarla.
 *   4. Reconstruir esos streams con ffmpeg.wasm en un offscreen document
 *      (ver offscreen/offscreen.js) y reenviar el progreso al popup — sin
 *      tocar DRM ni contenido cifrado, y sin depender de nada instalado
 *      fuera de la extensión.
 *
 * Carga utils.js y storage.js como scripts clásicos (importScripts, no
 * módulos ES) para reutilizar exactamente la misma lógica que el resto de
 * la extensión — ver scripts/utils.js para más contexto sobre esta
 * decisión.
 */

importScripts('scripts/utils.js', 'scripts/storage.js');

// downloadId -> { site, sizeHint }, solo mientras la descarga está en curso.
const pendingDownloads = new Map();

// true justo después de que el botón flotante (overlay.js) pidió abrir el
// popup — ver SVD_OPEN_POPUP / SVD_CONSUME_AUTO_EXPAND más abajo.
let pendingAutoExpandQuality = false;

// url del stream -> { percent, tabId }, solo mientras dura una
// reconstrucción HLS/DASH vía ffmpeg.wasm — permite mostrar el progreso en
// el badge del icono aunque el popup que la inició ya se haya cerrado, Y
// que un popup recién (re)abierto sepa que ya hay una descarga en curso
// para ese video y muestre su progreso actual en vez del botón "Download"
// (ver SVD_WASM_PROGRESS, SVD_GET_ACTIVE_DOWNLOADS y restoreBadge más abajo).
const activeWasmProgress = new Map();

/** Vuelve a mostrar el conteo normal de videos detectados en el badge, después de mostrar un progreso de descarga. */
function restoreBadge(tabId) {
  const count = menuVideosByTab.get(tabId)?.length || 0;
  if (count > 0) {
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#4285F4' });
    chrome.action.setBadgeText({ tabId, text: String(count) });
  } else {
    chrome.action.setBadgeText({ tabId, text: '' });
  }
}

// tabId -> Map(url -> { url, kind, tabId, firstSeen }), streams detectados
// por red en esa pestaña. Se limpia cuando la pestaña navega o se cierra.
const streamsByTab = new Map();

const MANIFEST_RE = /\.(m3u8|mpd)(\?.*)?(#.*)?$/i;

function streamKind(url) {
  if (/\.m3u8(\?|#|$)/i.test(url)) return 'hls';
  if (/\.mpd(\?|#|$)/i.test(url)) return 'dash';
  return null;
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (!MANIFEST_RE.test(details.url)) return;
    const kind = streamKind(details.url);
    if (!kind) return;

    let tabStreams = streamsByTab.get(details.tabId);
    if (!tabStreams) {
      tabStreams = new Map();
      streamsByTab.set(details.tabId, tabStreams);
    }
    if (!tabStreams.has(details.url)) {
      tabStreams.set(details.url, { url: details.url, kind, tabId: details.tabId, firstSeen: Date.now() });
    }
  },
  { urls: ['http://*/*', 'https://*/*'] }
);

function clearTabStreams(tabId) {
  streamsByTab.delete(tabId);
}

chrome.tabs.onRemoved.addListener(clearTabStreams);
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) clearTabStreams(details.tabId);
});

// ── Menú contextual: lista los videos detectados en la pestaña activa,
// igual que "Video Download Helper" — no depende de acertar el clic
// exacto sobre el <video> real, porque muchos sitios lo tapan con un
// overlay (controles, publicidad) y el contexto "video" nunca se dispara.

const CONTEXT_MENU_ROOT = 'svd-root';

// tabId -> [{ url, filename, downloadable, kind }], combina lo que reporta
// content.js (DOM) con lo que ve background.js por red (streamsByTab).
const menuVideosByTab = new Map();

// menuItemId -> { url, kind }, solo para el menú actualmente construido.
let menuItemMap = new Map();

async function tabVideoList(tabId) {
  const fromDom = menuVideosByTab.get(tabId) || [];
  const networkEntries = Array.from(streamsByTab.get(tabId)?.values() || []);

  let fromNetwork = [];
  if (networkEntries.length > 0) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    fromNetwork = networkEntries.map((s) => ({
      url: s.url,
      filename: self.SVDUtils.filenameFromUrl(s.url, tab?.title),
      downloadable: true,
      kind: s.kind,
    }));
  }

  const byUrl = new Map();
  for (const v of [...fromDom, ...fromNetwork]) {
    if (!byUrl.has(v.url)) byUrl.set(v.url, v);
  }
  return Array.from(byUrl.values());
}

function truncateTitle(text, max = 60) {
  const clean = String(text || 'video');
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

async function rebuildMenuForTab(tabId) {
  const videos = await tabVideoList(tabId);
  menuItemMap = new Map();

  await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));

  if (videos.length === 0) return;

  chrome.contextMenus.create({
    id: CONTEXT_MENU_ROOT,
    title: 'Super Video Downloader',
    contexts: ['all'],
  });

  videos.forEach((video, index) => {
    const id = `svd-video-${index}`;
    const kind = video.kind || streamKind(video.url);
    const label = kind === 'hls' ? 'HLS' : kind === 'dash' ? 'DASH' : '';
    menuItemMap.set(id, { url: video.url, kind });
    chrome.contextMenus.create({
      id,
      parentId: CONTEXT_MENU_ROOT,
      title: label ? `${truncateTitle(video.filename)} (${label})` : truncateTitle(video.filename),
      contexts: ['all'],
    });
  });
}

async function refreshMenuIfActiveTab(tabId) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id === tabId) await rebuildMenuForTab(tabId);
}

chrome.tabs.onActivated.addListener(({ tabId }) => rebuildMenuForTab(tabId));
chrome.tabs.onRemoved.addListener((tabId) => menuVideosByTab.delete(tabId));
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) {
    menuVideosByTab.delete(details.tabId);
    refreshMenuIfActiveTab(details.tabId);
  }
});

function siteFromTab(tab) {
  try {
    return new URL(tab?.url || '').hostname.replace(/^www\./i, '');
  } catch (_err) {
    return '';
  }
}

/**
 * Descarga `url` (video detectado en `tab`), manejando los tres casos
 * posibles: stream HLS/DASH (reconstrucción vía ffmpeg.wasm), blob: (no hay
 * nada honesto que descargar sin pasar por el popup) y archivo directo
 * (chrome.downloads.download normal). Usada por el menú contextual.
 */
async function downloadDetectedVideo(url, kind, tab) {
  if (!url) return;

  if (url.startsWith('blob:')) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'assets/icons/icon128.png',
      title: 'Super Video Downloader',
      message: 'Este video usa un reproductor que oculta la URL real. Abre el popup de la extensión para descargarlo.',
    });
    return;
  }

  const site = siteFromTab(tab);

  if (kind) {
    const settings = await self.SVDStorage.getSettings();
    const headers = { 'User-Agent': navigator.userAgent };
    if (tab?.url) {
      headers.Referer = tab.url;
      try {
        headers.Origin = new URL(tab.url).origin;
      } catch (_err) {}
    }
    const result = await startWasmDownload({
      url,
      filename: self.SVDUtils.filenameFromUrl(url, tab?.title, 'video/mp4').replace(/\.[a-z0-9]{2,5}$/i, '.mp4'),
      headers,
      site,
      settings,
    });
    if (!result.ok) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'assets/icons/icon128.png',
        title: 'Super Video Downloader',
        message: result.error || 'No se pudo descargar el stream.',
      });
    }
    return;
  }

  const settings = await self.SVDStorage.getSettings();
  const folder = (settings.downloadFolder || '').replace(/^\/+|\/+$/g, '');
  const filename = self.SVDUtils.filenameFromUrl(url, tab?.title);

  chrome.downloads.download(
    {
      url,
      filename: folder ? `${folder}/${filename}` : filename,
      saveAs: !settings.autoName,
    },
    (downloadId) => {
      if (chrome.runtime.lastError || downloadId === undefined) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'assets/icons/icon128.png',
          title: 'Super Video Downloader',
          message: chrome.runtime.lastError?.message || 'No se pudo iniciar la descarga.',
        });
        return;
      }
      pendingDownloads.set(downloadId, { site, sizeHint: 0 });
    }
  );
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const entry = menuItemMap.get(String(info.menuItemId));
  if (!entry) return;
  await downloadDetectedVideo(entry.url, entry.kind, tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  if (message.type === 'SVD_BADGE_COUNT' && sender.tab?.id != null) {
    const tabId = sender.tab.id;
    if (message.count > 0) {
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#4285F4' });
      chrome.action.setBadgeText({ tabId, text: String(message.count) });
    } else {
      chrome.action.setBadgeText({ tabId, text: '' });
    }
    menuVideosByTab.set(tabId, Array.isArray(message.videos) ? message.videos : []);
    refreshMenuIfActiveTab(tabId);
    return false;
  }

  if (message.type === 'SVD_REGISTER_DOWNLOAD') {
    pendingDownloads.set(message.downloadId, {
      site: message.site || '',
      sizeHint: message.sizeHint || 0,
    });
    return false;
  }

  if (message.type === 'SVD_GET_STREAMS') {
    const tabStreams = streamsByTab.get(message.tabId);
    sendResponse({ ok: true, streams: tabStreams ? Array.from(tabStreams.values()) : [] });
    return false;
  }

  if (message.type === 'SVD_WASM_DOWNLOAD') {
    (async () => {
      // sender.tab no existe acá (el mensaje viene del popup, una página de
      // extensión, no de un content script) — hay que preguntarle a
      // chrome.tabs cuál es la pestaña activa para poder actualizar SU badge.
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = activeTab?.id ?? null;
      if (tabId != null) activeWasmProgress.set(message.url, { percent: 0, tabId });

      const result = await startWasmDownload(message);

      activeWasmProgress.delete(message.url);
      if (tabId != null) restoreBadge(tabId);
      // Broadcast: para que un popup recién (re)abierto que ya perdió la
      // respuesta directa (el que lo pidió puede haberse cerrado) sepa que
      // esta descarga terminó — ver el listener que arma el estado
      // "reanudado" en popup.js.
      chrome.runtime.sendMessage(
        { type: 'SVD_WASM_DONE', url: message.url, ok: result.ok, downloadId: result.downloadId, error: result.error },
        () => void chrome.runtime.lastError
      );

      sendResponse(result);
    })();
    return true;
  }

  if (message.type === 'SVD_WASM_PROGRESS') {
    const entry = activeWasmProgress.get(message.url);
    if (entry) {
      entry.percent = message.percent;
      if (message.percent != null) {
        chrome.action.setBadgeBackgroundColor({ tabId: entry.tabId, color: '#fbbc04' });
        chrome.action.setBadgeText({ tabId: entry.tabId, text: `${message.percent}%` });
      }
    }
    return false;
  }

  if (message.type === 'SVD_GET_ACTIVE_DOWNLOADS') {
    sendResponse({ active: Array.from(activeWasmProgress.entries()).map(([url, v]) => ({ url, percent: v.percent })) });
    return false;
  }

  if (message.type === 'SVD_OPEN_POPUP') {
    // El clic en el botón flotante (overlay.js) llega acá como mensaje async,
    // pero Chrome sigue reconociendo la "activación transitoria" reciente de
    // la pestaña (el clic real del usuario en la página) para permitir
    // openPopup() — a diferencia de requestPictureInPicture(), no hace falta
    // propagarlo de forma síncrona con chrome.scripting.executeScript.
    //
    // pendingAutoExpandQuality queda en true hasta que popup.js la consuma
    // (SVD_CONSUME_AUTO_EXPAND) justo después de renderizar la lista de
    // videos, para abrir el selector de calidad del primero sin que el
    // usuario tenga que tocarlo — solo cuando el popup se abrió desde este
    // botón, no cuando se abre del modo normal (icono de la barra).
    pendingAutoExpandQuality = true;
    chrome.action.openPopup().then(
      () => sendResponse({ ok: true }),
      (err) => {
        pendingAutoExpandQuality = false;
        sendResponse({ ok: false, error: err?.message });
      }
    );
    return true;
  }

  if (message.type === 'SVD_CONSUME_AUTO_EXPAND') {
    const value = pendingAutoExpandQuality;
    pendingAutoExpandQuality = false;
    sendResponse({ autoExpand: value });
    return false;
  }

  return false;
});

// ── Descarga sin instalar nada aparte: ffmpeg.wasm en un offscreen document ──

const WASM_HEADER_RULE_ID = 9001;

/** Crea el offscreen document si no existe ya uno (solo puede haber uno por extensión). */
async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: ['WORKERS'],
    justification: 'Ejecutar ffmpeg.wasm para reconstruir streams HLS sin depender de una app externa.',
  });
}

/**
 * chrome.offscreen.createDocument() resuelve en cuanto el documento existe,
 * no cuando su script terminó de registrar el listener de mensajes — sin
 * esto, el primer sendMessage puede llegar antes y fallar con "Receiving
 * end does not exist" (carrera de inicialización, no del lado de quien
 * llama).
 */
async function sendToOffscreen(message, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (err) {
      if (i === attempts - 1 || !/Receiving end does not exist/.test(err.message || '')) throw err;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
}

// Cuántas descargas vía ffmpeg.wasm siguen en curso — el offscreen document
// completo (no solo la instancia de ffmpeg) se cierra cuando llega a 0, para
// liberar también la memoria del propio proceso del documento, no solo la
// del motor de WASM.
let activeWasmDownloads = 0;

async function closeOffscreenIfIdle() {
  activeWasmDownloads = Math.max(0, activeWasmDownloads - 1);
  if (activeWasmDownloads > 0) return;
  await chrome.offscreen.closeDocument().catch(() => {});
}

/**
 * fetch() nunca puede poner Referer/Origin (son "forbidden headers" del
 * propio estándar, sin excepción para extensiones) — declarativeNetRequest
 * es la única forma de lograrlo en MV3. La regla se agrega justo antes de
 * pedir el manifiesto y se quita al terminar, para no afectar el resto del
 * tráfico del usuario.
 */
async function withHeaderOverride(manifestUrl, headers, fn) {
  let domain = null;
  try {
    domain = new URL(manifestUrl).hostname;
  } catch (_err) {}

  const rule = domain && {
    id: WASM_HEADER_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: Object.entries(headers || {})
        .filter(([, value]) => value)
        .map(([header, value]) => ({ header, operation: 'set', value })),
    },
    condition: { urlFilter: `||${domain}^`, resourceTypes: ['xmlhttprequest', 'media', 'other'] },
  };

  if (rule && rule.action.requestHeaders.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [rule], removeRuleIds: [WASM_HEADER_RULE_ID] });
  }
  try {
    return await fn();
  } finally {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [WASM_HEADER_RULE_ID] }).catch(() => {});
  }
}

/**
 * Orquesta la descarga vía ffmpeg.wasm: agrega la regla de cabeceras, le
 * pide al offscreen document que reconstruya el stream, y con el blob: URL
 * resultante dispara chrome.downloads.download — así el historial y la
 * notificación salen gratis del listener de chrome.downloads.onChanged que
 * ya existe más abajo, igual que cualquier descarga directa.
 */
async function startWasmDownload({ url, filename, headers, site, settings }) {
  activeWasmDownloads += 1;
  try {
    await ensureOffscreenDocument();

    const result = await withHeaderOverride(url, headers, () =>
      sendToOffscreen({ type: 'SVD_WASM_DOWNLOAD', url, filename })
    );

    if (!result || !result.ok) {
      return { ok: false, error: (result && result.error) || 'El offscreen document no respondió' };
    }

    const downloadId = await new Promise((resolve, reject) => {
      chrome.downloads.download(
        { url: result.blobUrl, filename: result.filename, saveAs: !(settings && settings.autoName) },
        (id) => {
          if (chrome.runtime.lastError || id === undefined) {
            reject(new Error(chrome.runtime.lastError?.message || 'No se pudo iniciar la descarga'));
            return;
          }
          resolve(id);
        }
      );
    });

    pendingDownloads.set(downloadId, { site: site || '', sizeHint: result.sizeBytes || 0, blobUrl: result.blobUrl });
    return { ok: true, downloadId };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  } finally {
    await closeOffscreenIfIdle();
  }
}

chrome.downloads.onChanged.addListener(async (delta) => {
  if (!delta.state) return;

  // Sea cual sea el desenlace, si esta descarga vino de un blob: (el flujo
  // de ffmpeg.wasm) hay que liberar esa memoria — revocarlo se puede hacer
  // desde cualquier contexto de la extensión, no hace falta ser el mismo
  // que lo creó (offscreen.js), solo compartir origen.
  if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
    const meta = pendingDownloads.get(delta.id);
    if (meta?.blobUrl) URL.revokeObjectURL(meta.blobUrl);
  }

  if (delta.state.current !== 'complete') {
    if (delta.state.current === 'interrupted') pendingDownloads.delete(delta.id);
    return;
  }

  const [item] = await chrome.downloads.search({ id: delta.id });
  if (!item) return;

  const meta = pendingDownloads.get(delta.id) || {};
  pendingDownloads.delete(delta.id);

  const filename = item.filename.split(/[\\/]/).pop();

  await self.SVDStorage.addHistoryEntry({
    id: delta.id,
    date: Date.now(),
    filename,
    size: item.fileSize > 0 ? item.fileSize : meta.sizeHint,
    site: meta.site,
    url: meta.blobUrl ? '' : item.url,
  });

  const settings = await self.SVDStorage.getSettings();
  if (settings.showNotifications) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'assets/icons/icon128.png',
      title: self.SVDUtils.t(settings.language, 'appName'),
      message: `${filename}`,
    });
  }
});
