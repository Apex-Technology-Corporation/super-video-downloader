/**
 * options.js — Super Video Downloader
 * ─────────────────────────────────────────────────────────────────────────
 * Página de configuración: ajustes generales + historial de descargas.
 */

(() => {
  'use strict';

  const { formatBytes, applyTranslations, t } = window.SVDUtils;

  const els = {
    root: document.documentElement,
    downloadFolder: document.getElementById('downloadFolder'),
    autoName: document.getElementById('autoName'),
    showNotifications: document.getElementById('showNotifications'),
    autoRefresh: document.getElementById('autoRefresh'),
    theme: document.getElementById('theme'),
    language: document.getElementById('language'),
    saveBtn: document.getElementById('saveBtn'),
    historyList: document.getElementById('historyList'),
    historyEmpty: document.getElementById('historyEmpty'),
    clearHistoryBtn: document.getElementById('clearHistoryBtn'),
    historyTemplate: document.getElementById('historyItemTemplate'),
  };

  let toastEl = null;
  function showToast(text) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.add('is-visible');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.remove('is-visible'), 1800);
  }

  function applyThemeAndLanguage(settings) {
    els.root.setAttribute('data-theme', settings.theme);
    applyTranslations(document, settings.language);
  }

  async function loadSettings() {
    const settings = await window.SVDStorage.getSettings();
    els.downloadFolder.value = settings.downloadFolder;
    els.autoName.checked = settings.autoName;
    els.showNotifications.checked = settings.showNotifications;
    els.autoRefresh.checked = settings.autoRefresh;
    els.theme.value = settings.theme;
    els.language.value = settings.language;
    applyThemeAndLanguage(settings);
  }

  async function saveSettings() {
    const settings = await window.SVDStorage.saveSettings({
      downloadFolder: window.SVDUtils.sanitizeFilename(els.downloadFolder.value.trim()) || 'SuperVideoDownloader',
      autoName: els.autoName.checked,
      showNotifications: els.showNotifications.checked,
      autoRefresh: els.autoRefresh.checked,
      theme: els.theme.value,
      language: els.language.value,
    });

    applyThemeAndLanguage(settings);
    showToast(t(settings.language, 'saved'));

    // Avisar a las pestañas abiertas para que apliquen "autoRefresh" ya
    // mismo, sin esperar a que recarguen la página.
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'SVD_SETTINGS_CHANGED' }, () => void chrome.runtime.lastError);
    }
  }

  function historyMeta(entry, lang) {
    const date = new Date(entry.date).toLocaleString(lang === 'en' ? 'en-US' : 'es-ES');
    const size = formatBytes(entry.size) || t(lang, 'unknown');
    return [date, entry.site, size].filter(Boolean).join(' · ');
  }

  async function loadHistory() {
    const settings = await window.SVDStorage.getSettings();
    const history = await window.SVDStorage.getHistory();

    els.historyList.innerHTML = '';
    els.historyEmpty.classList.toggle('hidden', history.length > 0);

    for (const entry of history) {
      const node = els.historyTemplate.content.firstElementChild.cloneNode(true);
      node.querySelector('.history-item__name').textContent = entry.filename;
      node.querySelector('.history-item__meta').textContent = historyMeta(entry, settings.language);
      node.querySelector('.history-item__remove').addEventListener('click', async () => {
        await window.SVDStorage.removeHistoryEntry(entry.id);
        loadHistory();
      });
      els.historyList.appendChild(node);
    }
  }

  els.saveBtn.addEventListener('click', saveSettings);

  els.clearHistoryBtn.addEventListener('click', async () => {
    await window.SVDStorage.clearHistory();
    loadHistory();
  });

  loadSettings();
  loadHistory();
})();
