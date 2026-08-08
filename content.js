// content.js — runs on distrokid.com/new/*
// Reads DOM structure of the DistroKid upload form and fills it based on
// messages sent from the popup: {type:'getStatus'}, {type:'fillTitles', titles:[...]},
// {type:'fillPreset', preset:{...}}

(function () {
  'use strict';
  if (window.__dkFillerInjected) return; // avoid double-registering if injected twice
  window.__dkFillerInjected = true;

  function setNativeValue(el, value) {
    if (!el) return false;
    const proto =
      el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : el.tagName === 'SELECT'
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) {
      desc.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  function clickIfNotChecked(el) {
    if (el && !el.checked) el.click();
    return !!el;
  }

  function selectByText(select, text) {
    if (!select || !text) return false;
    const target = text.trim().toLowerCase();
    const opt = Array.from(select.options).find(
      (o) => o.text.trim().toLowerCase() === target
    );
    if (opt) {
      setNativeValue(select, opt.value);
      return true;
    }
    return false;
  }

  function getTrackIndices() {
    return Array.from(document.querySelectorAll('[id^="js-track-table-"]'))
      .map((e) => parseInt(e.id.replace('js-track-table-', ''), 10))
      .filter((n) => !isNaN(n))
      .sort((a, b) => a - b);
  }

  function fillTitles(titles, log) {
    const idxs = getTrackIndices();
    if (idxs.length === 0) {
      log('Не знайдено жодного блоку треку на сторінці. Спочатку оберіть кількість пісень.');
      return;
    }
    if (titles.length !== idxs.length) {
      log(
        `Увага: mp3-файлів — ${titles.length}, треків на сторінці — ${idxs.length}. Заповнюю по мінімуму з цих двох чисел.`
      );
    }
    const n = Math.min(titles.length, idxs.length);
    for (let i = 0; i < n; i++) {
      const N = idxs[i];
      const input = document.querySelector(`.uploadFileTitle.track_${N}`);
      if (input) {
        setNativeValue(input, titles[i]);
        log(`Трек ${N}: назву встановлено — "${titles[i]}"`);
      } else {
        log(`Трек ${N}: поле назви не знайдено.`);
      }
    }
  }

  function fillStores(list, log) {
    if (!list) return;
    const all = document.querySelectorAll('input.distroStore');
    if (list === 'all' || (Array.isArray(list) && list.includes('all'))) {
      all.forEach((cb) => clickIfNotChecked(cb));
      log(`Стори: обрано всі (${all.length}).`);
      return;
    }
    if (!Array.isArray(list)) return;
    const wanted = new Set(list.map((s) => String(s).toLowerCase()));
    let n = 0;
    all.forEach((cb) => {
      if (wanted.has(cb.value.toLowerCase())) {
        clickIfNotChecked(cb);
        n++;
      }
    });
    log(`Стори: відмічено ${n} з ${list.length} запитаних.`);
  }

  function fillAlbumLevel(preset, log) {
    if (preset.recordLabel) {
      const el = document.getElementById('recordLabelLabel');
      if (setNativeValue(el, preset.recordLabel)) log(`Лейбл: "${preset.recordLabel}"`);
    }
    if (preset.language) {
      const el = document.getElementById('language');
      if (selectByText(el, preset.language)) log(`Мова: ${preset.language}`);
      else log(`Мову "${preset.language}" не знайдено у списку.`);
    }
    if (preset.genrePrimary) {
      const el = document.getElementById('genrePrimary');
      if (selectByText(el, preset.genrePrimary)) log(`Основний жанр: ${preset.genrePrimary}`);
      else log(`Жанр "${preset.genrePrimary}" не знайдено у списку.`);
    }
    if (preset.genreSecondary) {
      const el = document.getElementById('genreSecondary');
      if (selectByText(el, preset.genreSecondary)) log(`Другий жанр: ${preset.genreSecondary}`);
      else log(`Другий жанр "${preset.genreSecondary}" не знайдено у списку.`);
    }
  }

  // Finds a ".linklike"-style add-another link inside a section by its visible text
  // and clicks it. Returns true if a link was found and clicked.
  function clickAddAnother(sectionEl, labelRegex) {
    if (!sectionEl) return false;
    const candidates = Array.from(sectionEl.querySelectorAll('a, button, div, span')).filter(
      (e) => e.children.length === 0 && labelRegex.test((e.textContent || '').trim())
    );
    if (candidates.length === 0) return false;
    candidates[0].click();
    return true;
  }

  // Fills the "Performer" / "Producer" credit rows (Apple Music "Additional requirements"
  // section) for one track. `songSection` is the .requirements-song element for that track
  // (matched by position, since these rows live outside js-track-table-N).
  function fillCredits(songSection, N, kind, list, log) {
    if (!Array.isArray(list) || list.length === 0) return;
    const sectionClass = kind === 'performer' ? 'requirements-performer-section' : 'requirements-producer-section';
    const addLabel = kind === 'performer' ? /add another performer/i : /add another producer/i;
    const section = songSection ? songSection.querySelector(`.${sectionClass}`) : null;

    for (let i = 1; i <= list.length; i++) {
      let roleEl = document.getElementById(`track-${N}-${kind}-${i}-role`);
      let nameEl = document.getElementById(`track-${N}-${kind}-${i}-name`);
      if (!roleEl) {
        const added = clickAddAnother(section, addLabel);
        if (!added) {
          log(`Трек ${N}: не вдалося додати рядок "${kind}" #${i} — заповни вручну в розділі Apple Music.`);
          break;
        }
        roleEl = document.getElementById(`track-${N}-${kind}-${i}-role`);
        nameEl = document.getElementById(`track-${N}-${kind}-${i}-name`);
        if (!roleEl) {
          log(`Трек ${N}: рядок "${kind}" #${i} не з'явився — заповни вручну.`);
          break;
        }
      }
      const entry = list[i - 1] || {};
      if (entry.role && !selectByText(roleEl, entry.role)) {
        log(`Трек ${N}: роль "${entry.role}" (${kind}) не знайдено у списку ролей.`);
      }
      if (entry.name) setNativeValue(nameEl, entry.name);
    }
    log(`Трек ${N}: ${kind === 'performer' ? 'виконавці' : 'продюсери'} — ${list.length}.`);
  }

  function fillTrackLevel(preset, log) {
    const idxs = getTrackIndices();
    const overrides = Array.isArray(preset.tracks) ? preset.tracks : null;
    const songSections = document.querySelectorAll('.requirements-song');

    idxs.forEach((N, i) => {
      const root = document.getElementById(`js-track-table-${N}`);
      if (!root) return;
      const override = overrides ? overrides[i] || {} : {};
      const t = Object.assign({}, preset, override); // per-track override wins over flat/default fields
      const songSection = songSections[i] || null;

      // NOTE: song titles are intentionally never touched here, even if preset.tracks[i].title
      // is present (e.g. in an exported preset). Titles always come only from the mp3 filenames
      // via fillTitles() — a preset's "title" field is informational/matching only.

      // featured artist
      if (t.featuredArtist === false) {
        clickIfNotChecked(document.getElementById(`js-no-feat-${N}`));
      } else if (t.featuredArtist === true) {
        clickIfNotChecked(document.getElementById(`js-add-feat-${N}`));
      }

      // version info (only "none"/"radioedit" have stable ids; anything else is left alone)
      if (t.versionInfo === 'none') {
        clickIfNotChecked(document.getElementById(`track-${N}-version-no`));
      } else if (t.versionInfo === 'radioedit') {
        clickIfNotChecked(document.getElementById(`track-${N}-version-radio-edit`));
      }

      // cover song / original song
      if (t.isCoverSong) {
        clickIfNotChecked(document.getElementById(`coversong_radio_button_${N}`));
        const oa = root.querySelector(`.originalArtist_${N}`);
        const ot = root.querySelector(`.originalSongTitle_${N}`);
        const ow = root.querySelector(`.originalSongwriters_${N}`);
        if (t.originalArtist) setNativeValue(oa, t.originalArtist);
        if (t.originalSongTitle) setNativeValue(ot, t.originalSongTitle);
        if (t.originalSongwriters) setNativeValue(ow, t.originalSongwriters);
      } else if (t.isCoverSong === false) {
        clickIfNotChecked(document.getElementById(`not_coversong_radio_button_${N}`));
      }

      // songwriter real name
      if (t.songwriter) {
        const first = root.querySelector(`input[name="songwriter_real_name_first${N}"]`);
        const middle = root.querySelector(`input[name="songwriter_real_name_middle${N}"]`);
        const last = root.querySelector(`input[name="songwriter_real_name_last${N}"]`);
        if (t.songwriter.first) setNativeValue(first, t.songwriter.first);
        if (t.songwriter.middle) setNativeValue(middle, t.songwriter.middle);
        if (t.songwriter.last) setNativeValue(last, t.songwriter.last);
        const roleSel = root.querySelector('.songwriter_real_name_role');
        if (roleSel && t.songwriter.role) selectByText(roleSel, t.songwriter.role);
      }

      // composer credit line
      if (t.composer) {
        const comp = root.querySelector(`.composer_${N}`);
        setNativeValue(comp, t.composer);
      }

      // explicit lyrics
      if (t.explicit === true) {
        clickIfNotChecked(document.getElementById(`js-explicit-radio-button-${N}`));
      } else if (t.explicit === false) {
        clickIfNotChecked(document.getElementById(`js-not-explicit-radio-button-${N}`));
      }

      // "is this a radio edit / clean version" flag
      if (t.radioEditClean === true) {
        clickIfNotChecked(document.getElementById(`js-cleaned-radio-button-${N}`));
      } else if (t.radioEditClean === false) {
        clickIfNotChecked(document.getElementById(`js-not-cleaned-radio-button-${N}`));
      }

      // instrumental
      if (t.instrumental === true) {
        clickIfNotChecked(document.getElementById(`js-instrumental-radio-button-${N}`));
      } else if (t.instrumental === false) {
        clickIfNotChecked(document.getElementById(`js-not-instrumental-radio-button-${N}`));
      }

      // AI-generated gate (2 radios, order = [No, Yes])
      const aiRadios = root.querySelectorAll('.distroAiGate');
      if (aiRadios.length === 2 && typeof t.aiGenerated === 'boolean') {
        clickIfNotChecked(aiRadios[t.aiGenerated ? 1 : 0]);
      }

      // Dolby Atmos (2 radios, order = [No, Yes])
      const dolbyRadios = root.querySelectorAll('input[name^="dolby_"]');
      if (dolbyRadios.length === 2 && typeof t.dolbyAtmos === 'boolean') {
        clickIfNotChecked(dolbyRadios[t.dolbyAtmos ? 1 : 0]);
      }

      // Apple Music "Additional requirements": performer / producer credits
      if (Array.isArray(t.performers)) fillCredits(songSection, N, 'performer', t.performers, log);
      if (Array.isArray(t.producers)) fillCredits(songSection, N, 'producer', t.producers, log);
    });
    log(`Дані пресету застосовано до ${idxs.length} трек(ів).`);
  }

  function fillMandatoryCheckboxes(log) {
    const boxes = document.querySelectorAll('input.areyousure[type="checkbox"]');
    boxes.forEach((cb) => clickIfNotChecked(cb));
    log(`Обов'язкові чекбокси (внизу форми): відмічено ${boxes.length}.`);
  }

  // Paid "Extras" checkboxes (Leave a Legacy, Discovery Pack, Store Maximizer,
  // DistroVid, Loudness Normalization, Social Media Pack, etc.) — forced OFF
  // unconditionally on every run, no matter what a preset says. Nothing in this
  // extension can turn these on; this is a hard safety guard against accidental
  // paid add-ons.
  function forceDisableExtras(log) {
    const boxes = document.querySelectorAll('input[type="checkbox"][name="extras"]');
    let unchecked = 0;
    boxes.forEach((cb) => {
      if (cb.checked) {
        cb.click();
        unchecked++;
      }
    });
    log(`Платні "Extras": примусово вимкнено ${unchecked} з ${boxes.length} (завжди, незалежно від пресету).`);
  }

  function getStatus() {
    const idxs = getTrackIndices();
    const howMany = document.getElementById('howManySongsOnThisAlbum');
    return {
      onNewPage: !!document.getElementById('uploadTable'),
      trackBlocksFound: idxs.length,
      howManySongsSelected: howMany ? howMany.value : null,
    };
  }

  // ---------------------------------------------------------------------
  // In-page "attach real audio files" panel.
  //
  // Extension messaging (popup -> content script) only carries JSON-serializable
  // data, so real File objects picked in the popup can't be forwarded here.
  // To actually attach audio bytes to DistroKid's own file inputs, the folder
  // picker has to run inside THIS page (so the resulting File objects live in
  // the same document as the target <input type="file">), then we wire them in
  // via a DataTransfer — which DistroKid's own upload JS accepts exactly like a
  // normal browse/drag-drop selection.
  // ---------------------------------------------------------------------

  const UUID_SUFFIX_RE = /[\s._-]*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\s*$/i;
  const AUDIO_EXT_RE = /\.(mp3|wav|flac|m4a|aiff?|wma)$/i;

  function naturalCompare(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  }

  function panelCleanTitle(filename, opts) {
    let name = filename.replace(/\.[^.]+$/, '');
    if (opts.stripUuid) name = name.replace(UUID_SUFFIX_RE, '');
    if (opts.stripTrackNum) name = name.replace(/^\s*\(?\d{1,3}\)?[\s._-]+/, '');
    if (opts.stripUnderscore) name = name.replace(/[_]+/g, ' ').replace(/\s*-\s*/g, ' - ');
    return name.replace(/\s+/g, ' ').trim();
  }

  function showAttachPanel(log) {
    let panel = document.getElementById('dk-filler-panel');
    if (panel) {
      panel.style.display = 'block';
      log("Панель вже відкрита на сторінці.");
      return;
    }

    const style = document.createElement('style');
    style.textContent = `
      #dk-filler-panel { position: fixed; right: 16px; bottom: 16px; width: 300px; z-index: 999999;
        background: #fff; border: 1px solid #e2e2e6; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.18);
        font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size: 13px; color: #1c1c1e; }
      #dk-filler-panel .dkf-head { display:flex; align-items:center; justify-content:space-between;
        padding: 10px 12px; border-bottom: 1px solid #eee; font-weight: 600; }
      #dk-filler-panel .dkf-head span.dkf-close { cursor:pointer; color:#8a8a8e; font-weight:400; padding:2px 6px; }
      #dk-filler-panel .dkf-body { padding: 10px 12px; }
      #dk-filler-panel .dkf-row { display:flex; align-items:center; gap:6px; margin: 4px 0; font-size:12px; }
      #dk-filler-panel .dkf-row label { flex:1; }
      #dk-filler-panel button { width:100%; padding:7px 10px; border:none; border-radius:6px;
        background:#ff3d54; color:#fff; font-weight:600; font-size:13px; cursor:pointer; margin-top:6px; }
      #dk-filler-panel button.dkf-secondary { background:#edeef1; color:#1c1c1e; }
      #dk-filler-panel .dkf-list { max-height:90px; overflow-y:auto; background:#fafafa; border:1px solid #eee;
        border-radius:6px; padding:6px 8px; margin-top:6px; font-size:11.5px; line-height:1.5; }
      #dk-filler-panel .dkf-log { max-height:110px; overflow-y:auto; background:#111318; color:#d6f5d6;
        border-radius:6px; padding:8px; font-family: SFMono-Regular, Consolas, monospace; font-size:11px;
        line-height:1.5; margin-top:8px; white-space:pre-wrap; }
    `;
    document.head.appendChild(style);

    panel = document.createElement('div');
    panel.id = 'dk-filler-panel';
    panel.innerHTML = `
      <div class="dkf-head">🎵 Прикріпити mp3 <span class="dkf-close" title="Закрити">×</span></div>
      <div class="dkf-body">
        <button class="dkf-secondary" id="dkfPick">Обрати папку з mp3</button>
        <div class="dkf-row"><label>Прибрати UUID в кінці назви</label><input type="checkbox" id="dkfStripUuid" checked /></div>
        <div class="dkf-row"><label>Прибрати номер треку (01 - …)</label><input type="checkbox" id="dkfStripNum" checked /></div>
        <div class="dkf-row"><label>Замінити _ і - на пробіли</label><input type="checkbox" id="dkfStripUs" checked /></div>
        <div class="dkf-row"><label>Також заповнити назви треків</label><input type="checkbox" id="dkfFillTitles" checked /></div>
        <div id="dkfList" class="dkf-list" style="display:none;"></div>
        <button id="dkfAttach" disabled>Прикріпити файли до треків</button>
        <div id="dkfLog" class="dkf-log" style="display:none;"></div>
      </div>
    `;
    document.body.appendChild(panel);

    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'file';
    hiddenInput.webkitdirectory = true;
    hiddenInput.multiple = true;
    hiddenInput.style.display = 'none';
    document.body.appendChild(hiddenInput);

    let pickedFiles = [];

    function panelLog(s) {
      const el = panel.querySelector('#dkfLog');
      el.style.display = 'block';
      el.textContent += s + '\n';
      el.scrollTop = el.scrollHeight;
    }

    panel.querySelector('.dkf-close').addEventListener('click', () => {
      panel.style.display = 'none';
    });

    panel.querySelector('#dkfPick').addEventListener('click', () => hiddenInput.click());

    hiddenInput.addEventListener('change', () => {
      pickedFiles = Array.from(hiddenInput.files)
        .filter((f) => AUDIO_EXT_RE.test(f.name))
        .sort((a, b) => naturalCompare(a.name, b.name));
      const listEl = panel.querySelector('#dkfList');
      const attachBtn = panel.querySelector('#dkfAttach');
      if (pickedFiles.length === 0) {
        listEl.style.display = 'none';
        attachBtn.disabled = true;
        return;
      }
      listEl.style.display = 'block';
      listEl.innerHTML = pickedFiles.map((f, i) => `<div>${i + 1}. ${f.name}</div>`).join('');
      attachBtn.disabled = false;
    });

    panel.querySelector('#dkfAttach').addEventListener('click', () => {
      const idxs = getTrackIndices();
      if (idxs.length === 0) {
        panelLog('Не знайдено жодного блоку треку. Спочатку встанови кількість пісень на сторінці.');
        return;
      }
      if (pickedFiles.length !== idxs.length) {
        panelLog(`Увага: файлів — ${pickedFiles.length}, треків на сторінці — ${idxs.length}. Прикріплюю по мінімуму.`);
      }
      const opts = {
        stripUuid: panel.querySelector('#dkfStripUuid').checked,
        stripTrackNum: panel.querySelector('#dkfStripNum').checked,
        stripUnderscore: panel.querySelector('#dkfStripUs').checked,
      };
      const fillTitlesToo = panel.querySelector('#dkfFillTitles').checked;
      const n = Math.min(pickedFiles.length, idxs.length);
      for (let i = 0; i < n; i++) {
        const N = idxs[i];
        const file = pickedFiles[i];
        if (fillTitlesToo) {
          const title = panelCleanTitle(file.name, opts);
          const titleInput = document.querySelector(`.uploadFileTitle.track_${N}`);
          if (setNativeValue(titleInput, title)) panelLog(`Трек ${N}: назва — "${title}"`);
        }
        const audioInput = document.getElementById(`js-track-upload-${N}`);
        if (!audioInput) {
          panelLog(`Трек ${N}: поле аудіофайлу не знайдено.`);
          continue;
        }
        const dt = new DataTransfer();
        dt.items.add(file);
        audioInput.files = dt.files;
        audioInput.dispatchEvent(new Event('change', { bubbles: true }));
        panelLog(`Трек ${N}: прикріплено "${file.name}".`);
      }
      forceDisableExtras(panelLog);
      panelLog('Готово. Перевір кожен трек перед відправкою.');
    });

    log('Панель "🎵 Прикріпити mp3" відкрита внизу справа на сторінці.');
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const logs = [];
    const log = (s) => logs.push(s);
    try {
      if (msg.type === 'ping') {
        sendResponse({ ok: true });
        return true;
      }
      if (msg.type === 'getStatus') {
        sendResponse({ ok: true, status: getStatus() });
        return true;
      }
      if (msg.type === 'showAttachPanel') {
        showAttachPanel(log);
        sendResponse({ ok: true, logs });
        return true;
      }
      if (msg.type === 'fillTitles') {
        fillTitles(msg.titles || [], log);
        forceDisableExtras(log);
      } else if (msg.type === 'fillPreset') {
        const p = msg.preset || {};
        if (p.stores) fillStores(p.stores, log);
        fillAlbumLevel(p, log);
        fillTrackLevel(p, log);
        if (p.checkMandatoryCheckboxes !== false) fillMandatoryCheckboxes(log);
        // Hard safety guard: paid "Extras" (Leave a Legacy, Discovery Pack, Store
        // Maximizer, DistroVid, Loudness Normalization, Social Media Pack, ...) are
        // ALWAYS forced off, unconditionally — there is no preset field that can
        // enable them, this is intentional and not configurable.
        forceDisableExtras(log);
      }
      sendResponse({ ok: true, logs });
    } catch (e) {
      logs.push('Помилка: ' + e.message);
      sendResponse({ ok: false, error: e.message, logs });
    }
    return true;
  });
})();
