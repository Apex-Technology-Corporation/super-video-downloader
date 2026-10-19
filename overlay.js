/**
 * overlay.js — Super Video Downloader
 * ─────────────────────────────────────────────────────────────────────────
 * Dibuja un botón flotante en la esquina de cada <video> de la página. Un
 * clic abre el popup real de la extensión (popup.html) — el mismo que se
 * abre al tocar el icono de la barra de extensiones — para que el usuario
 * elija la calidad y descargue directamente ahí, reusando el selector de
 * calidad y la barra de progreso que ya existen en el popup en vez de
 * duplicar esa UI dentro de la página.
 *
 * Mismo enfoque que el overlay de Super Video Popup:
 *   - Shadow DOM para no chocar con los estilos del sitio.
 *   - Visible siempre que el video sea lo bastante grande y esté en
 *     pantalla (no depende de hover: muchos sitios tapan el <video> con una
 *     capa que intercepta el mouse antes de llegar al elemento real).
 *   - Reposicionamiento en cada frame (rAF) en vez de solo scroll/resize.
 *   - También encuentra <video> dentro de Shadow DOM abierto.
 *
 * chrome.action.openPopup() no está disponible en content scripts, así que
 * el clic solo manda un mensaje a background.js para que lo abra — Chrome
 * sigue reconociendo la activación transitoria reciente de la pestaña
 * (el clic real del usuario) aunque el mensaje viaje de forma asíncrona.
 */

(() => {
  'use strict';

  if (window.__SVDOverlayInjected) return;
  window.__SVDOverlayInjected = true;

  const MIN_SIZE = 80; // px — ignora videos minúsculos (iconos, trackers, etc.)
  const buttons = new WeakMap(); // video -> { host, btn }

  const ICON_DOWNLOAD =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">' +
    '<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';

  function makeButton() {
    const host = document.createElement('div');
    host.style.all = 'initial';
    host.style.position = 'absolute';
    host.style.zIndex = '2147483647';
    host.style.top = '0';
    host.style.left = '0';
    host.style.pointerEvents = 'none';
    host.style.display = 'none';

    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .btn {
        all: initial;
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: rgba(32, 33, 36, 0.85);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        color: #fff;
        cursor: pointer;
        pointer-events: auto;
        font-family: sans-serif;
        transition: background 150ms ease, transform 150ms ease;
      }
      .btn:hover { background: #4285f4; transform: scale(1.06); }
      .btn.is-busy { cursor: wait; opacity: 0.6; }
    `;

    const btn = document.createElement('div');
    btn.className = 'btn';
    btn.title = 'Descargar este video';
    btn.innerHTML = ICON_DOWNLOAD;

    root.appendChild(style);
    root.appendChild(btn);
    document.documentElement.appendChild(host);

    return { host, btn };
  }

  function bindClick(entry) {
    entry.btn.addEventListener(
      'click',
      (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        if (entry.btn.classList.contains('is-busy')) return;

        entry.btn.classList.add('is-busy');
        chrome.runtime.sendMessage({ type: 'SVD_OPEN_POPUP' }, () => {
          void chrome.runtime.lastError;
          entry.btn.classList.remove('is-busy');
        });
      },
      true
    );
  }

  function updatePosition(video, entry) {
    const rect = video.getBoundingClientRect();
    const onScreen =
      rect.width >= MIN_SIZE &&
      rect.height >= MIN_SIZE &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth &&
      video.isConnected;

    if (!onScreen) {
      entry.host.style.display = 'none';
      return;
    }

    entry.host.style.display = 'block';
    entry.host.style.top = `${rect.top + window.scrollY + 8}px`;
    entry.host.style.left = `${rect.left + window.scrollX + 8}px`;
  }

  // ── Descubrimiento de <video> (documento + Shadow DOM) ──────────────────

  const trackedVideos = new Set();
  const observedRoots = new WeakSet();

  function attach(video) {
    if (buttons.has(video)) return;
    const entry = makeButton();
    bindClick(entry);
    buttons.set(video, entry);
    trackedVideos.add(video);
  }

  function detach(video) {
    const entry = buttons.get(video);
    if (entry) {
      entry.host.remove();
      buttons.delete(video);
    }
    trackedVideos.delete(video);
  }

  function collectVideos(root, out) {
    for (const el of root.querySelectorAll('*')) {
      if (el.tagName === 'VIDEO') out.push(el);
      if (el.shadowRoot) {
        if (!observedRoots.has(el.shadowRoot)) {
          observedRoots.add(el.shadowRoot);
          observer.observe(el.shadowRoot, { childList: true, subtree: true });
        }
        collectVideos(el.shadowRoot, out);
      }
    }
    return out;
  }

  function scan() {
    const found = collectVideos(document, []);
    const foundSet = new Set(found);
    for (const video of found) attach(video);
    for (const video of trackedVideos) {
      if (!foundSet.has(video) || !video.isConnected) detach(video);
    }
  }

  function tick() {
    for (const video of trackedVideos) {
      const entry = buttons.get(video);
      if (entry) updatePosition(video, entry);
    }
    requestAnimationFrame(tick);
  }

  const observer = new MutationObserver((mutations) => {
    let changed = false;
    for (const m of mutations) {
      if (m.addedNodes.length || m.removedNodes.length) changed = true;
    }
    if (changed) scan();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  scan();
  requestAnimationFrame(tick);
})();
