import { t } from '../shared/i18n.js';
import { mountIcons } from '../shared/icons.js';
import {
  getEffectiveProxyPort,
  getEffectiveProxyProtocol,
  isServerConfigured,
} from '../shared/api.js';
import { getState, STORAGE_KEY } from '../shared/storage.js';
import { renderStatusBadge, sendBgCommand } from '../shared/ui.js';
import { createSitesView } from './views/sites.js';
import { createWhitelistView } from './views/whitelist.js';
import { createSettingsView } from './views/settings.js';

const ROUTES = ['sites', 'whitelist', 'settings'];

const els = {
  appName: document.getElementById('sidebar-app-name'),
  statusBadge: document.getElementById('sidebar-status-badge'),
  powerBtn: document.getElementById('sidebar-power-btn'),
  powerLabel: document.getElementById('sidebar-power-label'),
  ipK: document.getElementById('sidebar-ip-k'),
  ipV: document.getElementById('sidebar-ip-v'),
  nodeK: document.getElementById('sidebar-node-k'),
  nodeV: document.getElementById('sidebar-node-v'),
  sidebarError: document.getElementById('sidebar-error'),
  navLinks: Array.from(document.querySelectorAll('#main-nav .nav-link')),
  navLabelSites: document.getElementById('nav-label-sites'),
  navLabelWhitelist: document.getElementById('nav-label-whitelist'),
  navLabelSettings: document.getElementById('nav-label-settings'),
  sections: {
    sites: document.getElementById('view-sites'),
    whitelist: document.getElementById('view-whitelist'),
    settings: document.getElementById('view-settings'),
  },
};

const views = {
  sites: createSitesView(els.sections.sites),
  whitelist: createWhitelistView(els.sections.whitelist),
  settings: createSettingsView(els.sections.settings),
};

let currentState = null;
let currentRoute = 'sites';
let isPowerBusy = false;
let sidebarErrorText = '';

function parseRoute() {
  const hash = window.location.hash.replace(/^#/, '').trim().toLowerCase();
  return ROUTES.includes(hash) ? hash : 'sites';
}

function renderSidebar(state) {
  const lang = state.language;
  document.documentElement.lang = lang;

  els.appName.textContent = t(lang, 'app.name');
  renderStatusBadge(els.statusBadge, state, lang);

  els.powerBtn.disabled = isPowerBusy;
  els.powerBtn.classList.toggle('is-active', state.isActive);
  if (isPowerBusy) {
    els.powerLabel.textContent = t(
      lang,
      state.isActive ? 'status.disconnecting' : 'popup.btnConnecting'
    );
  } else {
    els.powerLabel.textContent = t(
      lang,
      state.isActive ? 'popup.btnDisconnect' : 'popup.btnConnect'
    );
  }

  els.ipK.textContent = t(lang, 'popup.statIp');
  els.ipV.textContent = state.publicIp || '—';
  els.nodeK.textContent = t(lang, 'popup.statUpstream');

  if (isServerConfigured(state.serverConfig)) {
    const proto = getEffectiveProxyProtocol(state.serverConfig).toUpperCase();
    const port = getEffectiveProxyPort(state.serverConfig);
    els.nodeV.textContent = `${proto} :${port}`;
  } else {
    els.nodeV.textContent = '—';
  }

  els.navLabelSites.textContent = t(lang, 'nav.sites');
  els.navLabelWhitelist.textContent = t(lang, 'nav.whitelist');
  els.navLabelSettings.textContent = t(lang, 'nav.settings');

  if (sidebarErrorText) {
    els.sidebarError.hidden = false;
    els.sidebarError.textContent = sidebarErrorText;
  } else {
    els.sidebarError.hidden = true;
    els.sidebarError.textContent = '';
  }
}

function applyRoute(route, { triggerActivate = false } = {}) {
  currentRoute = route;
  for (const link of els.navLinks) {
    const active = link.dataset.route === route;
    if (active) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  }

  for (const key of ROUTES) {
    els.sections[key].hidden = key !== route;
  }

  if (currentState) {
    if (triggerActivate) {
      views[route].activate(currentState);
    } else {
      views[route].update(currentState);
    }
  }
}

function renderAll(state, { activateRoute = false } = {}) {
  currentState = state;
  renderSidebar(state);
  for (const key of ROUTES) {
    if (activateRoute && key === currentRoute) {
      views[key].activate(state);
    } else {
      views[key].update(state);
    }
  }
}

async function handlePowerToggle() {
  if (!currentState || isPowerBusy) return;
  sidebarErrorText = '';
  isPowerBusy = true;
  renderSidebar(currentState);

  try {
    const cmd = currentState.isActive ? 'DISABLE_PROXY' : 'ENABLE_PROXY';
    const res = await sendBgCommand(cmd);
    renderAll(res.state);
  } catch (err) {
    if (err.code === 'UNCONFIGURED') {
      sidebarErrorText = t(currentState.language, 'popup.unconfiguredHint');
      window.location.hash = '#settings';
    } else {
      sidebarErrorText = err.message;
    }
    const fresh = await getState();
    renderAll(fresh);
  } finally {
    isPowerBusy = false;
    if (currentState) renderSidebar(currentState);
  }
}

async function init() {
  mountIcons(document);

  currentRoute = parseRoute();
  applyRoute(currentRoute, { triggerActivate: false });

  window.addEventListener('hashchange', () => {
    const next = parseRoute();
    if (next !== currentRoute) {
      applyRoute(next, { triggerActivate: true });
    }
  });

  els.powerBtn.addEventListener('click', handlePowerToggle);

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    const nextState = await getState();
    renderAll(nextState, { activateRoute: false });
  });

  const initialState = await getState();
  renderAll(initialState, { activateRoute: true });
}

init();
