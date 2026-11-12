/**
 * Server configuration helpers, WAN IPv4 detector, Whitelist API client,
 * and on-demand service reachability check.
 */

const IP_PROVIDERS = [
  'https://api4.ipify.org',
  'https://ipv4.icanhazip.com',
  'https://v4.ident.me',
];

const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;

/** Validates whether a string is a properly bounded IPv4 address. */
export function isValidIpv4(ip) {
  if (typeof ip !== 'string') return false;
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false;
    const num = Number(part);
    return num >= 0 && num <= 255 && String(num) === part;
  });
}

/** Normalizes the Whitelist API base URL. */
export function getEffectiveApiUrl(serverConfig) {
  let url = (serverConfig?.apiUrl || '').trim();
  if (!url || url.includes('your-server-ip')) return '';
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `http://${url}`;
  }
  return url
    .replace(/\/api\/whitelist\/?$/i, '')
    .replace(/\/api\/?$/i, '')
    .replace(/\/+$/, '');
}

/** Extracts clean Bearer token without redundant prefix. */
export function getEffectiveAuthToken(serverConfig) {
  return (serverConfig?.authToken || '').trim().replace(/^Bearer\s+/i, '').trim();
}

/** Extracts upstream proxy hostname from serverConfig.apiUrl (or explicit proxyHost). */
export function getEffectiveProxyHost(serverConfig) {
  if (serverConfig?.proxyHost && !serverConfig.proxyHost.includes('your-server-ip')) {
    const clean = String(serverConfig.proxyHost).trim();
    if (clean) return clean;
  }
  try {
    const raw = (serverConfig?.apiUrl || '').trim();
    if (!raw) return '';
    const withScheme = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `http://${raw}`;
    const host = new URL(withScheme).hostname;
    if (host && !host.includes('your-server-ip')) {
      return host;
    }
  } catch {
    return '';
  }
  return '';
}

/** Returns default port for supported Chrome extension protocols ('http' | 'socks5'). */
export function getDefaultPortForProtocol(protocol) {
  return protocol === 'socks5' ? 1080 : 3128;
}

/** Normalizes upstream protocol to 'http' or 'socks5' (unsupported 'https' falls back to 'socks5'). */
export function getEffectiveProxyProtocol(serverConfig) {
  const proto = String(serverConfig?.proxyProtocol || 'socks5').toLowerCase();
  if (proto === 'http') return 'http';
  return 'socks5';
}

/** Resolves effective upstream port within 1..65535. */
export function getEffectiveProxyPort(serverConfig) {
  const port = Number(serverConfig?.proxyPort);
  if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
  return getDefaultPortForProtocol(getEffectiveProxyProtocol(serverConfig));
}

/** Returns true when API URL, auth token, and proxy host are configured. */
export function isServerConfigured(serverConfig) {
  return Boolean(
    getEffectiveApiUrl(serverConfig) &&
    getEffectiveAuthToken(serverConfig) &&
    getEffectiveProxyHost(serverConfig)
  );
}

/** Queries public IPv4 providers sequentially with a strict per-request timeout. */
export async function detectPublicIp() {
  for (const url of IP_PROVIDERS) {
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const text = (await res.text()).trim();
      if (IPV4_REGEX.test(text) && isValidIpv4(text)) {
        return text;
      }
    } catch {
      // Try next redundant IPv4 provider
    }
  }
  throw new Error('Could not detect public IPv4');
}

/** Sends an authenticated request to the GOST Whitelist API. */
export async function whitelistRequest(apiUrl, method = 'GET', token = '', ip = null) {
  const base = getEffectiveApiUrl({ apiUrl });
  const cleanToken = getEffectiveAuthToken({ authToken: token });
  if (!base || !cleanToken) {
    throw new Error('Server API URL or auth token is not configured');
  }

  const upperMethod = method.toUpperCase();
  const headers = {
    Authorization: `Bearer ${cleanToken}`,
  };
  const opts = {
    method: upperMethod,
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  };

  if (ip && upperMethod !== 'GET') {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify({ ip: ip.trim() });
  }

  const res = await fetch(`${base}/api/whitelist`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

/** Performs an on-demand HTTPS latency probe for a single service hostname. */
export async function checkServiceHealth(host) {
  const cleanHost = String(host || '')
    .trim()
    .replace(/^\*\./, '')
    .replace(/^\./, '');
  if (!cleanHost) {
    return { ok: false, latencyMs: 0, error: 'Empty host' };
  }

  const url = `https://${cleanHost}/`;
  const started = performance.now();
  try {
    await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    return {
      ok: true,
      latencyMs: Math.max(1, Math.round(performance.now() - started)),
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: 0,
      error: err?.name === 'TimeoutError' ? 'Timeout' : (err?.message || 'Unreachable'),
    };
  }
}
