// shared.js — helpers used by the side panel, the content script and the background worker.
// Plain script (no modules) so it can be loaded via <script>, content_scripts and importScripts.
(function (root) {
  'use strict';
  if (root.DKShared) return;

  const AUDIO_EXT_RE = /\.(mp3|wav|flac|m4a|aiff?|wma)$/i;
  // trailing "- <uuid>" (e.g. generated-audio filenames)
  const UUID_SUFFIX_RE = /[\s._-]*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\s*$/i;

  function naturalCompare(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  }

  // opts: { stripUuid, stripTrackNum, stripUnderscore }
  function cleanTitle(filename, opts) {
    let name = filename.replace(/\.[^.]+$/, ''); // strip extension
    if (opts.stripUuid) name = name.replace(UUID_SUFFIX_RE, '');
    if (opts.stripTrackNum) name = name.replace(/^\s*\(?\d{1,3}\)?[\s._-]+/, '');
    if (opts.stripUnderscore) name = name.replace(/[_]+/g, ' ').replace(/\s*-\s*/g, ' - ');
    return name.replace(/\s+/g, ' ').trim();
  }

  function isUploadPage(url) {
    if (!url) return false;
    try {
      const u = new URL(url);
      return (u.hostname === 'distrokid.com' || u.hostname === 'www.distrokid.com') &&
        u.pathname.startsWith('/new');
    } catch (e) {
      return false;
    }
  }

  // Options shared between the side panel and the in-page mp3 panel (chrome.storage.local "opts").
  const DEFAULT_OPTS = {
    stripUuid: true,
    stripTrackNum: true,
    stripUnderscore: true,
    fillTitles: true,   // in-page panel: also fill song titles from file names
    applyPreset: true,  // in-page panel: also apply the saved preset after attaching
    skipFilled: false,  // do not overwrite fields that already have a value
  };

  root.DKShared = { AUDIO_EXT_RE, UUID_SUFFIX_RE, naturalCompare, cleanTitle, isUploadPage, DEFAULT_OPTS };
})(typeof self !== 'undefined' ? self : this);
