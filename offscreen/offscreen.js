/**
 * offscreen.js — Super Video Downloader
 * ─────────────────────────────────────────────────────────────────────────
 * Vive en un offscreen document (chrome.offscreen), el único lugar de una
 * extensión MV3 donde se puede correr ffmpeg.wasm con normalidad (Worker +
 * WebAssembly) sin depender de nada fuera del propio paquete de la
 * extensión — así este flujo no necesita instalar nada aparte y es
 * compatible con la Chrome Web Store.
 *
 * Reconstruye streams HLS sin cifrar: descarga el manifiesto y sus
 * segmentos con fetch() (las cabeceras Referer/Origin las fuerza
 * background.js con declarativeNetRequest antes de pedir esto, porque
 * fetch() nunca puede poner esos headers por sí solo), escribe cada
 * segmento al filesystem virtual de ffmpeg.wasm y usa su demuxer "concat"
 * con "-c copy" (sin recodificar) para dejarlos en un solo .mp4. DASH y
 * streams cifrados (#EXT-X-KEY) no están soportados: se informa el error
 * en vez de producir un archivo corrupto.
 */
'use strict';

const { FFmpeg } = FFmpegWASM;
const { parseMasterPlaylist, parseMediaPlaylist, isMasterPlaylist } = self.SVDHls;

async function fetchFile(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} al pedir ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

// url del manifiesto -> AbortController, solo mientras esa descarga está en curso.
const activeDownloads = new Map();

/**
 * Una instancia nueva de ffmpeg.wasm por descarga (nunca se reutiliza) y se
 * apaga con `.terminate()` al terminar, en vez de guardar un singleton. La
 * memoria lineal de WebAssembly solo crece dentro de una misma instancia
 * (nunca se encoge, aunque se borren los archivos del filesystem virtual)
 * — sin esto, cada descarga sucesiva iba dejando más RAM ocupada sin
 * liberar, incluso con streams chicos.
 */
async function createFfmpeg() {
  const ffmpeg = new FFmpeg();
  await ffmpeg.load({
    coreURL: chrome.runtime.getURL('vendor/ffmpeg/ffmpeg-core.js'),
    wasmURL: chrome.runtime.getURL('vendor/ffmpeg/ffmpeg-core.wasm'),
  });
  return ffmpeg;
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} al pedir ${url}`);
  return res.text();
}

/** Resuelve un manifiesto (maestro o de medios) hasta la lista final de segmentos. */
async function resolveSegments(manifestUrl) {
  let text = await fetchText(manifestUrl);
  let baseUrl = manifestUrl;

  if (isMasterPlaylist(text)) {
    const variants = parseMasterPlaylist(text, baseUrl);
    if (variants.length === 0) throw new Error('Manifiesto maestro sin variantes.');
    // Si la URL pedida resultó ser un maestro (caso raro: el popup ya
    // resuelve variantes concretas), preferimos la calidad más baja por
    // defecto — es la opción más segura en memoria dentro de un offscreen
    // document, que no tiene el margen de un proceso nativo.
    variants.sort((a, b) => a.bandwidth - b.bandwidth);
    baseUrl = variants[0].url;
    text = await fetchText(baseUrl);
  }

  return parseMediaPlaylist(text, baseUrl);
}

/**
 * Cada segmento se escribe directo al filesystem virtual de ffmpeg.wasm en
 * vez de acumularse en un solo Uint8Array de JS — con streams largos, tener
 * el video completo DOS veces en memoria (array de trozos + el merge) fue
 * justo lo que colgó el offscreen document reconstruyendo un stream de
 * varios cientos de MB durante las pruebas. Escribir uno por uno y usar el
 * demuxer "concat" de ffmpeg para unirlos reduce bastante el pico de
 * memoria en el lado de JS (aunque el límite real sigue siendo la RAM
 * disponible para WASM — streams extremadamente largos pueden seguir
 * fallando por memoria, ya que todo se procesa en el navegador).
 */
async function downloadHls({ url, filename }, onProgress, signal) {
  const segments = await resolveSegments(url);
  if (segments.length === 0) throw new Error('El manifiesto no tiene segmentos.');

  const ffmpeg = await createFfmpeg();
  try {
    const totalDuration = segments.reduce((sum, s) => sum + (s.duration || 0), 0);
    const segmentNames = segments.map((_s, i) => `seg${i}.ts`);

    let fetchedDuration = 0;
    let bytesSoFar = 0;
    for (let i = 0; i < segments.length; i++) {
      if (signal.aborted) throw new Error('Cancelado por el usuario.');
      const buf = await fetchFile(segments[i].url, signal);
      await ffmpeg.writeFile(segmentNames[i], buf);
      bytesSoFar += buf.byteLength;
      fetchedDuration += segments[i].duration || 0;
      // 0-70%: descarga de segmentos. 70-100%: remux con ffmpeg.
      const fetchPercent = totalDuration > 0 ? (fetchedDuration / totalDuration) * 70 : ((i + 1) / segments.length) * 70;
      onProgress(Math.min(70, Math.round(fetchPercent)), bytesSoFar);
    }

    const concatListName = 'concat.txt';
    const outputName = 'output.mp4';
    await ffmpeg.writeFile(concatListName, segmentNames.map((name) => `file '${name}'`).join('\n'));

    ffmpeg.on('log', ({ message }) => {
      const match = /time=(\d+):(\d+):(\d+\.\d+)/.exec(message);
      if (match && totalDuration > 0) {
        const elapsed = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        onProgress(Math.min(100, 70 + Math.round((elapsed / totalDuration) * 30)));
      }
    });

    await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', concatListName, '-c', 'copy', '-bsf:a', 'aac_adtstoasc', outputName]);
    const data = await ffmpeg.readFile(outputName);

    const blob = new Blob([data.buffer], { type: 'video/mp4' });
    const blobUrl = URL.createObjectURL(blob);
    onProgress(100);
    return { blobUrl, sizeBytes: blob.size, filename };
  } finally {
    // .terminate() mata el Worker y libera toda la memoria lineal de WASM
    // de una vez — más confiable que borrar archivos uno por uno del
    // filesystem virtual, que no reduce la memoria ya reservada.
    ffmpeg.terminate();
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  if (message.type === 'SVD_WASM_CANCEL') {
    activeDownloads.get(message.url)?.abort();
    return false;
  }

  if (message.type !== 'SVD_WASM_DOWNLOAD') return false;

  (async () => {
    const controller = new AbortController();
    activeDownloads.set(message.url, controller);
    try {
      const result = await downloadHls(
        message,
        (percent, bytesSoFar) => {
          chrome.runtime.sendMessage(
            { type: 'SVD_WASM_PROGRESS', url: message.url, percent, bytesSoFar: bytesSoFar ?? null },
            () => void chrome.runtime.lastError
          );
        },
        controller.signal
      );
      sendResponse({ ok: true, ...result });
    } catch (err) {
      sendResponse({ ok: false, error: (err && err.message) || String(err) });
    } finally {
      activeDownloads.delete(message.url);
    }
  })();

  return true;
});
