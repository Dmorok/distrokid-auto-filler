'use strict';

const $ = (id) => document.getElementById(id);
const { isUploadPage, DEFAULT_OPTS } = self.DKShared;

let preset = null; // parsed preset JSON (also kept in chrome.storage.local "lastPreset")

// ---------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------
function renderPresetSummary() {
  const el = $('presetSummary');
  if (!preset) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  const lines = [];
  const add = (k, v) => lines.push(`${k}: ${v}`);
  if (preset.stores) add('stores', Array.isArray(preset.stores) ? preset.stores.join(', ') : preset.stores);
  for (const k of ['recordLabel', 'language', 'genrePrimary', 'genreSecondary', 'composer']) {
    if (preset[k]) add(k, preset[k]);
  }
  if (preset.songwriter) add('songwriter', JSON.stringify(preset.songwriter));
  for (const k of ['explicit', 'instrumental', 'aiGenerated', 'dolbyAtmos']) {
    if (typeof preset[k] === 'boolean') add(k, preset[k]);
  }
  if (Array.isArray(preset.tracks)) add('tracks', preset.tracks.length);
  el.textContent = lines.join('\n') || '(порожній пресет)';
}

function log(text) {
  const el = $('log');
  el.style.display = 'block';
  el.textContent += text + '\n';
  el.scrollTop = el.scrollHeight;
}

function clearLog() {
  $('log').textContent = '';
  $('log').style.display = 'none';
}

async function loadOpts() {
  const { opts } = await chrome.storage.local.get('opts');
  return Object.assign({}, DEFAULT_OPTS, opts || {});
}

async function saveOpt(key, value) {
  const opts = await loadOpts();
  opts[key] = value;
  await chrome.storage.local.set({ opts });
}

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------
// Talking to the page
// ---------------------------------------------------------------------
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ping' });
    return true;
  } catch (e) {
    // Not injected yet (tab was open before the extension was installed/reloaded) — inject now.
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['shared.js', 'content.js'] });
    return true;
  } catch (e2) {
    return false;
  }
}

async function sendToContent(msg, { quiet = false } = {}) {
  const tab = await getActiveTab();
  if (!tab || !isUploadPage(tab.url)) {
    if (!quiet) log('Ця сторінка не схожа на distrokid.com/new/. Відкрийте сторінку завантаження треку.');
    return null;
  }
  if (!(await ensureContentScript(tab.id))) {
    if (!quiet) log('Не вдалося підвантажити скрипт на цю вкладку. Перезавантажте вкладку DistroKid і спробуйте ще раз.');
    return null;
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch (e) {
    if (!quiet) log("Не вдалося зв'язатися зі сторінкою: " + e.message);
    return null;
  }
}

async function refreshStatus() {
  const statusEl = $('pageStatus');
  const tab = await getActiveTab();
  if (!tab || !isUploadPage(tab.url)) {
    statusEl.className = 'status warn';
    statusEl.textContent = 'Відкрийте сторінку distrokid.com/new/, щоб почати.';
    return;
  }
  const res = await sendToContent({ type: 'getStatus' }, { quiet: true });
  if (res && res.ok) {
    const s = res.status;
    statusEl.className = 'status ok';
    statusEl.textContent = `Сторінка знайдена. Треків на сторінці: ${s.trackBlocksFound} (обрано в списку: ${s.howManySongsSelected ?? '?'}).`;
  } else {
    statusEl.className = 'status warn';
    statusEl.textContent = 'Сторінка DistroKid відкрита, але скрипт ще не відповів. Спробуйте перезавантажити вкладку.';
  }
}

function printLogs(res) {
  if (res && res.logs) res.logs.forEach(log);
}

// ---------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------
$('presetInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  clearLog();
  try {
    preset = JSON.parse(await file.text());
    await chrome.storage.local.set({ lastPreset: preset });
    renderPresetSummary();
    log(`Пресет "${file.name}" завантажено.`);
  } catch (err) {
    log('Не вдалося прочитати JSON: ' + err.message);
  }
});

$('btnExportPreset').addEventListener('click', async () => {
  clearLog();
  const res = await sendToContent({ type: 'exportPreset' });
  if (!res || !res.ok) return;
  preset = res.preset;
  await chrome.storage.local.set({ lastPreset: preset });
  renderPresetSummary();
  downloadJson(preset, 'distrokid-preset.json');
  log(`Форму збережено як пресет (треків: ${preset.tracks.length}) — файл distrokid-preset.json завантажено і пресет став поточним.`);
});

$('btnShowAttachPanel').addEventListener('click', async () => {
  clearLog();
  printLogs(await sendToContent({ type: 'showAttachPanel' }));
});

$('skipFilled').addEventListener('change', (e) => saveOpt('skipFilled', e.target.checked));

$('btnFillPreset').addEventListener('click', async () => {
  clearLog();
  if (!preset) {
    log('Спочатку завантажте файл пресету JSON.');
    return;
  }
  $('btnFillPreset').disabled = true;
  try {
    printLogs(await sendToContent({ type: 'fillPreset', preset, skipFilled: $('skipFilled').checked }));
  } finally {
    $('btnFillPreset').disabled = false;
  }
});

$('btnDiagnose').addEventListener('click', async () => {
  clearLog();
  printLogs(await sendToContent({ type: 'diagnose' }));
});

// ---------------------------------------------------------------------
// Init + keeping in sync
// ---------------------------------------------------------------------
(async function init() {
  const saved = await chrome.storage.local.get('lastPreset');
  if (saved.lastPreset) {
    preset = saved.lastPreset;
    renderPresetSummary();
  }
  $('skipFilled').checked = !!(await loadOpts()).skipFilled;
  refreshStatus();
})();

// The option can also be toggled in the in-page mp3 panel.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.opts) {
    $('skipFilled').checked = !!(changes.opts.newValue || {}).skipFilled;
  }
});

// The side panel stays open while the page changes (reload, adding songs, navigation),
// so keep the status line in sync.
let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshStatus, 400);
}
chrome.tabs.onActivated.addListener(scheduleRefresh);
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete' || info.url) scheduleRefresh();
});
window.addEventListener('focus', scheduleRefresh);
