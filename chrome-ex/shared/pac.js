/**
 * PAC script generator and pure domain matching logic.
 * Used both for chrome.proxy.settings (pac_script) and for instant UI route previews.
 */

import { PRESET_SITES } from './presets.js';
import {
  getEffectiveApiUrl,
  getEffectiveProxyHost,
  getEffectiveProxyPort,
  getEffectiveProxyProtocol,
} from './api.js';

/** Normalizes any domain, wildcard, or URL input to a bare lowercase hostname. */
export function normalizeDomain(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let val = raw.trim().toLowerCase();
  if (!val) return '';
  val = val.replace(/^https?:\/\//, '');
  val = val.split('/')[0].split('?')[0].split('#')[0];
  // Strip optional port suffix when not IPv6 bracketed
  if (!val.startsWith('[')) {
    val = val.split(':')[0];
  }
  val = val.replace(/^\*\./, '').replace(/^\.+|\.+$/g, '');
  return val;
}

/** Normalizes and validates a user/preset routing rule domain (must contain a dot, no whitespace or consecutive dots). */
export function normalizeRuleDomain(raw) {
  const host = normalizeDomain(raw);
  if (!host || !host.includes('.') || /\s/.test(host) || host.includes('..')) {
    return '';
  }
  return host;
}

/** Collects deduplicated normalized domains from enabled presets and custom domains. */
export function collectRoutedDomains(enabledPresetIds = [], customDomains = []) {
  const enabledSet = new Set(enabledPresetIds);
  const result = new Set();

  for (const site of PRESET_SITES) {
    if (!enabledSet.has(site.id)) continue;
    const hosts = Array.isArray(site.hosts) && site.hosts.length > 0 ? site.hosts : [site.host];
    for (const rawHost of hosts) {
      const clean = normalizeRuleDomain(rawHost);
      if (clean) result.add(clean);
    }
  }

  for (const custom of customDomains) {
    const clean = normalizeRuleDomain(custom);
    if (clean) result.add(clean);
  }

  return Array.from(result);
}

/** Returns true for localhost, loopback, plain hostnames, .local, or RFC1918 subnets. */
export function isPrivateOrLoopbackHost(hostname) {
  const h = normalizeDomain(hostname);
  if (!h) return true;
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]') return true;
  if (h.endsWith('.local') || !h.includes('.')) return true;
  if (h.startsWith('192.168.') || h.startsWith('10.') || h.startsWith('127.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  return false;
}

/** Collects VPS hosts that must always stay DIRECT to avoid proxy/whitelist loops. */
export function getVpsBypassHosts(serverConfig) {
  const hosts = new Set();
  const proxyHost = normalizeDomain(getEffectiveProxyHost(serverConfig));
  if (proxyHost) hosts.add(proxyHost);

  const apiUrl = getEffectiveApiUrl(serverConfig);
  if (apiUrl) {
    try {
      const apiHost = normalizeDomain(new URL(apiUrl).hostname);
      if (apiHost) hosts.add(apiHost);
    } catch {
      // Ignore malformed URL
    }
  }
  return hosts;
}

/** Checks if hostname matches any domain in the routed Set (exact or subdomain). */
function matchesDomainSet(hostname, domainSet) {
  const parts = hostname.split('.');
  for (let i = 0; i < parts.length; i += 1) {
    const candidate = parts.slice(i).join('.');
    if (domainSet.has(candidate)) return true;
  }
  return false;
}

/**
 * Pure JS mirror of FindProxyForURL: returns whether a hostname routes through the proxy
 * given the current extension state (ignoring whether state.isActive is toggled on/off if
 * checkRulesOnly is true).
 */
export function isHostProxied(hostname, state, { checkRulesOnly = false } = {}) {
  if (!checkRulesOnly && !state?.isActive) return false;
  const host = normalizeDomain(hostname);
  if (!host || isPrivateOrLoopbackHost(host)) return false;

  const proxyHost = getEffectiveProxyHost(state?.serverConfig);
  if (!proxyHost) return false;

  const bypassHosts = getVpsBypassHosts(state?.serverConfig);
  if (bypassHosts.has(host)) return false;

  if (state?.proxyMode === 'global') {
    return true;
  }

  const routed = new Set(
    collectRoutedDomains(state?.enabledPresetIds, state?.customDomains)
  );
  return matchesDomainSet(host, routed);
}

/** Checks whether a hostname is specifically covered by an enabled preset site. */
export function isHostInEnabledPresets(hostname, enabledPresetIds = []) {
  const host = normalizeDomain(hostname);
  if (!host) return false;
  const routed = new Set(collectRoutedDomains(enabledPresetIds, []));
  return matchesDomainSet(host, routed);
}

/**
 * Generates an optimized PAC script for chrome.proxy.settings.
 * Uses an O(labels) hash lookup map instead of hundreds of sequential shExpMatch() calls.
 */
export function buildPacScript(state) {
  const serverConfig = state?.serverConfig || {};
  const proxyHost = getEffectiveProxyHost(serverConfig);
  const proxyPort = getEffectiveProxyPort(serverConfig);
  const protocol = getEffectiveProxyProtocol(serverConfig);

  if (!proxyHost) {
    return 'function FindProxyForURL(url, host) { return "DIRECT"; }';
  }

  const proxyDirective =
    protocol === 'socks5'
      ? `SOCKS5 ${proxyHost}:${proxyPort}; SOCKS ${proxyHost}:${proxyPort}`
      : `PROXY ${proxyHost}:${proxyPort}`;

  const bypassList = Array.from(getVpsBypassHosts(serverConfig));
  const bypassMap = Object.create(null);
  for (const h of bypassList) bypassMap[h] = 1;

  if (state?.proxyMode === 'global') {
    return `function FindProxyForURL(url, host) {
  host = (host || "").toLowerCase();
  if (!host || isPlainHostName(host) || host === "localhost" || host === "127.0.0.1" || host === "::1") return "DIRECT";
  if (host.endsWith(".local") || host.indexOf("192.168.") === 0 || host.indexOf("10.") === 0 || host.indexOf("127.") === 0) return "DIRECT";
  if (/^172\\.(1[6-9]|2\\d|3[0-1])\\./.test(host)) return "DIRECT";
  var bypass = ${JSON.stringify(bypassMap)};
  if (bypass[host]) return "DIRECT";
  return ${JSON.stringify(proxyDirective)};
}`;
  }

  const domains = collectRoutedDomains(state?.enabledPresetIds, state?.customDomains);
  const routedMap = Object.create(null);
  for (const d of domains) routedMap[d] = 1;

  return `function FindProxyForURL(url, host) {
  host = (host || "").toLowerCase();
  if (!host || isPlainHostName(host) || host === "localhost" || host === "127.0.0.1" || host === "::1") return "DIRECT";
  if (host.endsWith(".local") || host.indexOf("192.168.") === 0 || host.indexOf("10.") === 0 || host.indexOf("127.") === 0) return "DIRECT";
  if (/^172\\.(1[6-9]|2\\d|3[0-1])\\./.test(host)) return "DIRECT";
  var bypass = ${JSON.stringify(bypassMap)};
  if (bypass[host]) return "DIRECT";
  var routed = ${JSON.stringify(routedMap)};
  var idx = 0;
  while (true) {
    var candidate = idx === 0 ? host : host.slice(idx);
    if (routed[candidate]) return ${JSON.stringify(proxyDirective)};
    var dot = host.indexOf(".", idx);
    if (dot === -1) break;
    idx = dot + 1;
  }
  return "DIRECT";
}`;
}
