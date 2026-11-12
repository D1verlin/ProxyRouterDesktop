import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import {
  getDefaultPortForProtocol,
  getEffectiveApiUrl,
  getEffectiveAuthToken,
  getEffectiveProxyHost,
  getEffectiveProxyPort,
  getEffectiveProxyProtocol,
  isServerConfigured,
  isValidIpv4,
} from '../shared/api.js';
import { TRANSLATIONS, t } from '../shared/i18n.js';
import {
  buildPacScript,
  collectRoutedDomains,
  isHostInEnabledPresets,
  isHostProxied,
  normalizeDomain,
  normalizeRuleDomain,
} from '../shared/pac.js';
import { PRESET_SITES } from '../shared/presets.js';
import {
  buildProfilePayload,
  encodeProfileKey,
  parseProfileInput,
} from '../shared/profile.js';
import { DEFAULT_STATE, normalizeState } from '../shared/storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EX_ROOT = path.resolve(__dirname, '..');

function parsePngDimensions(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(buf.subarray(0, 8).equals(sig), 'Invalid PNG signature');
  const chunkType = buf.subarray(12, 16).toString('ascii');
  assert.equal(chunkType, 'IHDR', 'Expected IHDR chunk');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

function evalPac(script, url, host) {
  const context = {
    isPlainHostName: (h) => !h.includes('.'),
    dnsDomainIs: (h, d) => h === d || h.endsWith(d),
    shExpMatch: (str, pattern) => {
      const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      return new RegExp(`^${escaped}$`).test(str);
    },
    isInNet: (ip, net, mask) => {
      const toInt = (s) =>
        s.split('.').reduce((acc, octet) => ((acc << 8) | Number(octet)) >>> 0, 0);
      if (!isValidIpv4(ip) || !isValidIpv4(net) || !isValidIpv4(mask)) return false;
      return (toInt(ip) & toInt(mask)) === (toInt(net) & toInt(mask));
    },
    myIpAddress: () => '127.0.0.1',
    dnsResolve: (h) => (isValidIpv4(h) ? h : '93.184.216.34'),
  };
  vm.createContext(context);
  vm.runInContext(script, context);
  assert.equal(typeof context.FindProxyForURL, 'function');
  return context.FindProxyForURL(url, host);
}

async function listFilesRecursive(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

test('manifest.json is valid MV3 and all icon PNGs exist with exact dimensions', async () => {
  const raw = await fs.readFile(path.join(EX_ROOT, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(raw);

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['proxy', 'storage', 'tabs']);
  assert.deepEqual(manifest.host_permissions, ['http://*/*', 'https://*/*']);
  assert.equal(manifest.action.default_popup, 'popup/popup.html');
  assert.equal(manifest.options_ui.page, 'options/options.html');
  assert.equal(manifest.options_ui.open_in_tab, true);
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.background.type, 'module');

  const expectedIcons = [
    ['icons/icon-16.png', 16],
    ['icons/icon-32.png', 32],
    ['icons/icon-48.png', 48],
    ['icons/icon-128.png', 128],
    ['icons/icon-active-16.png', 16],
    ['icons/icon-active-32.png', 32],
    ['icons/icon-inactive-16.png', 16],
    ['icons/icon-inactive-32.png', 32],
  ];

  assert.equal(manifest.icons['16'], 'icons/icon-16.png');
  assert.equal(manifest.icons['32'], 'icons/icon-32.png');
  assert.equal(manifest.icons['48'], 'icons/icon-48.png');
  assert.equal(manifest.icons['128'], 'icons/icon-128.png');
  assert.equal(manifest.action.default_icon['16'], 'icons/icon-inactive-16.png');
  assert.equal(manifest.action.default_icon['32'], 'icons/icon-inactive-32.png');

  for (const [relPath, size] of expectedIcons) {
    const buf = await fs.readFile(path.join(EX_ROOT, relPath));
    const dims = parsePngDimensions(buf);
    assert.deepEqual(dims, { width: size, height: size }, `${relPath} mismatch`);
  }
});

test('HTML & CSS adhere to MV3 CSP and Dark Monolith constraints', async () => {
  const htmlFiles = [
    path.join(EX_ROOT, 'popup/popup.html'),
    path.join(EX_ROOT, 'options/options.html'),
  ];

  for (const file of htmlFiles) {
    const html = await fs.readFile(file, 'utf8');
    assert.match(html, /<meta\s+name="color-scheme"\s+content="dark">/);
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i, `Inline <script> found in ${file}`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `Inline event handler found in ${file}`);
    assert.doesNotMatch(html, /https?:\/\//i, `External asset/URL found in HTML ${file}`);
  }

  const cssFiles = [
    path.join(EX_ROOT, 'shared/styles/tokens.css'),
    path.join(EX_ROOT, 'popup/popup.css'),
    path.join(EX_ROOT, 'options/options.css'),
  ];

  for (const file of cssFiles) {
    const css = await fs.readFile(file, 'utf8');
    assert.doesNotMatch(
      css,
      /\bborder-(top|bottom|left|right)\s*:/i,
      `Single-sided border found in ${file}`
    );
    assert.doesNotMatch(css, /@keyframes\s+(ping|pulse)/i, `Disallowed pulse/ping keyframes in ${file}`);
  }

  // Verify zero emojis in any source file
  const allFiles = await listFilesRecursive(EX_ROOT);
  const emojiRegex = /[\u{1F300}-\u{1FAFF}]/u;
  for (const file of allFiles) {
    if (!/\.(js|mjs|html|css|json)$/.test(file)) continue;
    const text = await fs.readFile(file, 'utf8');
    assert.equal(emojiRegex.test(text), false, `Emoji character found in ${file}`);
  }
});

test('All i18n keys exist in RU & EN and all icon names exist in icons.js', async () => {
  const iconsSource = await fs.readFile(path.join(EX_ROOT, 'shared/icons.js'), 'utf8');
  const definedIcons = new Set(
    [...iconsSource.matchAll(/^\s{2}([a-zA-Z0-9_]+):\s*\[/gm)].map((m) => m[1])
  );

  const allFiles = await listFilesRecursive(EX_ROOT);
  const ruKeys = new Set(Object.keys(TRANSLATIONS.ru));
  const enKeys = new Set(Object.keys(TRANSLATIONS.en));
  assert.deepEqual([...ruKeys].sort(), [...enKeys].sort(), 'RU and EN keysets differ');

  for (const file of allFiles) {
    if (file.endsWith('.test.mjs')) continue;
    const content = await fs.readFile(file, 'utf8');

    if (file.endsWith('.js')) {
      for (const match of content.matchAll(/\bt\([^,]+,\s*'([^']+)'/g)) {
        const key = match[1];
        assert.ok(ruKeys.has(key), `Missing RU key "${key}" referenced in ${file}`);
        assert.ok(enKeys.has(key), `Missing EN key "${key}" referenced in ${file}`);
      }
      for (const match of content.matchAll(/createIcon\(\s*'([^']+)'/g)) {
        const icon = match[1];
        assert.ok(definedIcons.has(icon), `Missing icon "${icon}" in ${file}`);
      }
    }

    if (file.endsWith('.html')) {
      for (const match of content.matchAll(/data-icon="([^"]+)"/g)) {
        const icon = match[1];
        assert.ok(definedIcons.has(icon), `Missing data-icon "${icon}" in ${file}`);
      }
    }
  }
});

test('PAC generation & routing logic executes cleanly inside Chrome PAC VM', () => {
  const baseState = normalizeState({
    isActive: true,
    proxyMode: 'split',
    serverConfig: {
      apiUrl: 'https://198.51.100.42:8443/api/whitelist',
      authToken: 'Bearer secret123',
      proxyProtocol: 'socks5',
      proxyPort: 1080,
    },
    enabledPresetIds: ['chatgpt', 'claude_web', 'anthropic_api'],
    customDomains: ['https://app.cursor.com/login', '*.notion.so'],
  });

  const pac = buildPacScript(baseState);
  const expectedSocks = 'SOCKS5 198.51.100.42:1080; SOCKS 198.51.100.42:1080';

  // Enabled presets & subdomains
  assert.equal(evalPac(pac, 'https://chatgpt.com/', 'chatgpt.com'), expectedSocks);
  assert.equal(evalPac(pac, 'https://ws.chatgpt.com/', 'ws.chatgpt.com'), expectedSocks);
  assert.equal(evalPac(pac, 'https://api.anthropic.com/v1/messages', 'api.anthropic.com'), expectedSocks);

  // Normalized custom domains & subdomains
  assert.equal(evalPac(pac, 'https://app.cursor.com/', 'app.cursor.com'), expectedSocks);
  assert.equal(evalPac(pac, 'https://www.notion.so/', 'www.notion.so'), expectedSocks);

  // Disabled preset & non-AI public host
  assert.equal(evalPac(pac, 'https://grok.com/', 'grok.com'), 'DIRECT');
  assert.equal(evalPac(pac, 'https://example.org/', 'example.org'), 'DIRECT');

  // Bypass local & RFC1918 & VPS host itself
  assert.equal(evalPac(pac, 'http://localhost:3000/', 'localhost'), 'DIRECT');
  assert.equal(evalPac(pac, 'http://192.168.1.1/', '192.168.1.1'), 'DIRECT');
  assert.equal(evalPac(pac, 'http://10.0.0.5/', '10.0.0.5'), 'DIRECT');
  assert.equal(evalPac(pac, 'http://172.16.4.2/', '172.16.4.2'), 'DIRECT');
  assert.equal(evalPac(pac, 'http://nas.local/', 'nas.local'), 'DIRECT');
  assert.equal(evalPac(pac, 'https://198.51.100.42:8443/', '198.51.100.42'), 'DIRECT');

  // Global mode with HTTP proxy on port 3128
  const globalHttpState = normalizeState({
    ...baseState,
    proxyMode: 'global',
    serverConfig: {
      ...baseState.serverConfig,
      proxyProtocol: 'http',
      proxyPort: 3128,
    },
  });
  const globalPac = buildPacScript(globalHttpState);
  assert.equal(evalPac(globalPac, 'https://example.org/', 'example.org'), 'PROXY 198.51.100.42:3128');
  assert.equal(evalPac(globalPac, 'https://198.51.100.42:8443/', '198.51.100.42'), 'DIRECT');
  assert.equal(evalPac(globalPac, 'http://127.0.0.1:8080/', '127.0.0.1'), 'DIRECT');

  // Empty proxyHost falls back cleanly to DIRECT PAC
  const unconfiguredPac = buildPacScript(normalizeState({ isActive: true }));
  assert.equal(evalPac(unconfiguredPac, 'https://chatgpt.com/', 'chatgpt.com'), 'DIRECT');

  // Check UI helper parity
  assert.equal(isHostProxied('chatgpt.com', baseState), true);
  assert.equal(isHostProxied('sub.notion.so', baseState), true);
  assert.equal(isHostProxied('example.org', baseState), false);
  assert.equal(isHostProxied('chatgpt.com', { ...baseState, isActive: false }), false);
  assert.equal(isHostInEnabledPresets('claude.ai', ['claude_web']), true);
  assert.equal(isHostInEnabledPresets('grok.com', ['claude_web']), false);
});

test('Domain normalization & API config helpers work cleanly', () => {
  assert.equal(normalizeDomain('HTTPS://Api.OpenAI.com:443/v1/chat'), 'api.openai.com');
  assert.equal(normalizeDomain('*.perplexity.ai'), 'perplexity.ai');
  assert.equal(normalizeRuleDomain('invalid'), '');
  assert.equal(normalizeRuleDomain('foo..bar.com'), '');
  assert.equal(normalizeRuleDomain('https://cursor.com/pricing'), 'cursor.com');
  assert.equal(collectRoutedDomains(['chatgpt'], ['chatgpt.com', 'cursor.com', 'badhost']).includes('cursor.com'), true);
  assert.equal(collectRoutedDomains(['chatgpt'], ['badhost']).includes('badhost'), false);

  assert.equal(isValidIpv4('178.120.53.202'), true);
  assert.equal(isValidIpv4('256.0.0.1'), false);
  assert.equal(isValidIpv4('01.1.1.1'), false);
  assert.equal(isValidIpv4('1.2.3'), false);

  const cfg = {
    apiUrl: '198.51.100.99:8080/api/whitelist/',
    authToken: 'Bearer   my-token ',
    proxyProtocol: 'https', // desktop-only -> falls back to socks5
    proxyPort: 8443,
  };
  assert.equal(getEffectiveApiUrl(cfg), 'http://198.51.100.99:8080');
  assert.equal(getEffectiveAuthToken(cfg), 'my-token');
  assert.equal(getEffectiveProxyHost(cfg), '198.51.100.99');
  assert.equal(getEffectiveProxyProtocol(cfg), 'socks5');
  assert.equal(getDefaultPortForProtocol('http'), 3128);
  assert.equal(getDefaultPortForProtocol('socks5'), 1080);
  assert.equal(getEffectiveProxyPort({ proxyProtocol: 'http' }), 3128);
  assert.equal(isServerConfigured(cfg), true);
  assert.equal(isServerConfigured({ apiUrl: 'http://your-server-ip:8080', authToken: 'tok' }), false);

  const defaults = normalizeState(undefined);
  assert.equal(defaults.language, 'ru');
  assert.equal(defaults.proxyMode, 'split');
  assert.equal(defaults.enabledPresetIds.length, PRESET_SITES.filter((s) => s.defaultEnabled).length);
  assert.equal(DEFAULT_STATE.serverConfig.proxyProtocol, 'socks5');
});

test('Profile export/import handles pr:// keys, JSON, and Desktop HTTPS fallback', () => {
  const sc = {
    apiUrl: 'http://203.0.113.10:8080',
    authToken: 'tok-abc',
    proxyProtocol: 'http',
    proxyPort: 3128,
  };
  const key = encodeProfileKey(sc);
  assert.ok(key.startsWith('pr://'));

  const parsedFromKey = parseProfileInput(key);
  assert.equal(parsedFromKey.protocolDowngraded, false);
  assert.deepEqual(parsedFromKey.serverConfig, {
    apiUrl: 'http://203.0.113.10:8080',
    authToken: 'tok-abc',
    proxyProtocol: 'http',
    proxyPort: 3128,
  });

  const payload = buildProfilePayload(sc);
  const parsedFromJson = parseProfileInput(JSON.stringify(payload));
  assert.equal(parsedFromJson.serverConfig.proxyPort, 3128);

  // Desktop profile using HTTPS proxy :8443 -> auto-downgrade to SOCKS5 :1080
  const desktopPayload = {
    app: 'ProxyRouter',
    apiUrl: 'https://203.0.113.10:8080',
    authToken: 'desktop-secret',
    proxyProtocol: 'https',
    proxyPort: 8443,
  };
  const downgraded = parseProfileInput(JSON.stringify(desktopPayload));
  assert.equal(downgraded.protocolDowngraded, true);
  assert.equal(downgraded.serverConfig.proxyProtocol, 'socks5');
  assert.equal(downgraded.serverConfig.proxyPort, 1080);

  assert.throws(() => parseProfileInput(''));
  assert.throws(() => parseProfileInput('{}'));
});
