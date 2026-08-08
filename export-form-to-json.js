// Встав у DevTools Console (F12 → Console) на вкладці distrokid.com/new/ із заповненою формою.
// Натисни Enter — завантажиться файл distrokid-preset.json з даними з поточної форми
// (стори, лейбл, мова, жанри, і по кожному треку: назва, композитор, автор пісні,
// explicit/instrumental, виконавці (performers) і продюсери (producers) з розділу Apple Music).

(function () {
  function getTrackIndices() {
    return Array.from(document.querySelectorAll('[id^="js-track-table-"]'))
      .map((e) => parseInt(e.id.replace('js-track-table-', ''), 10))
      .filter((n) => !isNaN(n))
      .sort((a, b) => a - b);
  }
  function selText(sel) {
    return sel && sel.selectedIndex > 0 ? sel.options[sel.selectedIndex].text.trim() : '';
  }

  const out = {
    stores: Array.from(document.querySelectorAll('input.distroStore:checked')).map((e) => e.value),
    recordLabel: document.getElementById('recordLabelLabel')?.value || '',
    language: selText(document.getElementById('language')),
    genrePrimary: selText(document.getElementById('genrePrimary')),
    genreSecondary: selText(document.getElementById('genreSecondary')),
  };

  out.tracks = getTrackIndices().map((N) => {
    const root = document.getElementById(`js-track-table-${N}`);
    const t = {
      title: document.querySelector(`.uploadFileTitle.track_${N}`)?.value || '',
      composer: root.querySelector(`.composer_${N}`)?.value || '',
      songwriter: {
        first: root.querySelector(`input[name="songwriter_real_name_first${N}"]`)?.value || '',
        middle: root.querySelector(`input[name="songwriter_real_name_middle${N}"]`)?.value || '',
        last: root.querySelector(`input[name="songwriter_real_name_last${N}"]`)?.value || '',
        role: selText(root.querySelector('.songwriter_real_name_role')),
      },
      explicit: document.getElementById(`js-explicit-radio-button-${N}`)?.checked || false,
      instrumental: document.getElementById(`js-instrumental-radio-button-${N}`)?.checked || false,
    };

    const performers = [];
    for (let i = 1; i <= 10; i++) {
      const roleEl = document.getElementById(`track-${N}-performer-${i}-role`);
      const nameEl = document.getElementById(`track-${N}-performer-${i}-name`);
      if (!roleEl) break;
      if (selText(roleEl) || (nameEl && nameEl.value)) {
        performers.push({ role: selText(roleEl), name: nameEl?.value || '' });
      }
    }
    const producers = [];
    for (let i = 1; i <= 10; i++) {
      const roleEl = document.getElementById(`track-${N}-producer-${i}-role`);
      const nameEl = document.getElementById(`track-${N}-producer-${i}-name`);
      if (!roleEl) break;
      if (selText(roleEl) || (nameEl && nameEl.value)) {
        producers.push({ role: selText(roleEl), name: nameEl?.value || '' });
      }
    }
    t.performers = performers;
    t.producers = producers;
    return t;
  });

  const json = JSON.stringify(out, null, 2);
  console.log(json);

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'distrokid-preset.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
})();
