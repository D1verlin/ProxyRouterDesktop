/**
 * Profile export & import (pr:// share key and JSON), compatible with proxy-router-desktop.
 */

import {
  getDefaultPortForProtocol,
  getEffectiveApiUrl,
  getEffectiveAuthToken,
  getEffectiveProxyHost,
  getEffectiveProxyPort,
  getEffectiveProxyProtocol,
} from './api.js';

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/** Builds a portable profile payload matching proxy-router-desktop's schema. */
export function buildProfilePayload(serverConfig) {
  const proxyProtocol = getEffectiveProxyProtocol(serverConfig);
  const proxyPort = getEffectiveProxyPort(serverConfig);
  const apiUrl = getEffectiveApiUrl(serverConfig) || (serverConfig?.apiUrl || '').trim();
  const authToken = getEffectiveAuthToken(serverConfig);
  const proxyHost = getEffectiveProxyHost(serverConfig) || '127.0.0.1';

  return {
    app: 'ProxyRouter',
    version: '1.0.0',
    apiUrl,
    authToken,
    proxyHost,
    proxyPort,
    proxyProtocol,
    exportedAt: new Date().toISOString(),
  };
}

/** Encodes serverConfig into a compact pr:// share key. */
export function encodeProfileKey(serverConfig) {
  const payload = buildProfilePayload(serverConfig);
  return `pr://${utf8ToBase64(JSON.stringify(payload))}`;
}

/**
 * Parses either a pr:// share key or raw JSON profile string.
 * Automatically maps desktop-only 'https' proxy protocol to 'socks5' (:1080)
 * and sets `protocolDowngraded: true` when that happens.
 */
export function parseProfileInput(rawText, currentConfig = {}) {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) {
    throw new Error('Profile input is empty');
  }

  let jsonText = trimmed;
  if (trimmed.startsWith('pr://')) {
    jsonText = base64ToUtf8(trimmed.slice(5).trim());
  }

  const parsed = JSON.parse(jsonText);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid profile structure');
  }
  if (!parsed.apiUrl && !parsed.authToken) {
    throw new Error('Profile must contain apiUrl or authToken');
  }

  const rawProto = String(parsed.proxyProtocol || currentConfig.proxyProtocol || 'socks5').toLowerCase();
  const protocolDowngraded = rawProto === 'https';
  const proxyProtocol = rawProto === 'http' ? 'http' : 'socks5';

  let proxyPort = Number(parsed.proxyPort);
  if (protocolDowngraded || !Number.isInteger(proxyPort) || proxyPort <= 0 || proxyPort > 65535) {
    proxyPort = getDefaultPortForProtocol(proxyProtocol);
  }

  const apiUrl = getEffectiveApiUrl({ apiUrl: parsed.apiUrl || currentConfig.apiUrl || '' }) ||
    String(parsed.apiUrl || currentConfig.apiUrl || '').trim();
  const authToken = getEffectiveAuthToken({ authToken: parsed.authToken || currentConfig.authToken || '' });

  return {
    serverConfig: {
      apiUrl,
      authToken,
      proxyProtocol,
      proxyPort,
    },
    protocolDowngraded,
  };
}
