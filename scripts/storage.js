/**
 * scripts/storage.js — Super Video Downloader
 * ─────────────────────────────────────────────────────────────────────────
 * Única puerta de entrada a chrome.storage.local para toda la extensión:
 * configuración del usuario e historial de descargas. Cargado como script
 * clásico igual que utils.js (ver ese archivo para el porqué).
 *
 * Nadie fuera de este archivo debe llamar a chrome.storage.local
 * directamente — así, si el día de mañana cambia la forma de guardar algo
 * (p. ej. mover el historial a IndexedDB porque crece mucho), solo hay que
 * tocar este archivo.
 */

(function (root) {
  'use strict';

  const SETTINGS_KEY = 'svdSettings';
  const HISTORY_KEY = 'svdHistory';
  const MAX_HISTORY_ENTRIES = 200;

  const DEFAULT_SETTINGS = {
    downloadFolder: 'SuperVideoDownloader',
    autoName: true,
    showNotifications: true,
    theme: 'dark',
    language: 'es',
    autoRefresh: true,
  };

  async function getSettings() {
    const data = await chrome.storage.local.get([SETTINGS_KEY]);
    return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
  }

  async function saveSettings(partial) {
    const current = await getSettings();
    const next = { ...current, ...partial };
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  }

  async function getHistory() {
    const data = await chrome.storage.local.get([HISTORY_KEY]);
    return data[HISTORY_KEY] || [];
  }

  async function addHistoryEntry(entry) {
    const history = await getHistory();
    history.unshift(entry);
    if (history.length > MAX_HISTORY_ENTRIES) history.length = MAX_HISTORY_ENTRIES;
    await chrome.storage.local.set({ [HISTORY_KEY]: history });
    return history;
  }

  async function removeHistoryEntry(id) {
    const history = await getHistory();
    const next = history.filter((entry) => entry.id !== id);
    await chrome.storage.local.set({ [HISTORY_KEY]: next });
    return next;
  }

  async function clearHistory() {
    await chrome.storage.local.set({ [HISTORY_KEY]: [] });
    return [];
  }

  root.SVDStorage = {
    DEFAULT_SETTINGS,
    getSettings,
    saveSettings,
    getHistory,
    addHistoryEntry,
    removeHistoryEntry,
    clearHistory,
  };
})(typeof window !== 'undefined' ? window : self);
