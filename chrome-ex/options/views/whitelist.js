import { t } from '../../shared/i18n.js';
import { createIcon } from '../../shared/icons.js';
import {
  getEffectiveApiUrl,
  getEffectiveAuthToken,
  isServerConfigured,
  isValidIpv4,
  whitelistRequest,
} from '../../shared/api.js';
import { createEl, sendBgCommand } from '../../shared/ui.js';

export function createWhitelistView(rootEl) {
  let state = null;
  let ips = [];
  let isLoading = false;
  let hasLoadedOnce = false;
  let statusNotice = null; // { text: string } | null
  let noticeTimer = null;

  const titleEl = createEl('h1', { className: 'view-title' });
  const subtitleEl = createEl('p', { className: 'view-subtitle' });
  const btnRefresh = createEl('button', { type: 'button', className: 'btn-secondary' });

  const noticeBox = createEl('div', { className: 'notice-inline', hidden: true, role: 'status' });
  const wanBanner = createEl('div', { className: 'smart-banner', hidden: true });

  const ipInput = createEl('input', {
    type: 'text',
    className: 'input mono',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const btnAddIp = createEl('button', { type: 'submit', className: 'btn-primary' });
  const addForm = createEl('form', { className: 'inline-form' }, ipInput, btnAddIp);

  const listTitleEl = createEl('span', { className: 'panel-heading' });
  const listCountEl = createEl('span', { className: 'sub-tab-count' });
  const ipListEl = createEl('div', { className: 'ip-list' });

  const mainCard = createEl(
    'div',
    { className: 'panel-card' },
    addForm,
    createEl('div', { className: 'panel-title-row' }, listTitleEl, listCountEl),
    ipListEl
  );

  rootEl.replaceChildren(
    createEl(
      'div',
      { className: 'view-stack' },
      createEl(
        'div',
        { className: 'view-header' },
        createEl('div', {}, titleEl, subtitleEl),
        btnRefresh
      ),
      noticeBox,
      wanBanner,
      mainCard
    )
  );

  function setNotice(text, autoClear = false) {
    clearTimeout(noticeTimer);
    statusNotice = text ? { text } : null;
    if (!statusNotice) {
      noticeBox.hidden = true;
      noticeBox.textContent = '';
      return;
    }
    noticeBox.hidden = false;
    noticeBox.textContent = statusNotice.text;
    if (autoClear) {
      noticeTimer = setTimeout(() => setNotice(''), 4000);
    }
  }

  function renderWanBanner() {
    if (!state) return;
    const lang = state.language;
    const configured = isServerConfigured(state.serverConfig);
    const myIp = state.publicIp;

    if (!configured || !myIp || !hasLoadedOnce || ips.includes(myIp)) {
      wanBanner.hidden = true;
      wanBanner.replaceChildren();
      return;
    }

    wanBanner.hidden = false;
    wanBanner.replaceChildren(
      createEl(
        'div',
        { className: 'smart-info' },
        createIcon('alert', 14),
        createEl('span', { text: `${t(lang, 'whitelist.detectedIp')}:` }),
        createEl('span', { className: 'badge mono', text: myIp }),
        createEl('span', { text: `— ${t(lang, 'whitelist.unlisted')}` })
      ),
      createEl(
        'button',
        {
          type: 'button',
          className: 'btn-primary btn-xs',
          onClick: () => addIp(myIp),
        },
        createIcon('shield', 12),
        t(lang, 'whitelist.btnWhitelistMe')
      )
    );
  }

  function renderList() {
    if (!state) return;
    const lang = state.language;
    const configured = isServerConfigured(state.serverConfig);
    const myIp = state.publicIp;

    listCountEl.textContent = String(ips.length);
    btnRefresh.disabled = isLoading || !configured;
    btnAddIp.disabled = isLoading || !configured;
    ipInput.disabled = !configured;

    if (!configured) {
      ipListEl.replaceChildren(
        createEl('div', { className: 'empty-state', text: t(lang, 'whitelist.needConfig') })
      );
      return;
    }

    if (isLoading && !hasLoadedOnce) {
      ipListEl.replaceChildren(
        createEl('div', { className: 'empty-state', text: t(lang, 'whitelist.loading') })
      );
      return;
    }

    if (ips.length === 0) {
      ipListEl.replaceChildren(
        createEl('div', { className: 'empty-state', text: t(lang, 'whitelist.empty') })
      );
      return;
    }

    ipListEl.replaceChildren(
      ...ips.map((ip) => {
        const isSelf = myIp && ip === myIp;
        return createEl(
          'div',
          { className: 'list-item' },
          createEl(
            'div',
            { className: 'list-item-main' },
            createEl('span', { className: 'list-item-text mono', text: ip }),
            isSelf
              ? createEl('span', { className: 'badge active', text: t(lang, 'whitelist.yourDevice') })
              : null
          ),
          createEl(
            'button',
            {
              type: 'button',
              className: 'btn-icon',
              disabled: isLoading,
              'aria-label': `DELETE ${ip}`,
              title: `DELETE ${ip}`,
              onClick: () => removeIp(ip),
            },
            createIcon('trash', 14)
          )
        );
      })
    );
  }

  async function fetchWhitelist({ refreshIpToo = false } = {}) {
    if (!state || !isServerConfigured(state.serverConfig)) {
      ips = [];
      hasLoadedOnce = false;
      renderWanBanner();
      renderList();
      return;
    }

    isLoading = true;
    renderRefreshBtn();
    renderList();

    try {
      if (refreshIpToo || !state.publicIp) {
        const ipRes = await sendBgCommand('REFRESH_IP').catch(() => null);
        if (ipRes?.state) state = ipRes.state;
      }

      const apiUrl = getEffectiveApiUrl(state.serverConfig);
      const token = getEffectiveAuthToken(state.serverConfig);
      const data = await whitelistRequest(apiUrl, 'GET', token);
      ips = Array.isArray(data?.ips) ? data.ips : [];
      hasLoadedOnce = true;
      setNotice('');
    } catch (err) {
      setNotice(err.message);
    } finally {
      isLoading = false;
      renderRefreshBtn();
      renderWanBanner();
      renderList();
    }
  }

  async function addIp(rawIp) {
    if (!state || !isServerConfigured(state.serverConfig)) return;
    const cleanIp = String(rawIp || '').trim();
    if (!isValidIpv4(cleanIp)) {
      setNotice(t(state.language, 'whitelist.invalidIp'), true);
      return;
    }

    isLoading = true;
    renderList();
    try {
      const apiUrl = getEffectiveApiUrl(state.serverConfig);
      const token = getEffectiveAuthToken(state.serverConfig);
      await whitelistRequest(apiUrl, 'POST', token, cleanIp);
      ipInput.value = '';
      setNotice(t(state.language, 'whitelist.added', { ip: cleanIp }), true);
      await fetchWhitelist({ refreshIpToo: false });
    } catch (err) {
      setNotice(err.message);
      isLoading = false;
      renderList();
    }
  }

  async function removeIp(ip) {
    if (!state || !isServerConfigured(state.serverConfig)) return;
    isLoading = true;
    renderList();
    try {
      const apiUrl = getEffectiveApiUrl(state.serverConfig);
      const token = getEffectiveAuthToken(state.serverConfig);
      await whitelistRequest(apiUrl, 'DELETE', token, ip);
      setNotice(t(state.language, 'whitelist.removed', { ip }), true);
      await fetchWhitelist({ refreshIpToo: false });
    } catch (err) {
      setNotice(err.message);
      isLoading = false;
      renderList();
    }
  }

  function renderRefreshBtn() {
    if (!state) return;
    const icon = createIcon('refresh', 13, isLoading ? 'spin' : '');
    btnRefresh.replaceChildren(icon, t(state.language, 'whitelist.refresh'));
    btnRefresh.disabled = isLoading || !isServerConfigured(state.serverConfig);
  }

  btnRefresh.addEventListener('click', () => fetchWhitelist({ refreshIpToo: true }));
  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    addIp(ipInput.value);
  });

  function update(nextState) {
    state = nextState;
    const lang = state.language;

    titleEl.textContent = t(lang, 'whitelist.title');
    subtitleEl.textContent = t(lang, 'whitelist.subtitle');
    ipInput.placeholder = t(lang, 'whitelist.ipPlaceholder');
    btnAddIp.replaceChildren(createIcon('plus', 14), t(lang, 'whitelist.btnAdd'));
    listTitleEl.textContent = t(lang, 'whitelist.listTitle');

    renderRefreshBtn();
    renderWanBanner();
    renderList();
  }

  return {
    update,
    activate: (nextState) => {
      update(nextState);
      fetchWhitelist({ refreshIpToo: !nextState.publicIp });
    },
  };
}
