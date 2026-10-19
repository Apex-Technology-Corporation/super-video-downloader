/**
 * scripts/hls-parser.js — Super Video Downloader
 * ─────────────────────────────────────────────────────────────────────────
 * Parser mínimo de manifiestos HLS (RFC 8216), lo justo para lo que hace
 * falta aquí: distinguir un maestro (lista de calidades) de una playlist de
 * medios (lista de segmentos), y resolver URLs relativas. No soporta
 * #EXT-X-BYTERANGE ni streams cifrados (#EXT-X-KEY con METHOD != NONE) —
 * en ese caso se lanza un error explícito en vez de producir un archivo
 * corrupto en silencio.
 */
(function (root) {
  'use strict';

  function resolveUrl(base, url) {
    try {
      return new URL(url, base).href;
    } catch (_err) {
      return url;
    }
  }

  function parseMasterPlaylist(text, baseUrl) {
    const lines = text.split(/\r?\n/);
    const variants = [];
    let pendingInfo = null;

    for (const line of lines) {
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const bandwidthMatch = /BANDWIDTH=(\d+)/.exec(line);
        const resMatch = /RESOLUTION=(\d+x\d+)/.exec(line);
        pendingInfo = {
          bandwidth: bandwidthMatch ? Number(bandwidthMatch[1]) : 0,
          resolution: resMatch ? resMatch[1] : null,
        };
      } else if (pendingInfo && line.trim() && !line.startsWith('#')) {
        variants.push({ url: resolveUrl(baseUrl, line.trim()), ...pendingInfo });
        pendingInfo = null;
      }
    }
    return variants;
  }

  function parseMediaPlaylist(text, baseUrl) {
    const lines = text.split(/\r?\n/);
    const segments = [];
    let pendingDuration = 0;
    let encrypted = false;

    for (const line of lines) {
      if (line.startsWith('#EXT-X-KEY:') && !/METHOD=NONE/.test(line)) {
        encrypted = true;
      } else if (line.startsWith('#EXT-X-BYTERANGE')) {
        throw new Error('Este stream usa EXT-X-BYTERANGE, no soportado todavía.');
      } else if (line.startsWith('#EXTINF:')) {
        const match = /#EXTINF:([\d.]+)/.exec(line);
        pendingDuration = match ? parseFloat(match[1]) : 0;
      } else if (line.trim() && !line.startsWith('#')) {
        segments.push({ url: resolveUrl(baseUrl, line.trim()), duration: pendingDuration });
        pendingDuration = 0;
      }
    }

    if (encrypted) {
      throw new Error('Este stream está cifrado (EXT-X-KEY), no soportado.');
    }

    return segments;
  }

  /** true si el texto es un maestro (referencia otras playlists) en vez de una lista de segmentos. */
  function isMasterPlaylist(text) {
    return /#EXT-X-STREAM-INF:/.test(text);
  }

  root.SVDHls = { parseMasterPlaylist, parseMediaPlaylist, isMasterPlaylist, resolveUrl };
})(typeof self !== 'undefined' ? self : this);
// C:\Users\TU_USUARIO\AppData\Local\Google\Chrome\User Data\Default\Extensions\lmjnegcaeklhafolokijcfjliaokphfk\