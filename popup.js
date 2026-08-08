'use strict';

const $ = (id) => document.getElementById(id);

let mp3Titles = []; // cleaned titles, in play order
let preset = null; // parsed preset JSON

const AUDIO_EXT = /\.(mp3|wav|flac|m4a|aiff?|wma)$/i;

function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

const UUID_SUFFIX_RE = /[\s._\-]*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\s*$/i;

function cleanTitle(filename) {
  let name = filename.replace(/\.[^.]+$/, ''); // strip extension
  if ($('stripUuid').checked) {
    name = name.replace(UUID_SUFFIX_RE, ''); // strip trailing "- <uuid>" (e.g. generated-audio filenames)
  }
  if ($('stripTrackNum').checked) {
    name = name.replace(/^\s*\(?\d{1,3}\)?[\s._\-]+/, '');
  }
  if ($('stripUnderscore').checked) {
    name = name.replace(/[_]+/g, ' ').replace(/\s*-\s*/g, ' - ');
  }
  return name.replace(/\s+/g, ' ').trim();
}

function renderFileList() {
  const el = $('fileList');
  if (mp3Titles.length === 0) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  el.innerHTML = mp3Titles
    .map((t, i) => `<div>${i + 1}. ${t}</div>`)
    .join('');
}

function renderPresetSummary() {
  const el = $('presetSummary');
  if (!preset) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  const lines = [];
  if (preset.stores) lines.push('stores: ' + (Array.isArray(preset.stores) ? preset.stores.join(', ') : preset.stores));
  if (preset.recordLabel) lines.push('recordLabel: ' + preset.recordLabel);
  if (preset.language) lines.push('language: ' + preset.language);
  if (preset.genrePrimary) lines.push('genrePrimary: ' + preset.genrePrimary);
  if (preset.genreSecondary) lines.push('genreSecondary: ' + preset.genreSecondary);
  if (preset.songwriter) lines.push('songwriter: ' + JSON.stringify(preset.songwriter));
  if (preset.composer) lines.push('composer: ' + preset.composer);
  if (typeof preset.explicit === 'boolean') lines.push('explicit: ' + preset.explicit);
  if (typeof preset.instrumental === 'boolean') lines.push('instrumental: ' + preset.instrumental);
  if (typeof preset.aiGenerated === 'boolean') lines.push('aiGenerated: ' + preset.aiGenerated);
  if (typeof preset.dolbyAtmos === 'boolean') lines.push('dolbyAtmos: ' + preset.dolbyAtmos);
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

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureContentScript(tabId) {
  // Try talking to an already-injected content script first.
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ping' });
    return true;
  } catch (e) {
    // Not injected yet (e.g. tab was open before the extension was installed/reloaded).
    // Inject it now on demand — this is what "scripting" permission is for.
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return true;
  } catch (e2) {
    return false;
  }
}

async function sendToContent(msg) {
  const tab = await getActiveTab();
  if (!tab || !tab.url || !tab.url.includes('distrokid.com/new')) {
    log('Ця сторінка не схожа на distrokid.com/new/. Відкрийте сторінку завантаження треку.');
    return null;
  }
  const ready = await ensureContentScript(tab.id);
  if (!ready) {
    log('Не вдалося підвантажити скрипт на цю вкладку. Перезавантажте вкладку DistroKid і спробуйте ще раз.');
    return null;
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch (e) {
    log('Не вдалося зв\'язатися зі сторінкою: ' + e.message);
    return null;
  }
}

async function refreshStatus() {
  const statusEl = $('pageStatus');
  const tab = await getActiveTab();
  if (!tab || !tab.url || !tab.url.includes('distrokid.com/new')) {
    statusEl.className = 'status warn';
    statusEl.textContent = 'Відкрийте сторінку distrokid.com/new/, щоб почати.';
    return;
  }
  const res = await sendToContent({ type: 'getStatus' }).catch(() => null);
  if (res && res.ok) {
    const s = res.status;
    statusEl.className = 'status ok';
    statusEl.textContent = `Сторінка знайдена. Треків на сторінці: ${s.trackBlocksFound} (обрано в списку: ${s.howManySongsSelected ?? '?'}).`;
  } else {
    statusEl.className = 'status warn';
    statusEl.textContent = 'Сторінка DistroKid відкрита, але скрипт ще не відповів. Спробуйте перезавантажити вкладку.';
  }
}

$('folderInput').addEventListener('change', (e) => {
  const files = Array.from(e.target.files).filter((f) => AUDIO_EXT.test(f.name));
  files.sort((a, b) => naturalCompare(a.name, b.name));
  mp3Titles = files.map((f) => cleanTitle(f.name));
  renderFileList();
});

['stripUuid', 'stripTrackNum', 'stripUnderscore'].forEach((id) => {
  $(id).addEventListener('change', () => {
    const input = $('folderInput');
    if (input.files.length) input.dispatchEvent(new Event('change'));
  });
});

$('presetInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    preset = JSON.parse(text);
    chrome.storage.local.set({ lastPreset: preset });
    renderPresetSummary();
  } catch (err) {
    alert('Не вдалося прочитати JSON: ' + err.message);
  }
});

$('btnFillTitles').addEventListener('click', async () => {
  clearLog();
  if (mp3Titles.length === 0) {
    log('Спочатку оберіть папку з mp3-файлами.');
    return;
  }
  const res = await sendToContent({ type: 'fillTitles', titles: mp3Titles });
  if (res && res.logs) res.logs.forEach(log);
});

$('btnShowAttachPanel').addEventListener('click', async () => {
  clearLog();
  const res = await sendToContent({ type: 'showAttachPanel' });
  if (res && res.logs) res.logs.forEach(log);
  if (res && res.ok) log('Панель відкрита на сторінці DistroKid — переключись на вкладку.');
});

$('btnFillPreset').addEventListener('click', async () => {
  clearLog();
  if (!preset) {
    log('Спочатку завантажте файл пресету JSON.');
    return;
  }
  const res = await sendToContent({ type: 'fillPreset', preset });
  if (res && res.logs) res.logs.forEach(log);
});

$('btnFillAll').addEventListener('click', async () => {
  clearLog();
  if (mp3Titles.length) {
    const res1 = await sendToContent({ type: 'fillTitles', titles: mp3Titles });
    if (res1 && res1.logs) res1.logs.forEach(log);
  } else {
    log('mp3-файли не обрані — назви треків пропущено.');
  }
  if (preset) {
    const res2 = await sendToContent({ type: 'fillPreset', preset });
    if (res2 && res2.logs) res2.logs.forEach(log);
  } else {
    log('Пресет не завантажено — дані пресету пропущено.');
  }
});

(async function init() {
  const saved = await chrome.storage.local.get('lastPreset');
  if (saved.lastPreset) {
    preset = saved.lastPreset;
    renderPresetSummary();
  }
  refreshStatus();
})();
