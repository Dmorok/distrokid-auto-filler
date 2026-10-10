'use strict';

// Side panel is available only on the DistroKid upload page (distrokid.com/new...).
// On every other tab the panel is disabled and the toolbar icon is greyed out.

const PANEL_PATH = 'sidepanel.html';

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

async function applyToTab(tabId, url) {
  const enabled = isUploadPage(url);
  try {
    if (enabled) {
      await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true });
      await chrome.action.enable(tabId);
    } else {
      await chrome.sidePanel.setOptions({ tabId, enabled: false });
      await chrome.action.disable(tabId);
    }
  } catch (e) {
    // Tab may have been closed in the meantime — nothing to do.
  }
}

async function init() {
  // Clicking the toolbar icon opens the side panel (instead of a popup).
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  // Off by default everywhere; turned on per tab below.
  await chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
  await chrome.action.disable().catch(() => {});
  // Tabs that were already open (url is visible only for distrokid.com thanks to host_permissions).
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) await applyToTab(t.id, t.url);
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === 'loading' || info.status === 'complete') {
    applyToTab(tabId, info.url || tab.url);
  }
});
