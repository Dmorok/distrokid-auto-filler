// content.js — runs on distrokid.com/new/* (shared.js is loaded right before it).
// Fills the DistroKid upload form. Messages from the side panel:
//   {type:'ping'} {type:'getStatus'} {type:'showAttachPanel'} {type:'diagnose'}
//   {type:'fillPreset', preset:{...}, skipFilled:bool} {type:'exportPreset'}
// Song titles + audio files are handled by the in-page "🎵 Прикріпити mp3" panel.

(function () {
  'use strict';
  if (window.__dkFillerInjected) return; // avoid double-registering if injected twice
  window.__dkFillerInjected = true;

  const { AUDIO_EXT_RE, naturalCompare, cleanTitle, DEFAULT_OPTS } = self.DKShared;

  // ---------------------------------------------------------------------
  // All DistroKid selectors live here. When DistroKid changes its markup,
  // run "Діагностика" in the side panel and fix the broken entries below.
  // ---------------------------------------------------------------------
  const SEL = {
    uploadTable: '#uploadTable',
    trackTables: '[id^="js-track-table-"]',
    howManySongs: '#howManySongsOnThisAlbum',
    store: 'input.distroStore',
    recordLabel: '#recordLabelLabel',
    language: '#language',
    genrePrimary: '#genrePrimary',
    genreSecondary: '#genreSecondary',
    mandatory: 'input.areyousure[type="checkbox"]',
    extras: 'input[type="checkbox"][name="extras"]',
    requirementsSong: '.requirements-song', // Apple Music "Additional requirements", one per track (by position)
    performerSection: '.requirements-performer-section',
    producerSection: '.requirements-producer-section',
  };

  // Per-track selectors. N = DistroKid track number. Entries marked "inside track table"
  // are queried within #js-track-table-N.
  const TRACK = {
    table: (N) => `#js-track-table-${N}`,
    title: (N) => `.uploadFileTitle.track_${N}`,
    audio: (N) => `#js-track-upload-${N}`,
    noFeat: (N) => `#js-no-feat-${N}`,
    addFeat: (N) => `#js-add-feat-${N}`,
    versionNo: (N) => `#track-${N}-version-no`,
    versionRadioEdit: (N) => `#track-${N}-version-radio-edit`,
    cover: (N) => `#coversong_radio_button_${N}`,
    notCover: (N) => `#not_coversong_radio_button_${N}`,
    originalArtist: (N) => `.originalArtist_${N}`, // inside track table
    originalSongTitle: (N) => `.originalSongTitle_${N}`, // inside track table
    originalSongwriters: (N) => `.originalSongwriters_${N}`, // inside track table
    songwriterFirst: (N) => `input[name="songwriter_real_name_first${N}"]`, // inside track table
    songwriterMiddle: (N) => `input[name="songwriter_real_name_middle${N}"]`, // inside track table
    songwriterLast: (N) => `input[name="songwriter_real_name_last${N}"]`, // inside track table
    songwriterRole: () => '.songwriter_real_name_role', // inside track table
    composer: (N) => `.composer_${N}`, // inside track table
    explicit: (N) => `#js-explicit-radio-button-${N}`,
    notExplicit: (N) => `#js-not-explicit-radio-button-${N}`,
    cleaned: (N) => `#js-cleaned-radio-button-${N}`,
    notCleaned: (N) => `#js-not-cleaned-radio-button-${N}`,
    instrumental: (N) => `#js-instrumental-radio-button-${N}`,
    notInstrumental: (N) => `#js-not-instrumental-radio-button-${N}`,
    aiGate: () => '.distroAiGate', // inside track table, 2 radios: [No, Yes]
    dolby: () => 'input[name^="dolby_"]', // inside track table, 2 radios: [No, Yes]
    creditRole: (N, kind, i) => `#track-${N}-${kind}-${i}-role`,
    creditName: (N, kind, i) => `#track-${N}-${kind}-${i}-name`,
  };

  const $1 = (sel, root = document) => root.querySelector(sel);
  const $all = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------------------------------------------------------------------
  // "Don't overwrite filled fields" mode — set at the start of every run.
  // ---------------------------------------------------------------------
  let skipFilled = false;
  let skippedCount = 0;

  function beginRun(skip) {
    skipFilled = !!skip;
    skippedCount = 0;
  }

  function reportSkipped(log) {
    if (skipFilled) log(`Режим "не перезаписувати": пропущено вже заповнених полів — ${skippedCount}.`);
  }

  function hasValue(el) {
    if (el.tagName === 'SELECT') return el.selectedIndex > 0 && el.value !== '';
    return String(el.value || '').trim() !== '';
  }

  function setNativeValue(el, value) {
    if (!el) return false;
    if (skipFilled && hasValue(el)) {
      skippedCount++;
      return true;
    }
    const proto =
      el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : el.tagName === 'SELECT'
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  // Checkboxes are only ever checked here (never unchecked). For radios in skip mode,
  // a group that already has an answer is left as is.
  function clickIfNotChecked(el) {
    if (!el) return false;
    if (el.checked) return true;
    if (skipFilled && el.type === 'radio' && el.name) {
      const answered = Array.from(document.getElementsByName(el.name)).some((r) => r.checked);
      if (answered) {
        skippedCount++;
        return true;
      }
    }
    el.click();
    return true;
  }

  function selectByText(select, text) {
    if (!select || !text) return false;
    const target = text.trim().toLowerCase();
    const opt = Array.from(select.options).find((o) => o.text.trim().toLowerCase() === target);
    if (!opt) return false;
    setNativeValue(select, opt.value);
    return true;
  }

  function selText(sel) {
    return sel && sel.selectedIndex > 0 ? sel.options[sel.selectedIndex].text.trim() : '';
  }

  // Polls until fn() returns something truthy (DistroKid renders some rows asynchronously).
  function waitFor(fn, timeout = 2000, interval = 50) {
    return new Promise((resolve) => {
      const start = Date.now();
      (function tick() {
        const v = fn();
        if (v) return resolve(v);
        if (Date.now() - start >= timeout) return resolve(null);
        setTimeout(tick, interval);
      })();
    });
  }

  function getTrackIndices() {
    return $all(SEL.trackTables)
      .map((e) => parseInt(e.id.replace('js-track-table-', ''), 10))
      .filter((n) => !isNaN(n))
      .sort((a, b) => a - b);
  }

  // ---------------------------------------------------------------------
  // Preset filling
  // ---------------------------------------------------------------------
  function fillStores(list, log) {
    if (!list) return;
    const all = $all(SEL.store);
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
      if (setNativeValue($1(SEL.recordLabel), preset.recordLabel)) log(`Лейбл: "${preset.recordLabel}"`);
      else log('Поле лейбла не знайдено.');
    }
    const selects = [
      ['language', SEL.language, 'Мова'],
      ['genrePrimary', SEL.genrePrimary, 'Основний жанр'],
      ['genreSecondary', SEL.genreSecondary, 'Другий жанр'],
    ];
    for (const [key, sel, label] of selects) {
      if (!preset[key]) continue;
      if (selectByText($1(sel), preset[key])) log(`${label}: ${preset[key]}`);
      else log(`${label}: "${preset[key]}" не знайдено у списку.`);
    }
  }

  // Finds an "add another …" link inside a section by its visible text and clicks it.
  function clickAddAnother(sectionEl, labelRegex) {
    if (!sectionEl) return false;
    const link = $all('a, button, div, span', sectionEl).find(
      (e) => e.children.length === 0 && labelRegex.test((e.textContent || '').trim())
    );
    if (!link) return false;
    link.click();
    return true;
  }

  // Performer / Producer credit rows (Apple Music "Additional requirements") for one track.
  async function fillCredits(songSection, N, kind, list, log) {
    if (!Array.isArray(list) || list.length === 0) return;
    const section = songSection
      ? $1(kind === 'performer' ? SEL.performerSection : SEL.producerSection, songSection)
      : null;
    const addLabel = kind === 'performer' ? /add another performer/i : /add another producer/i;

    for (let i = 1; i <= list.length; i++) {
      let roleEl = $1(TRACK.creditRole(N, kind, i));
      if (!roleEl) {
        if (!clickAddAnother(section, addLabel)) {
          log(`Трек ${N}: не вдалося додати рядок "${kind}" #${i} — заповни вручну в розділі Apple Music.`);
          break;
        }
        roleEl = await waitFor(() => $1(TRACK.creditRole(N, kind, i)));
        if (!roleEl) {
          log(`Трек ${N}: рядок "${kind}" #${i} не з'явився за 2 с — заповни вручну.`);
          break;
        }
      }
      const nameEl = $1(TRACK.creditName(N, kind, i));
      const entry = list[i - 1] || {};
      if (entry.role && !selectByText(roleEl, entry.role)) {
        log(`Трек ${N}: роль "${entry.role}" (${kind}) не знайдено у списку ролей.`);
      }
      if (entry.name) setNativeValue(nameEl, entry.name);
    }
    log(`Трек ${N}: ${kind === 'performer' ? 'виконавці' : 'продюсери'} — ${list.length}.`);
  }

  function setYesNo(value, yesSel, noSel) {
    if (value === true) clickIfNotChecked($1(yesSel));
    else if (value === false) clickIfNotChecked($1(noSel));
  }

  async function fillTrackLevel(preset, log) {
    const idxs = getTrackIndices();
    const overrides = Array.isArray(preset.tracks) ? preset.tracks : null;
    const songSections = $all(SEL.requirementsSong);
    const templatedTracks = []; // tracks beyond preset.tracks[] length — root/template fields only

    for (let i = 0; i < idxs.length; i++) {
      const N = idxs[i];
      const root = $1(TRACK.table(N));
      if (!root) continue;
      const override = overrides ? overrides[i] || null : null;
      if (overrides && !override) templatedTracks.push(N);
      const t = Object.assign({}, preset, override || {}); // per-track override wins

      // NOTE: song titles are intentionally never touched here, even if preset.tracks[i].title
      // is present (e.g. in an exported preset). Titles come only from the mp3 file names.

      setYesNo(t.featuredArtist, TRACK.addFeat(N), TRACK.noFeat(N));

      // version info (only "none"/"radioedit" have stable ids; anything else is left alone)
      if (t.versionInfo === 'none') clickIfNotChecked($1(TRACK.versionNo(N)));
      else if (t.versionInfo === 'radioedit') clickIfNotChecked($1(TRACK.versionRadioEdit(N)));

      if (t.isCoverSong) {
        clickIfNotChecked($1(TRACK.cover(N)));
        if (t.originalArtist) setNativeValue($1(TRACK.originalArtist(N), root), t.originalArtist);
        if (t.originalSongTitle) setNativeValue($1(TRACK.originalSongTitle(N), root), t.originalSongTitle);
        if (t.originalSongwriters) setNativeValue($1(TRACK.originalSongwriters(N), root), t.originalSongwriters);
      } else if (t.isCoverSong === false) {
        clickIfNotChecked($1(TRACK.notCover(N)));
      }

      if (t.songwriter) {
        if (t.songwriter.first) setNativeValue($1(TRACK.songwriterFirst(N), root), t.songwriter.first);
        if (t.songwriter.middle) setNativeValue($1(TRACK.songwriterMiddle(N), root), t.songwriter.middle);
        if (t.songwriter.last) setNativeValue($1(TRACK.songwriterLast(N), root), t.songwriter.last);
        if (t.songwriter.role) selectByText($1(TRACK.songwriterRole(N), root), t.songwriter.role);
      }

      if (t.composer) setNativeValue($1(TRACK.composer(N), root), t.composer);

      setYesNo(t.explicit, TRACK.explicit(N), TRACK.notExplicit(N));
      setYesNo(t.radioEditClean, TRACK.cleaned(N), TRACK.notCleaned(N));
      setYesNo(t.instrumental, TRACK.instrumental(N), TRACK.notInstrumental(N));

      const aiRadios = $all(TRACK.aiGate(N), root);
      if (aiRadios.length === 2 && typeof t.aiGenerated === 'boolean') {
        clickIfNotChecked(aiRadios[t.aiGenerated ? 1 : 0]);
      }
      const dolbyRadios = $all(TRACK.dolby(N), root);
      if (dolbyRadios.length === 2 && typeof t.dolbyAtmos === 'boolean') {
        clickIfNotChecked(dolbyRadios[t.dolbyAtmos ? 1 : 0]);
      }

      const songSection = songSections[i] || null;
      if (Array.isArray(t.performers)) await fillCredits(songSection, N, 'performer', t.performers, log);
      if (Array.isArray(t.producers)) await fillCredits(songSection, N, 'producer', t.producers, log);
    }
    log(`Дані пресету застосовано до ${idxs.length} трек(ів).`);
    if (templatedTracks.length) {
      log(
        `Трек(и) №${templatedTracks.join(', ')}: індивідуальних даних у preset.tracks нема (у пресеті лише ${overrides.length}) — застосовано загальний шаблон (кореневі поля пресету).`
      );
    }
  }

  function fillMandatoryCheckboxes(log) {
    const boxes = $all(SEL.mandatory);
    boxes.forEach((cb) => clickIfNotChecked(cb));
    log(`Обов'язкові чекбокси (внизу форми): відмічено ${boxes.length}.`);
  }

  // Paid "Extras" checkboxes (Leave a Legacy, Discovery Pack, Store Maximizer,
  // DistroVid, Loudness Normalization, Social Media Pack, etc.) — forced OFF
  // unconditionally on every run, no matter what a preset or the skip mode says.
  // Nothing in this extension can turn these on; hard safety guard against paid add-ons.
  function forceDisableExtras(log) {
    const boxes = $all(SEL.extras);
    let unchecked = 0;
    boxes.forEach((cb) => {
      if (cb.checked) {
        cb.click();
        unchecked++;
      }
    });
    log(`Платні "Extras": примусово вимкнено ${unchecked} з ${boxes.length} (завжди, незалежно від пресету).`);
  }

  async function applyPreset(p, log) {
    if (p.stores) fillStores(p.stores, log);
    fillAlbumLevel(p, log);
    await fillTrackLevel(p, log);
    if (p.checkMandatoryCheckboxes !== false) fillMandatoryCheckboxes(log);
    forceDisableExtras(log);
  }

  // ---------------------------------------------------------------------
  // Export current form as a preset (replaces pasting export-form-to-json.js into the console)
  // ---------------------------------------------------------------------
  function exportPreset() {
    const out = {
      stores: $all(SEL.store).filter((e) => e.checked).map((e) => e.value),
      recordLabel: $1(SEL.recordLabel)?.value || '',
      language: selText($1(SEL.language)),
      genrePrimary: selText($1(SEL.genrePrimary)),
      genreSecondary: selText($1(SEL.genreSecondary)),
    };
    const readCredits = (N, kind) => {
      const list = [];
      for (let i = 1; i <= 20; i++) {
        const roleEl = $1(TRACK.creditRole(N, kind, i));
        if (!roleEl) break;
        const nameEl = $1(TRACK.creditName(N, kind, i));
        if (selText(roleEl) || (nameEl && nameEl.value)) {
          list.push({ role: selText(roleEl), name: nameEl?.value || '' });
        }
      }
      return list;
    };
    const checked = (sel) => !!$1(sel)?.checked;
    out.tracks = getTrackIndices().map((N) => {
      const root = $1(TRACK.table(N));
      const ai = $all(TRACK.aiGate(N), root);
      const dolby = $all(TRACK.dolby(N), root);
      const t = {
        title: $1(TRACK.title(N))?.value || '', // informational only, ignored when filling
        composer: $1(TRACK.composer(N), root)?.value || '',
        songwriter: {
          first: $1(TRACK.songwriterFirst(N), root)?.value || '',
          middle: $1(TRACK.songwriterMiddle(N), root)?.value || '',
          last: $1(TRACK.songwriterLast(N), root)?.value || '',
          role: selText($1(TRACK.songwriterRole(N), root)),
        },
        explicit: checked(TRACK.explicit(N)),
        instrumental: checked(TRACK.instrumental(N)),
      };
      if (ai.length === 2 && (ai[0].checked || ai[1].checked)) t.aiGenerated = ai[1].checked;
      if (dolby.length === 2 && (dolby[0].checked || dolby[1].checked)) t.dolbyAtmos = dolby[1].checked;
      t.performers = readCredits(N, 'performer');
      t.producers = readCredits(N, 'producer');
      return t;
    });
    return out;
  }

  // ---------------------------------------------------------------------
  // Diagnostics: which selectors are (not) found on the current page
  // ---------------------------------------------------------------------
  function diagnose() {
    const lines = [];
    const idxs = getTrackIndices();
    lines.push(`Блоків треків: ${idxs.length}` + (idxs.length ? ` (№ ${idxs.join(', ')})` : ' — обери кількість пісень'));

    const album = [
      ['Форма завантаження', SEL.uploadTable],
      ['Кількість пісень', SEL.howManySongs],
      ['Лейбл', SEL.recordLabel],
      ['Мова', SEL.language],
      ['Основний жанр', SEL.genrePrimary],
      ['Другий жанр', SEL.genreSecondary],
    ];
    for (const [label, sel] of album) lines.push(`${$1(sel) ? '✓' : '✗'} ${label}  ${sel}`);
    const counted = [
      ['Стори', SEL.store, ''],
      ['Обов\'язкові чекбокси', SEL.mandatory, ' (з\'являються після вибору сторів)'],
      ['Платні Extras', SEL.extras, ''],
      ['Apple Music requirements', SEL.requirementsSong, ' (по одному на трек, якщо обрано Apple Music)'],
    ];
    for (const [label, sel, note] of counted) {
      const n = $all(sel).length;
      lines.push(`${n ? '✓' : '✗'} ${label}: ${n}${n ? '' : note}  ${sel}`);
    }

    if (idxs.length) {
      const checks = [
        ['Назва', 'title'], ['Аудіо-поле', 'audio'],
        ['Featured так/ні', 'addFeat', 'noFeat'], ['Version none', 'versionNo'],
        ['Кавер так/ні', 'cover', 'notCover'],
        ['Songwriter ім\'я/прізвище', 'songwriterFirst', 'songwriterLast', true],
        ['Songwriter роль', 'songwriterRole', null, true], ['Composer', 'composer', null, true],
        ['Explicit так/ні', 'explicit', 'notExplicit'], ['Clean так/ні', 'cleaned', 'notCleaned'],
        ['Instrumental так/ні', 'instrumental', 'notInstrumental'],
      ];
      lines.push('— По треках —');
      for (const [label, a, b, inRoot] of checks) {
        const bad = idxs.filter((N) => {
          const root = inRoot ? $1(TRACK.table(N)) || document : document;
          return !$1(TRACK[a](N), root) || (b && !$1(TRACK[b](N), root));
        });
        lines.push(bad.length ? `✗ ${label}: нема у треках ${bad.join(', ')}  ${TRACK[a](idxs[0])}` : `✓ ${label}`);
      }
      for (const [label, key] of [['AI-generated (2 радіо)', 'aiGate'], ['Dolby Atmos (2 радіо)', 'dolby']]) {
        const bad = idxs.filter((N) => $all(TRACK[key](N), $1(TRACK.table(N)) || document).length !== 2);
        lines.push(bad.length ? `✗ ${label}: не 2 радіо у треках ${bad.join(', ')}  ${TRACK[key]()}` : `✓ ${label}`);
      }
    }
    const bad = lines.filter((l) => l.startsWith('✗')).length;
    lines.push(bad ? `Проблем: ${bad}. Селектори — в SEL / TRACK на початку content.js.` : 'Усі поля на місці.');
    return lines;
  }

  function getStatus() {
    const howMany = $1(SEL.howManySongs);
    return {
      onNewPage: !!$1(SEL.uploadTable),
      trackBlocksFound: getTrackIndices().length,
      howManySongsSelected: howMany ? howMany.value : null,
    };
  }

  // ---------------------------------------------------------------------
  // In-page "attach real audio files" panel — the ONLY place where the mp3 folder is picked.
  //
  // Extension messaging only carries JSON-serializable data, so File objects picked in
  // the side panel can't be forwarded here, and the side panel can't open a file picker
  // in the page (needs a click inside the page). So the folder picker runs in THIS page,
  // and the resulting File objects are wired into DistroKid's own <input type="file">
  // via a DataTransfer — accepted exactly like a normal browse/drag-drop selection.
  // The same pick also fills song titles and (optionally) applies the saved preset.
  // ---------------------------------------------------------------------
  async function loadOpts() {
    const { opts } = await chrome.storage.local.get('opts');
    return Object.assign({}, DEFAULT_OPTS, opts || {});
  }

  async function saveOpt(key, value) {
    const opts = await loadOpts();
    opts[key] = value;
    await chrome.storage.local.set({ opts });
  }

  const PANEL_OPTS = [
    ['stripUuid', 'Прибрати UUID в кінці назви'],
    ['stripTrackNum', 'Прибрати номер треку (01 - …)'],
    ['stripUnderscore', 'Замінити _ і - на пробіли'],
    ['fillTitles', 'Заповнити назви треків з імен файлів'],
    ['applyPreset', 'Також застосувати пресет з бічної панелі'],
    ['skipFilled', 'Не перезаписувати заповнені поля'],
  ];

  function showAttachPanel(log) {
    let panel = document.getElementById('dk-filler-panel');
    if (panel) {
      panel.style.display = 'block';
      log('Панель "🎵 Прикріпити mp3" вже відкрита на сторінці.');
      return;
    }

    const style = document.createElement('style');
    style.textContent = `
      #dk-filler-panel { position: fixed; right: 16px; bottom: 16px; width: 320px; z-index: 999999;
        background: #fff; border: 1px solid #e2e2e6; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.18);
        font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size: 13px; color: #1c1c1e; }
      #dk-filler-panel .dkf-head { display:flex; align-items:center; justify-content:space-between;
        padding: 10px 12px; border-bottom: 1px solid #eee; font-weight: 600; }
      #dk-filler-panel .dkf-head span.dkf-close { cursor:pointer; color:#8a8a8e; font-weight:400; padding:2px 6px; }
      #dk-filler-panel .dkf-body { padding: 10px 12px; }
      #dk-filler-panel .dkf-row { display:flex; align-items:center; gap:6px; margin: 4px 0; font-size:12px; }
      #dk-filler-panel .dkf-row label { flex:1; cursor:pointer; }
      #dk-filler-panel button { width:100%; padding:7px 10px; border:none; border-radius:6px;
        background:#ff3d54; color:#fff; font-weight:600; font-size:13px; cursor:pointer; margin-top:6px; }
      #dk-filler-panel button:disabled { opacity:.5; cursor:default; }
      #dk-filler-panel button.dkf-secondary { background:#edeef1; color:#1c1c1e; }
      #dk-filler-panel .dkf-list { max-height:120px; overflow-y:auto; background:#fafafa; border:1px solid #eee;
        border-radius:6px; padding:6px 8px; margin-top:6px; font-size:11.5px; line-height:1.5; }
      #dk-filler-panel .dkf-list div { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      #dk-filler-panel .dkf-log { max-height:140px; overflow-y:auto; background:#111318; color:#d6f5d6;
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
        ${PANEL_OPTS.map(([key, label]) =>
          `<div class="dkf-row"><label for="dkf_${key}">${label}</label><input type="checkbox" id="dkf_${key}" /></div>`
        ).join('')}
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

    const listEl = panel.querySelector('#dkfList');
    const attachBtn = panel.querySelector('#dkfAttach');
    const logEl = panel.querySelector('#dkfLog');
    let pickedFiles = [];

    function panelLog(s) {
      logEl.style.display = 'block';
      logEl.textContent += s + '\n';
      logEl.scrollTop = logEl.scrollHeight;
    }

    // Checkbox states persist in chrome.storage and stay in sync with the side panel.
    function renderOpts(opts) {
      for (const [key] of PANEL_OPTS) panel.querySelector(`#dkf_${key}`).checked = !!opts[key];
    }
    loadOpts().then(renderOpts);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.opts) renderOpts(Object.assign({}, DEFAULT_OPTS, changes.opts.newValue || {}));
    });
    for (const [key] of PANEL_OPTS) {
      panel.querySelector(`#dkf_${key}`).addEventListener('change', async (e) => {
        await saveOpt(key, e.target.checked);
        if (key.startsWith('strip')) renderList();
      });
    }

    async function renderList() {
      listEl.replaceChildren();
      if (pickedFiles.length === 0) {
        listEl.style.display = 'none';
        attachBtn.disabled = true;
        return;
      }
      const opts = await loadOpts();
      for (let i = 0; i < pickedFiles.length; i++) {
        const row = document.createElement('div');
        row.textContent = `${i + 1}. ${cleanTitle(pickedFiles[i].name, opts)}`;
        row.title = pickedFiles[i].name;
        listEl.appendChild(row);
      }
      listEl.style.display = 'block';
      attachBtn.disabled = false;
    }

    panel.querySelector('.dkf-close').addEventListener('click', () => {
      panel.style.display = 'none';
    });

    panel.querySelector('#dkfPick').addEventListener('click', () => {
      hiddenInput.value = ''; // so picking the same folder again still fires "change"
      hiddenInput.click();
    });

    hiddenInput.addEventListener('change', () => {
      pickedFiles = Array.from(hiddenInput.files)
        .filter((f) => AUDIO_EXT_RE.test(f.name))
        .sort((a, b) => naturalCompare(a.name, b.name));
      renderList();
    });

    attachBtn.addEventListener('click', async () => {
      attachBtn.disabled = true;
      logEl.textContent = '';
      try {
        const opts = await loadOpts();
        beginRun(opts.skipFilled);
        const idxs = getTrackIndices();
        if (idxs.length === 0) {
          panelLog('Не знайдено жодного блоку треку. Спочатку встанови кількість пісень на сторінці.');
          return;
        }
        if (pickedFiles.length !== idxs.length) {
          panelLog(`Увага: файлів — ${pickedFiles.length}, треків на сторінці — ${idxs.length}. Прикріплюю по мінімуму.`);
        }
        const n = Math.min(pickedFiles.length, idxs.length);
        for (let i = 0; i < n; i++) {
          const N = idxs[i];
          const file = pickedFiles[i];
          if (opts.fillTitles) {
            const title = cleanTitle(file.name, opts);
            if (setNativeValue($1(TRACK.title(N)), title)) panelLog(`Трек ${N}: назва — "${title}"`);
            else panelLog(`Трек ${N}: поле назви не знайдено.`);
          }
          const audioInput = $1(TRACK.audio(N));
          if (!audioInput) {
            panelLog(`Трек ${N}: поле аудіофайлу не знайдено.`);
            continue;
          }
          if (skipFilled && audioInput.files && audioInput.files.length) {
            skippedCount++;
            panelLog(`Трек ${N}: аудіо вже прикріплене — пропущено.`);
            continue;
          }
          const dt = new DataTransfer();
          dt.items.add(file);
          audioInput.files = dt.files;
          audioInput.dispatchEvent(new Event('change', { bubbles: true }));
          panelLog(`Трек ${N}: прикріплено "${file.name}".`);
        }

        if (opts.applyPreset) {
          const { lastPreset } = await chrome.storage.local.get('lastPreset');
          if (lastPreset) {
            panelLog('— Пресет —');
            await applyPreset(lastPreset, panelLog);
          } else {
            panelLog('Пресет не завантажено в бічній панелі — пропущено.');
            forceDisableExtras(panelLog);
          }
        } else {
          forceDisableExtras(panelLog);
        }
        reportSkipped(panelLog);
        panelLog('Готово. Перевір кожен трек перед відправкою.');
      } catch (e) {
        panelLog('Помилка: ' + e.message);
      } finally {
        attachBtn.disabled = pickedFiles.length === 0;
      }
    });

    log('Панель "🎵 Прикріпити mp3" відкрита внизу справа на сторінці.');
  }

  // ---------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------
  async function handle(msg) {
    const logs = [];
    const log = (s) => logs.push(s);
    switch (msg.type) {
      case 'ping':
        return { ok: true };
      case 'getStatus':
        return { ok: true, status: getStatus() };
      case 'showAttachPanel':
        showAttachPanel(log);
        return { ok: true, logs };
      case 'diagnose':
        return { ok: true, logs: diagnose() };
      case 'exportPreset':
        return { ok: true, preset: exportPreset() };
      case 'fillPreset':
        beginRun(msg.skipFilled);
        await applyPreset(msg.preset || {}, log);
        reportSkipped(log);
        return { ok: true, logs };
      default:
        return { ok: false, logs: ['Невідома команда: ' + msg.type] };
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handle(msg)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e.message, logs: ['Помилка: ' + e.message] }));
    return true; // async response
  });
})();
