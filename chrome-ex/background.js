/**
 * MV3 Service Worker — stateless proxy controller.
 * All state is persisted in chrome.storage.local; zero global variables, zero background timers.
 */

import { getState, setState } from './shared/storage.js';
import { buildPacScript } from './shared/pac.js';
import {
  detectPublicIp,
  getEffectiveApiUrl,
  getEffectiveAuthToken,
  getEffectiveProxyHost,
  isServerConfigured,
  whitelistRequest,
} from './shared/api.js';

const ACTIVE_ICON = {
  16: 'icons/icon-active-16.png',
  32: 'icons/icon-active-32.png',
};

const INACTIVE_ICON = {
  16: 'icons/icon-inactive-16.png',
  32: 'icons/icon-inactive-32.png',
};

/** Synchronizes browser proxy settings and toolbar action badge/icon with persisted state. */
async function applyProxyState(state) {
  const configured = isServerConfigured(state.serverConfig);
  const proxyHost = getEffectiveProxyHost(state.serverConfig);
  const shouldEnable = Boolean(state.isActive && configured && proxyHost);

  if (shouldEnable) {
    const pacScriptData = buildPacScript(state);
    await chrome.proxy.settings.set({
      value: {
        mode: 'pac_script',
        pacScript: { data: pacScriptData },
      },
      scope: 'regular',
    });
    await chrome.action.setIcon({ path: ACTIVE_ICON });
    await chrome.action.setBadgeText({ text: 'ON' });
    await chrome.action.setBadgeBackgroundColor({ color: '#1C1C1C' });
    await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
  } else {
    await chrome.proxy.settings.clear({ scope: 'regular' });
    await chrome.action.setIcon({ path: INACTIVE_ICON });
    await chrome.action.setBadgeText({ text: '' });
  }
}

/** Detects WAN IPv4, authorizes it via GOST Whitelist API, and enables Chrome PAC proxy. */
async function handleEnableProxy() {
  const state = await getState();
  if (!isServerConfigured(state.serverConfig)) {
    return { ok: false, error: 'UNCONFIGURED' };
  }

  const ip = await detectPublicIp();
  const apiUrl = getEffectiveApiUrl(state.serverConfig);
  const token = getEffectiveAuthToken(state.serverConfig);
  await whitelistRequest(apiUrl, 'POST', token, ip);

  const nextState = await setState({
    ...state,
    isActive: true,
    publicIp: ip,
  });
  await applyProxyState(nextState);
  return { ok: true, ip, state: nextState };
}

/** Clears Chrome proxy settings and persists inactive status. */
async function handleDisableProxy() {
  const state = await getState();
  const nextState = await setState({
    ...state,
    isActive: false,
  });
  await applyProxyState(nextState);
  return { ok: true, state: nextState };
}

/** Re-applies proxy settings & toolbar icon from current chrome.storage.local state. */
async function handleSyncProxy() {
  const state = await getState();
  if (state.isActive && !isServerConfigured(state.serverConfig)) {
    const clean = await setState({ ...state, isActive: false });
    await applyProxyState(clean);
    return { ok: true, state: clean };
  }
  await applyProxyState(state);
  return { ok: true, state };
}

/** Refreshes external WAN IPv4 on demand and stores it. */
async function handleRefreshIp() {
  const ip = await detectPublicIp();
  const state = await getState();
  const nextState = await setState({ ...state, publicIp: ip });
  return { ok: true, ip, state: nextState };
}

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await handleSyncProxy();
  } catch (err) {
    console.warn('[ProxyRouter] onInstalled sync failed:', err);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  try {
    await handleSyncProxy();
  } catch (err) {
    console.warn('[ProxyRouter] onStartup sync failed:', err);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case 'ENABLE_PROXY':
          sendResponse(await handleEnableProxy());
          break;
        case 'DISABLE_PROXY':
          sendResponse(await handleDisableProxy());
          break;
        case 'SYNC_PROXY':
          sendResponse(await handleSyncProxy());
          break;
        case 'REFRESH_IP':
          sendResponse(await handleRefreshIp());
          break;
        default:
          sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();
  return true;
});
