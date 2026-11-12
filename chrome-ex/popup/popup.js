import { t } from '../shared/i18n.js';
import { createIcon, mountIcons } from '../shared/icons.js';
import {
  getEffectiveProxyPort,
  getEffectiveProxyProtocol,
  isServerConfigured,
} from '../shared/api.js';
import {
  isHostInEnabledPresets,
  isHostProxied,
  normalizeDomain,
  normalizeRuleDomain,
} from '../shared/pac.js';
import { getState, STORAGE_KEY, syncProxy, updateState } from '../shared/storage.js';
import {
  copyWithFeedback,
  createEl,
  openOptionsRoute,
  renderStatusBadge,
  sendBgCommand,
} from '../shared/ui.js';

const els = {
  appTitle: document.getElementById('app-title'),
  statusBadge: document.getElementById('status-badge'),
  btnOpenFull: document.getElementById('btn-open-full'),
  btnPower: document.getElementById('btn-power'),
  powerLabel: document.getElementById('power-label'),
  errorBox: document.getElementById('error-box'),
  errorText: document.getElementById('error-text'),
  btnErrorSettings: document.getElementById('btn-error-settings'),
  modeGroup: document.getElementById('mode-group'),
  btnModeSplit: document.getElementById('btn-mode-split'),
  btnModeGlobal: document.getElementById('btn-mode-global'),
  tabCardTitle: document.getElementById('tab-card-title'),
  tabRouteBadge: document.getElementById('tab-route-badge'),
  tabHost: document.getElementById('tab-host'),
  tabActionSlot: document.getElementById('tab-action-slot'),
  statIpLabel: document.getElementById('stat-ip-label'),
  statIpVal: document.getElementById('stat-ip-val'),
  btnCopyIp: document.getElementById('btn-copy-ip'),
  tipCopyIp: document.getElementById('tip-copy-ip'),
  btnRefreshIp: document.getElementById('btn-refresh-ip'),
  btnStatRules: document.getElementById('btn-stat-rules'),
  statRulesLabel: document.getElementById('stat-rules-label'),
  statRulesVal: document.getElementById('stat-rules-val'),
  btnStatUpstream: document.getElementById('btn-stat-upstream'),
  statUpstreamLabel: document.getElementById('stat-upstream-label'),
  statUpstreamVal: document.getElementById('stat-upstream-val'),
};

let currentState = null;
let activeHostname = null;
let isBusy = false;
let isRefreshingIp = false;
let lastError = null; // { text: string, unconfigured: boolean } | null

function findMatchingCustomDomain(hostname, customDomains = []) {
  const normalized = normalizeDomain(hostname);
  if (!normalized) return null;
  const labels = normalized.split('.');
  for (let i = 0; i <= labels.length - 2; i += 1) {
    const suffix = labels.slice(i).join('.');
    const match = customDomains.find((d) => normalizeDomain(d) === suffix);
    if (match) return match;
  }
  return customDomains.find((d) => normalizeDomain(d) === normalized) || null;
}

async function detectActiveTabHostname() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return null;
    const parsed = new URL(tab.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function renderTabSection(state) {
  const lang = state.language;
  els.tabCardTitle.textContent = t(lang, 'popup.tabTitle');

  if (!activeHostname) {
    els.tabHost.textContent = t(lang, 'popup.tabUnsupported');
    els.tabHost.classList.add('muted');
    els.tabHost.removeAttribute('title');
    els.tabRouteBadge.hidden = true;
    els.tabActionSlot.replaceChildren();
    return;
  }

  els.tabHost.textContent = activeHostname;
  els.tabHost.classList.remove('muted');
  els.tabHost.title = activeHostname;

  const proxied = isHostProxied(activeHostname, state, { checkRulesOnly: false });
  els.tabRouteBadge.hidden = false;
  els.tabRouteBadge.classList.toggle('active', proxied);
  els.tabRouteBadge.textContent = t(lang, proxied ? 'popup.routeProxied' : 'popup.routeDirect');

  const matchedCustom = findMatchingCustomDomain(activeHostname, state.customDomains);
  const inPreset = isHostInEnabledPresets(activeHostname, state.enabledPresetIds);

  if (matchedCustom) {
    const removeBtn = createEl(
      'button',
      {
        type: 'button',
        className: 'btn-secondary btn-xs',
        onClick: () => handleToggleTabDomain(matchedCustom, true),
      },
      createIcon('x', 12),
      t(lang, 'popup.tabRemove')
    );
    els.tabActionSlot.replaceChildren(removeBtn);
    return;
  }

  if (inPreset) {
    const presetTag = createEl('span', {
      className: 'badge',
      text: t(lang, 'popup.tabInPreset'),
    });
    els.tabActionSlot.replaceChildren(presetTag);
    return;
  }

  const normalized = normalizeDomain(activeHostname);
  const addBtn = createEl(
    'button',
    {
      type: 'button',
      className: 'btn-secondary btn-xs',
      onClick: () => handleToggleTabDomain(normalized || activeHostname, false),
    },
    createIcon('plus', 12),
    t(lang, 'popup.tabAdd')
  );
  els.tabActionSlot.replaceChildren(addBtn);
}

function render(state) {
  currentState = state;
  const lang = state.language;
  document.documentElement.lang = lang;

  els.appTitle.textContent = t(lang, 'app.name');
  renderStatusBadge(els.statusBadge, state, lang);

  els.btnOpenFull.setAttribute('aria-label', t(lang, 'popup.openFull'));
  els.btnOpenFull.title = t(lang, 'popup.openFull');

  // Power CTA
  els.btnPower.disabled = isBusy;
  els.btnPower.classList.toggle('is-active', state.isActive);
  if (isBusy) {
    els.powerLabel.textContent = t(lang, state.isActive ? 'status.disconnecting' : 'popup.btnConnecting');
  } else {
    els.powerLabel.textContent = t(lang, state.isActive ? 'popup.btnDisconnect' : 'popup.btnConnect');
  }

  // Error / Unconfigured banner
  if (lastError) {
    els.errorBox.hidden = false;
    els.errorText.textContent = lastError.text;
    els.btnErrorSettings.hidden = !lastError.unconfigured;
    els.btnErrorSettings.textContent = t(lang, 'popup.openSettings');
  } else {
    els.errorBox.hidden = true;
  }

  // Mode segmented buttons
  els.modeGroup.setAttribute('aria-label', t(lang, 'settings.modeLabel'));
  els.btnModeSplit.textContent = t(lang, 'popup.modeSplit');
  els.btnModeGlobal.textContent = t(lang, 'popup.modeGlobal');
  els.btnModeSplit.setAttribute('aria-pressed', String(state.proxyMode !== 'global'));
  els.btnModeGlobal.setAttribute('aria-pressed', String(state.proxyMode === 'global'));

  renderTabSection(state);

  // Stats
  els.statIpLabel.textContent = t(lang, 'popup.statIp');
  els.statIpVal.textContent = state.publicIp || '—';
  els.btnCopyIp.disabled = !state.publicIp;
  els.btnCopyIp.setAttribute('aria-label', t(lang, 'popup.copyIp'));
  els.btnCopyIp.title = t(lang, 'popup.copyIp');

  els.btnRefreshIp.disabled = isRefreshingIp;
  els.btnRefreshIp.setAttribute('aria-label', t(lang, 'popup.refreshIp'));
  els.btnRefreshIp.title = t(lang, 'popup.refreshIp');
  const refreshSvg = els.btnRefreshIp.querySelector('svg');
  if (refreshSvg) refreshSvg.classList.toggle('spin', isRefreshingIp);

  els.statRulesLabel.textContent = t(lang, 'popup.statRules');
  els.statRulesVal.textContent = String(
    state.enabledPresetIds.length + state.customDomains.length
  );

  els.statUpstreamLabel.textContent = t(lang, 'popup.statUpstream');
  if (isServerConfigured(state.serverConfig)) {
    const proto = getEffectiveProxyProtocol(state.serverConfig).toUpperCase();
    const port = getEffectiveProxyPort(state.serverConfig);
    els.statUpstreamVal.textContent = `${proto} :${port}`;
  } else {
    els.statUpstreamVal.textContent = '—';
  }
}

async function handlePowerToggle() {
  if (!currentState || isBusy) return;
  lastError = null;
  isBusy = true;
  render(currentState);

  try {
    const cmd = currentState.isActive ? 'DISABLE_PROXY' : 'ENABLE_PROXY';
    const res = await sendBgCommand(cmd);
    render(res.state);
  } catch (err) {
    if (err.code === 'UNCONFIGURED') {
      lastError = {
        text: t(currentState.language, 'popup.unconfiguredHint'),
        unconfigured: true,
      };
    } else {
      lastError = {
        text: err.message,
        unconfigured: false,
      };
    }
    const fresh = await getState();
    render(fresh);
  } finally {
    isBusy = false;
    if (currentState) render(currentState);
  }
}

async function handleModeChange(mode) {
  if (!currentState || currentState.proxyMode === mode) return;
  const next = await updateState({ proxyMode: mode });
  render(next);
  await syncProxy().catch(() => {});
}

async function handleToggleTabDomain(domain, remove) {
  if (!currentState || !domain) return;
  const norm = remove ? normalizeDomain(domain) : normalizeRuleDomain(domain);
  if (!norm) return;

  const next = await updateState((prev) => {
    const filtered = prev.customDomains.filter((d) => normalizeDomain(d) !== norm);
    return {
      customDomains: remove ? filtered : [...filtered, norm],
    };
  });
  render(next);
  await syncProxy().catch(() => {});
}

async function handleRefreshIp() {
  if (isRefreshingIp || !currentState) return;
  isRefreshingIp = true;
  render(currentState);

  try {
    const res = await sendBgCommand('REFRESH_IP');
    lastError = null;
    render(res.state);
  } catch (err) {
    lastError = { text: err.message, unconfigured: false };
    render(currentState);
  } finally {
    isRefreshingIp = false;
    if (currentState) render(currentState);
  }
}

async function init() {
  mountIcons(document);

  els.btnOpenFull.addEventListener('click', () => openOptionsRoute());
  els.btnErrorSettings.addEventListener('click', () => openOptionsRoute('settings'));
  els.btnPower.addEventListener('click', handlePowerToggle);
  els.btnModeSplit.addEventListener('click', () => handleModeChange('split'));
  els.btnModeGlobal.addEventListener('click', () => handleModeChange('global'));
  els.btnRefreshIp.addEventListener('click', handleRefreshIp);
  els.btnCopyIp.addEventListener('click', () => {
    if (!currentState?.publicIp) return;
    copyWithFeedback(els.btnCopyIp, els.tipCopyIp, currentState.publicIp, {
      copiedText: t(currentState.language, 'popup.copied'),
      failedText: t(currentState.language, 'popup.copyFailed'),
    });
  });
  els.btnStatRules.addEventListener('click', () => openOptionsRoute('sites'));
  els.btnStatUpstream.addEventListener('click', () => openOptionsRoute('settings'));

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    const state = await getState();
    render(state);
  });

  const [state, host] = await Promise.all([getState(), detectActiveTabHostname()]);
  activeHostname = host;
  render(state);
}

init();
