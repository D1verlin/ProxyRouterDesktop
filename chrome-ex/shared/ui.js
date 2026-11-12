/**
 * Shared DOM, badge, navigation, and accessible clipboard helpers for popup & options pages.
 * Zero innerHTML, zero external dependencies.
 */

import { t } from './i18n.js';
import { createIcon } from './icons.js';
import { isServerConfigured } from './api.js';

const copyTimers = new WeakMap();
let lastCopyAnnouncement = '';

function setButtonCopyIcon(button, iconName) {
  const host = button.querySelector('[data-icon]');
  if (host) {
    host.replaceChildren(createIcon(iconName, Number(host.dataset.size) || 13));
    return;
  }
  const svg = button.querySelector('svg');
  if (svg) {
    const size = Number(svg.getAttribute('width')) || 13;
    svg.replaceWith(createIcon(iconName, size));
  }
}

/**
 * Copies text to clipboard and updates an external role="status" tooltip element
 * without disabling the trigger button.
 */
export async function copyWithFeedback(button, tipEl, text, { copiedText, failedText }) {
  clearTimeout(copyTimers.get(button));
  delete button.dataset.copied;
  delete button.dataset.failed;

  let succeeded = false;
  try {
    await navigator.clipboard.writeText(text);
    succeeded = true;
  } catch {
    succeeded = false;
  }

  const baseLabel = succeeded ? copiedText : failedText;
  const announced = lastCopyAnnouncement === baseLabel ? `${baseLabel}\u00A0` : baseLabel;
  lastCopyAnnouncement = announced;

  if (tipEl) {
    tipEl.textContent = '';
    requestAnimationFrame(() => {
      tipEl.textContent = announced;
    });
  }
  if (succeeded) {
    setButtonCopyIcon(button, 'check');
  }
  button.dataset[succeeded ? 'copied' : 'failed'] = '';

  copyTimers.set(
    button,
    setTimeout(() => {
      delete button.dataset.copied;
      delete button.dataset.failed;
      setButtonCopyIcon(button, 'copy');
      if (tipEl) tipEl.textContent = '';
    }, 1800)
  );
  return succeeded;
}

/** Updates a static status pill badge element for current proxy & config state. */
export function renderStatusBadge(badgeEl, state, lang) {
  if (!badgeEl) return;
  const configured = isServerConfigured(state.serverConfig);
  badgeEl.classList.remove('active', 'warn');

  if (!configured) {
    badgeEl.classList.add('warn');
    badgeEl.textContent = t(lang, 'status.unconfigured');
    return;
  }
  if (state.isActive) {
    badgeEl.classList.add('active');
    badgeEl.textContent = t(lang, 'status.active');
    return;
  }
  badgeEl.textContent = t(lang, 'status.inactive');
}

/** Opens or focuses the full Options page, optionally targeting a hash route (#sites, #whitelist, #settings). */
export async function openOptionsRoute(hash = '') {
  const baseUrl = chrome.runtime.getURL('options/options.html');
  const targetUrl = hash ? `${baseUrl}#${hash}` : baseUrl;

  if (!hash && chrome.runtime.openOptionsPage) {
    try {
      await chrome.runtime.openOptionsPage();
      return;
    } catch {
      // Fall through to tab lookup
    }
  }

  const existing = await chrome.tabs.query({ url: `${baseUrl}*` });
  if (existing.length > 0 && existing[0].id != null) {
    await chrome.tabs.update(existing[0].id, { active: true, url: targetUrl });
    if (existing[0].windowId != null) {
      await chrome.windows.update(existing[0].windowId, { focused: true }).catch(() => {});
    }
    return;
  }
  await chrome.tabs.create({ url: targetUrl });
}

/** Sends an RPC command to background.js and normalizes errors. */
export async function sendBgCommand(type) {
  const res = await chrome.runtime.sendMessage({ type });
  if (!res || res.ok === false) {
    const err = new Error(res?.error || 'Background command failed');
    err.code = res?.error;
    throw err;
  }
  return res;
}

/** Minimal safe DOM element builder (avoids innerHTML to satisfy MV3 CSP & XSS hygiene). */
export function createEl(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'className') {
      node.className = v;
    } else if (k === 'text') {
      node.textContent = v;
    } else if (k === 'dataset' && typeof v === 'object') {
      Object.assign(node.dataset, v);
    } else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v === true) {
      node.setAttribute(k, '');
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}
