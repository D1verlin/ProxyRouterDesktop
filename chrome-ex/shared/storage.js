/**
 * Persistent state wrapper around chrome.storage.local.
 * Ensures zero in-memory stale state in MV3 service worker and UI pages.
 */

import { DEFAULT_ENABLED_PRESET_IDS } from './presets.js';

export const STORAGE_KEY = 'proxyRouterState';

export const DEFAULT_STATE = {
  isActive: false,
  proxyMode: 'split', // 'split' | 'global'
  language: 'ru',     // 'ru' | 'en'
  publicIp: null,
  serverConfig: {
    apiUrl: '',
    authToken: '',
    proxyProtocol: 'socks5', // 'http' | 'socks5'
    proxyPort: 1080,
  },
  enabledPresetIds: [...DEFAULT_ENABLED_PRESET_IDS],
  customDomains: [],
};

/** Merges persisted state with defaults safely. */
export function normalizeState(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const sc = src.serverConfig && typeof src.serverConfig === 'object' ? src.serverConfig : {};
  const rawProto = String(sc.proxyProtocol || 'socks5').toLowerCase();
  const proxyProtocol = rawProto === 'http' ? 'http' : 'socks5';
  const rawPort = Number(sc.proxyPort);
  const proxyPort =
    Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535
      ? rawPort
      : proxyProtocol === 'http'
        ? 3128
        : 1080;

  return {
    isActive: Boolean(src.isActive),
    proxyMode: src.proxyMode === 'global' ? 'global' : 'split',
    language: src.language === 'en' ? 'en' : 'ru',
    publicIp: typeof src.publicIp === 'string' && src.publicIp ? src.publicIp : null,
    serverConfig: {
      apiUrl: typeof sc.apiUrl === 'string' ? sc.apiUrl : '',
      authToken: typeof sc.authToken === 'string' ? sc.authToken : '',
      proxyProtocol,
      proxyPort,
    },
    enabledPresetIds: Array.isArray(src.enabledPresetIds)
      ? src.enabledPresetIds.filter((id) => typeof id === 'string')
      : [...DEFAULT_ENABLED_PRESET_IDS],
    customDomains: Array.isArray(src.customDomains)
      ? src.customDomains.filter((d) => typeof d === 'string' && d.trim())
      : [],
  };
}

/** Reads full extension state from chrome.storage.local. */
export async function getState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeState(stored?.[STORAGE_KEY]);
}

/** Persists a full state object to chrome.storage.local. */
export async function setState(nextState) {
  const normalized = normalizeState(nextState);
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
  return normalized;
}

/** Applies a functional or partial update to state and saves it. */
export async function updateState(updater) {
  const current = await getState();
  const patch = typeof updater === 'function' ? updater(current) : updater;
  return setState({ ...current, ...patch });
}

/** Notifies background service worker to synchronize chrome.proxy with stored state. */
export async function syncProxy() {
  return chrome.runtime.sendMessage({ type: 'SYNC_PROXY' });
}
