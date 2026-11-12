import { t } from '../../shared/i18n.js';
import { createIcon } from '../../shared/icons.js';
import {
  checkServiceHealth,
  getDefaultPortForProtocol,
  getEffectiveApiUrl,
  getEffectiveAuthToken,
  getEffectiveProxyHost,
  getEffectiveProxyPort,
  getEffectiveProxyProtocol,
  whitelistRequest,
} from '../../shared/api.js';
import {
  buildProfilePayload,
  encodeProfileKey,
  parseProfileInput,
} from '../../shared/profile.js';
import { syncProxy, updateState } from '../../shared/storage.js';
import { copyWithFeedback, createEl } from '../../shared/ui.js';

const REPO_URL = 'https://github.com/D1verlin/ProxyRouterDesktop';

export function createSettingsView(rootEl) {
  let state = null;
  let isDirty = false;
  let formProtocol = 'socks5';
  let tokenVisible = false;
  let isTesting = false;
  let testMsg = '';
  let saveMsg = '';
  let saveTimer = null;
  let importMsg = '';

  const titleEl = createEl('h1', { className: 'view-title' });
  const subtitleEl = createEl('p', { className: 'view-subtitle' });

  // ── 1. General Preferences ────────────────────────────────────
  const secGeneralTitle = createEl('span', { className: 'panel-heading' });
  const langLabel = createEl('span', { className: 'field-label' });
  const btnLangRu = createEl('button', { type: 'button', className: 'segment-btn', text: 'Русский' });
  const btnLangEn = createEl('button', { type: 'button', className: 'segment-btn', text: 'English' });
  const langGroup = createEl('div', { className: 'segmented', role: 'group' }, btnLangRu, btnLangEn);

  const modeLabel = createEl('span', { className: 'field-label' });
  const btnModeSplit = createEl('button', { type: 'button', className: 'segment-btn' });
  const btnModeGlobal = createEl('button', { type: 'button', className: 'segment-btn' });
  const modeGroup = createEl('div', { className: 'segmented', role: 'group' }, btnModeSplit, btnModeGlobal);
  const modeDesc = createEl('p', { className: 'hint-text' });

  const generalCard = createEl(
    'section',
    { className: 'panel-card' },
    secGeneralTitle,
    createEl(
      'div',
      { className: 'settings-grid' },
      createEl('div', { className: 'field-group' }, langLabel, langGroup),
      createEl('div', { className: 'field-group' }, modeLabel, modeGroup, modeDesc)
    )
  );

  // ── 2. Server & Authentication ────────────────────────────────
  const secServerTitle = createEl('span', { className: 'panel-heading' });
  const apiUrlLabel = createEl('label', { className: 'field-label', for: 'input-api-url' });
  const apiUrlInput = createEl('input', {
    id: 'input-api-url',
    type: 'text',
    className: 'input mono',
    placeholder: 'http://185.100.200.10:8080',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const apiUrlHint = createEl('span', { className: 'hint-text' });

  const tokenLabel = createEl('label', { className: 'field-label', for: 'input-auth-token' });
  const tokenInput = createEl('input', {
    id: 'input-auth-token',
    type: 'password',
    className: 'input mono',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const btnToggleToken = createEl('button', {
    type: 'button',
    className: 'btn-icon input-end-btn',
  });
  const tokenWrap = createEl('div', { className: 'input-action-wrap' }, tokenInput, btnToggleToken);

  const protoLabel = createEl('span', { className: 'field-label' });
  const btnProtoSocks5 = createEl('button', { type: 'button', className: 'segment-btn mono', text: 'SOCKS5 (:1080)' });
  const btnProtoHttp = createEl('button', { type: 'button', className: 'segment-btn mono', text: 'HTTP (:3128)' });
  const protoGroup = createEl('div', { className: 'segmented', role: 'group' }, btnProtoSocks5, btnProtoHttp);
  const protoHint = createEl('span', { className: 'hint-text' });

  const portLabel = createEl('label', { className: 'field-label', for: 'input-proxy-port' });
  const portInput = createEl('input', {
    id: 'input-proxy-port',
    type: 'number',
    min: '1',
    max: '65535',
    className: 'input mono',
  });

  const btnTest = createEl('button', { type: 'button', className: 'btn-secondary' });
  const btnSave = createEl('button', { type: 'submit', className: 'btn-primary' });
  const saveNoticeEl = createEl('span', { className: 'badge active', hidden: true });
  const testNoticeEl = createEl('div', { className: 'notice-inline', hidden: true, role: 'status' });

  const activeNodeHeading = createEl('span', { className: 'field-label' });
  const kvEndpointVal = createEl('span', { className: 'summary-kv-val mono' });
  const kvApiVal = createEl('span', { className: 'summary-kv-val mono' });
  const kvIpVal = createEl('span', { className: 'summary-kv-val mono' });

  const serverForm = createEl(
    'form',
    { className: 'view-stack' },
    createEl(
      'div',
      { className: 'settings-grid' },
      createEl('div', { className: 'field-group' }, apiUrlLabel, apiUrlInput, apiUrlHint),
      createEl('div', { className: 'field-group' }, tokenLabel, tokenWrap)
    ),
    createEl(
      'div',
      { className: 'settings-grid' },
      createEl('div', { className: 'field-group' }, protoLabel, protoGroup, protoHint),
      createEl('div', { className: 'field-group' }, portLabel, portInput)
    ),
    createEl('div', { className: 'action-strip' }, btnTest, btnSave, saveNoticeEl),
    testNoticeEl
  );

  const activeNodeSummary = createEl(
    'div',
    { className: 'field-group' },
    activeNodeHeading,
    createEl(
      'div',
      { className: 'summary-kv-grid' },
      createEl('div', { className: 'summary-kv-cell' }, createEl('span', { className: 'card-label', text: 'Endpoint' }), kvEndpointVal),
      createEl('div', { className: 'summary-kv-cell' }, createEl('span', { className: 'card-label', text: 'API' }), kvApiVal),
      createEl('div', { className: 'summary-kv-cell' }, createEl('span', { className: 'card-label', text: 'IPv4' }), kvIpVal)
    )
  );

  const serverCard = createEl(
    'section',
    { className: 'panel-card' },
    secServerTitle,
    serverForm,
    activeNodeSummary
  );

  // ── 3. Profile Transfer (pr:// & .json) ───────────────────────
  const secTransferTitle = createEl('span', { className: 'panel-heading' });
  const btnCopyKey = createEl('button', { type: 'button', className: 'btn-secondary' });
  const tipCopyKey = createEl('span', { className: 'copy-tip', role: 'status', 'aria-live': 'polite' });
  const copyKeyWrap = createEl('div', { className: 'copy-wrap' }, btnCopyKey, tipCopyKey);
  const btnDownloadJson = createEl('button', { type: 'button', className: 'btn-secondary' });

  const fileInput = createEl('input', {
    type: 'file',
    accept: '.json,.txt,application/json,text/plain',
    hidden: true,
  });
  const dropZoneTitle = createEl('span');
  const dropZone = createEl(
    'button',
    { type: 'button', className: 'drop-zone' },
    createIcon('upload', 18),
    dropZoneTitle
  );

  const pasteInput = createEl('input', {
    type: 'text',
    className: 'input mono',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const btnLoadPaste = createEl('button', { type: 'submit', className: 'btn-primary' });
  const pasteForm = createEl('form', { className: 'inline-form' }, pasteInput, btnLoadPaste);
  const importNoticeEl = createEl('div', { className: 'notice-inline', hidden: true, role: 'status' });

  const transferCard = createEl(
    'section',
    { className: 'panel-card' },
    secTransferTitle,
    createEl('div', { className: 'action-strip' }, copyKeyWrap, btnDownloadJson),
    fileInput,
    dropZone,
    pasteForm,
    importNoticeEl
  );

  // ── 4. About Card ─────────────────────────────────────────────
  const secAboutTitle = createEl('span', { className: 'panel-heading' });
  const aboutPlatformVal = createEl('span', { className: 'summary-kv-val' });
  const aboutVersionLabel = createEl('span', { className: 'card-label' });
  const aboutVersionVal = createEl('span', {
    className: 'summary-kv-val mono',
    text: `v${chrome.runtime.getManifest().version}`,
  });
  const aboutRepoLabel = createEl('span', { className: 'card-label' });
  const aboutRepoLink = createEl(
    'a',
    {
      className: 'about-link mono',
      href: REPO_URL,
      target: '_blank',
      rel: 'noopener noreferrer',
    },
    'github.com/D1verlin/ProxyRouterDesktop',
    createIcon('external', 12)
  );

  const aboutCard = createEl(
    'section',
    { className: 'panel-card' },
    secAboutTitle,
    createEl(
      'div',
      { className: 'summary-kv-grid' },
      createEl('div', { className: 'summary-kv-cell' }, createEl('span', { className: 'card-label', text: 'Runtime' }), aboutPlatformVal),
      createEl('div', { className: 'summary-kv-cell' }, aboutVersionLabel, aboutVersionVal),
      createEl('div', { className: 'summary-kv-cell' }, aboutRepoLabel, createEl('div', {}, aboutRepoLink))
    )
  );

  rootEl.replaceChildren(
    createEl(
      'div',
      { className: 'view-stack' },
      createEl('div', {}, titleEl, subtitleEl),
      generalCard,
      serverCard,
      transferCard,
      aboutCard
    )
  );

  // ── Helpers & Event Handlers ──────────────────────────────────
  function getDraftServerConfig() {
    const portNum = Number(portInput.value);
    return {
      apiUrl: apiUrlInput.value.trim(),
      authToken: tokenInput.value.trim(),
      proxyProtocol: formProtocol,
      proxyPort:
        Number.isInteger(portNum) && portNum > 0 && portNum <= 65535
          ? portNum
          : getDefaultPortForProtocol(formProtocol),
    };
  }

  function hydrateFormFromConfig(sc) {
    formProtocol = getEffectiveProxyProtocol(sc);
    apiUrlInput.value = sc?.apiUrl || '';
    tokenInput.value = sc?.authToken || '';
    portInput.value = String(getEffectiveProxyPort(sc));
    renderProtoButtons();
  }

  function renderProtoButtons() {
    btnProtoSocks5.setAttribute('aria-pressed', String(formProtocol === 'socks5'));
    btnProtoHttp.setAttribute('aria-pressed', String(formProtocol === 'http'));
  }

  async function applyServerConfig(nextSc) {
    const next = await updateState({ serverConfig: nextSc });
    isDirty = false;
    hydrateFormFromConfig(next.serverConfig);
    update(next);
    await syncProxy().catch(() => {});
    return next;
  }

  function showSaveBadge() {
    clearTimeout(saveTimer);
    saveMsg = t(state.language, 'settings.saved');
    saveNoticeEl.hidden = false;
    saveNoticeEl.textContent = saveMsg;
    saveTimer = setTimeout(() => {
      saveMsg = '';
      saveNoticeEl.hidden = true;
    }, 2200);
  }

  async function runConnectionTest() {
    if (!state || isTesting) return;
    isTesting = true;
    testMsg = '';
    testNoticeEl.hidden = true;
    renderTestBtn();

    const draft = getDraftServerConfig();
    const apiUrl = getEffectiveApiUrl(draft);
    const token = getEffectiveAuthToken(draft);
    const host = getEffectiveProxyHost(draft);
    const proto = getEffectiveProxyProtocol(draft).toUpperCase();
    const port = getEffectiveProxyPort(draft);

    try {
      const t0 = performance.now();
      const data = await whitelistRequest(apiUrl, 'GET', token);
      const ms = Math.max(1, Math.round(performance.now() - t0));
      const count = Array.isArray(data?.ips) ? data.ips.length : 0;

      if (state.isActive) {
        const proxyCheck = await checkServiceHealth('api.ipify.org');
        if (proxyCheck.ok) {
          testMsg = t(state.language, 'settings.testOkWithProxy', {
            count,
            ms,
            proxyMs: proxyCheck.latencyMs,
          });
        } else {
          testMsg = t(state.language, 'settings.testOk', {
            count,
            ms,
            proto,
            host: host || '—',
            port,
          });
        }
      } else {
        testMsg = t(state.language, 'settings.testOk', {
          count,
          ms,
          proto,
          host: host || '—',
          port,
        });
      }
    } catch (err) {
      testMsg = t(state.language, 'settings.testFail', { error: err.message });
    } finally {
      isTesting = false;
      renderTestBtn();
      testNoticeEl.hidden = !testMsg;
      testNoticeEl.textContent = testMsg;
    }
  }

  async function handleImportRaw(rawText) {
    if (!state) return;
    try {
      const { serverConfig, protocolDowngraded } = parseProfileInput(
        rawText,
        state.serverConfig
      );
      await applyServerConfig(serverConfig);
      pasteInput.value = '';
      importMsg = protocolDowngraded
        ? t(state.language, 'settings.importHttpsFallback', {
            url: serverConfig.apiUrl || 'OK',
          })
        : t(state.language, 'settings.importOk', {
            url: serverConfig.apiUrl || 'OK',
          });
    } catch (err) {
      importMsg = t(state.language, 'settings.importErr', { error: err.message });
    }
    importNoticeEl.hidden = !importMsg;
    importNoticeEl.textContent = importMsg;
  }

  function renderTestBtn() {
    if (!state) return;
    const lang = state.language;
    btnTest.disabled = isTesting;
    btnTest.replaceChildren(
      createIcon(isTesting ? 'refresh' : 'activity', 13, isTesting ? 'spin' : ''),
      t(lang, isTesting ? 'settings.btnTesting' : 'settings.btnTest')
    );
  }

  // Event listeners
  btnLangRu.addEventListener('click', async () => {
    const next = await updateState({ language: 'ru' });
    update(next);
  });
  btnLangEn.addEventListener('click', async () => {
    const next = await updateState({ language: 'en' });
    update(next);
  });

  btnModeSplit.addEventListener('click', async () => {
    const next = await updateState({ proxyMode: 'split' });
    update(next);
    await syncProxy().catch(() => {});
  });
  btnModeGlobal.addEventListener('click', async () => {
    const next = await updateState({ proxyMode: 'global' });
    update(next);
    await syncProxy().catch(() => {});
  });

  apiUrlInput.addEventListener('input', () => {
    isDirty = true;
  });
  tokenInput.addEventListener('input', () => {
    isDirty = true;
  });
  portInput.addEventListener('input', () => {
    isDirty = true;
  });

  btnToggleToken.addEventListener('click', () => {
    tokenVisible = !tokenVisible;
    tokenInput.type = tokenVisible ? 'text' : 'password';
    btnToggleToken.replaceChildren(createIcon(tokenVisible ? 'eyeOff' : 'eye', 14));
  });

  btnProtoSocks5.addEventListener('click', () => {
    formProtocol = 'socks5';
    portInput.value = String(getDefaultPortForProtocol('socks5'));
    isDirty = true;
    renderProtoButtons();
  });
  btnProtoHttp.addEventListener('click', () => {
    formProtocol = 'http';
    portInput.value = String(getDefaultPortForProtocol('http'));
    isDirty = true;
    renderProtoButtons();
  });

  btnTest.addEventListener('click', runConnectionTest);
  serverForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await applyServerConfig(getDraftServerConfig());
    showSaveBadge();
  });

  btnCopyKey.addEventListener('click', () => {
    const key = encodeProfileKey(getDraftServerConfig());
    copyWithFeedback(btnCopyKey, tipCopyKey, key, {
      copiedText: t(state.language, 'popup.copied'),
      failedText: t(state.language, 'popup.copyFailed'),
    });
  });

  btnDownloadJson.addEventListener('click', () => {
    const payload = buildProfilePayload(getDraftServerConfig());
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'proxy-router-profile.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const text = await file.text();
    fileInput.value = '';
    await handleImportRaw(text);
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      await handleImportRaw(await file.text());
    }
  });

  pasteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pasteInput.value.trim()) return;
    await handleImportRaw(pasteInput.value);
  });

  function update(nextState) {
    state = nextState;
    const lang = state.language;

    if (!isDirty) {
      hydrateFormFromConfig(state.serverConfig);
    }

    titleEl.textContent = t(lang, 'settings.title');
    subtitleEl.textContent = t(lang, 'settings.subtitle');

    secGeneralTitle.replaceChildren(createIcon('settings', 14), t(lang, 'settings.secGeneral'));
    langLabel.textContent = t(lang, 'settings.languageLabel');
    btnLangRu.setAttribute('aria-pressed', String(lang === 'ru'));
    btnLangEn.setAttribute('aria-pressed', String(lang === 'en'));

    modeLabel.textContent = t(lang, 'settings.modeLabel');
    btnModeSplit.textContent = t(lang, 'popup.modeSplit');
    btnModeGlobal.textContent = t(lang, 'popup.modeGlobal');
    btnModeSplit.setAttribute('aria-pressed', String(state.proxyMode !== 'global'));
    btnModeGlobal.setAttribute('aria-pressed', String(state.proxyMode === 'global'));
    modeDesc.textContent = t(
      lang,
      state.proxyMode === 'global' ? 'settings.modeGlobalDesc' : 'settings.modeSplitDesc'
    );

    secServerTitle.replaceChildren(createIcon('globe', 14), t(lang, 'settings.secServer'));
    apiUrlLabel.textContent = t(lang, 'settings.apiUrlLabel');
    apiUrlHint.textContent = t(lang, 'settings.apiUrlHint');
    tokenLabel.textContent = t(lang, 'settings.tokenLabel');
    tokenInput.placeholder = t(lang, 'settings.tokenPlaceholder');
    btnToggleToken.setAttribute('aria-label', t(lang, 'settings.toggleToken'));
    btnToggleToken.replaceChildren(createIcon(tokenVisible ? 'eyeOff' : 'eye', 14));

    protoLabel.textContent = t(lang, 'settings.protocolLabel');
    protoHint.textContent = t(lang, 'settings.protocolHint');
    portLabel.textContent = t(lang, 'settings.portLabel');
    btnSave.replaceChildren(createIcon('save', 14), t(lang, 'settings.btnSave'));
    renderTestBtn();

    activeNodeHeading.textContent = t(lang, 'settings.activeNode');
    const effHost = getEffectiveProxyHost(state.serverConfig);
    const effProto = getEffectiveProxyProtocol(state.serverConfig);
    const effPort = getEffectiveProxyPort(state.serverConfig);
    const effApi = getEffectiveApiUrl(state.serverConfig);
    kvEndpointVal.textContent = effHost ? `${effProto}://${effHost}:${effPort}` : '—';
    kvApiVal.textContent = effApi || '—';
    kvIpVal.textContent = state.publicIp || '—';

    secTransferTitle.replaceChildren(createIcon('download', 14), t(lang, 'settings.secTransfer'));
    btnCopyKey.replaceChildren(createIcon('copy', 13), t(lang, 'settings.btnCopyKey'));
    btnDownloadJson.replaceChildren(createIcon('download', 13), t(lang, 'settings.btnDownloadJson'));
    dropZoneTitle.textContent = t(lang, 'settings.dropTitle');
    pasteInput.placeholder = t(lang, 'settings.pastePlaceholder');
    btnLoadPaste.textContent = t(lang, 'settings.btnLoad');

    secAboutTitle.textContent = t(lang, 'settings.secAbout');
    aboutPlatformVal.textContent = t(lang, 'settings.platform');
    aboutVersionLabel.textContent = t(lang, 'settings.version');
    aboutRepoLabel.textContent = t(lang, 'settings.repo');
  }

  return {
    update,
    activate: (nextState) => update(nextState),
  };
}
