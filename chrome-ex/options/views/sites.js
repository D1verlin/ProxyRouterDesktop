import { t } from '../../shared/i18n.js';
import { createIcon } from '../../shared/icons.js';
import { checkServiceHealth } from '../../shared/api.js';
import { normalizeDomain, normalizeRuleDomain } from '../../shared/pac.js';
import { KNOWN_DOMAIN_BUNDLES, PRESET_CATEGORIES, PRESET_SITES } from '../../shared/presets.js';
import { syncProxy, updateState } from '../../shared/storage.js';
import { createEl } from '../../shared/ui.js';

export function createSitesView(rootEl) {
  let state = null;
  let activeTab = 'presets'; // 'presets' | 'custom'
  let selectedCategory = 'All';
  let searchQuery = '';
  let isBatchOpen = false;
  let batchNotice = '';
  let batchTimer = null;
  let isCheckingAll = false;
  const healthMap = new Map(); // presetId -> { status: 'checking'|'ok'|'error', latencyMs, error }

  // Persistent DOM refs (never recreated per keystroke)
  const titleEl = createEl('h1', { className: 'view-title' });
  const subtitleEl = createEl('p', { className: 'view-subtitle' });

  const tabPresetsCount = createEl('span', { className: 'sub-tab-count' });
  const tabPresetsLabel = createEl('span');
  const tabPresetsBtn = createEl(
    'button',
    {
      type: 'button',
      id: 'tab-presets',
      role: 'tab',
      className: 'sub-tab',
      'aria-selected': 'true',
      tabindex: '0',
    },
    tabPresetsLabel,
    tabPresetsCount
  );

  const tabCustomCount = createEl('span', { className: 'sub-tab-count' });
  const tabCustomLabel = createEl('span');
  const tabCustomBtn = createEl(
    'button',
    {
      type: 'button',
      id: 'tab-custom',
      role: 'tab',
      className: 'sub-tab',
      'aria-selected': 'false',
      tabindex: '-1',
    },
    tabCustomLabel,
    tabCustomCount
  );

  const tablistEl = createEl(
    'div',
    { className: 'sub-tablist', role: 'tablist' },
    tabPresetsBtn,
    tabCustomBtn
  );

  // Presets Panel refs
  const searchInput = createEl('input', {
    type: 'search',
    className: 'input search-input',
    autocomplete: 'off',
  });
  const btnCheckAll = createEl('button', { type: 'button', className: 'btn-secondary' });
  const btnEnableAll = createEl('button', { type: 'button', className: 'btn-secondary' });
  const btnDisableAll = createEl('button', { type: 'button', className: 'btn-secondary' });
  const pillsRow = createEl('div', { className: 'pill-strip' });
  const presetsGrid = createEl('div', { className: 'presets-grid' });

  const panelPresets = createEl(
    'div',
    {
      id: 'panel-presets',
      role: 'tabpanel',
      'aria-labelledby': 'tab-presets',
      className: 'panel-card',
    },
    createEl(
      'div',
      { className: 'toolbar-row' },
      createEl(
        'div',
        { className: 'search-wrap' },
        createEl('span', { className: 'search-icon' }, createIcon('search', 14)),
        searchInput
      ),
      createEl('div', { className: 'action-strip' }, btnCheckAll, btnEnableAll, btnDisableAll)
    ),
    pillsRow,
    presetsGrid
  );

  // Custom Domains Panel refs
  const domainInput = createEl('input', {
    type: 'text',
    className: 'input mono',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const btnAddDomain = createEl('button', { type: 'submit', className: 'btn-primary' });
  const btnToggleBatch = createEl('button', { type: 'button', className: 'btn-secondary' });
  const smartBanner = createEl('div', { className: 'smart-banner', hidden: true });
  const batchTextarea = createEl('textarea', { className: 'textarea', spellcheck: 'false' });
  const btnImportBatch = createEl('button', { type: 'button', className: 'btn-primary' });
  const batchBox = createEl(
    'div',
    { className: 'batch-box', hidden: true },
    batchTextarea,
    createEl('div', { className: 'action-strip' }, btnImportBatch)
  );
  const batchNoticeEl = createEl('div', { className: 'notice-inline', hidden: true, role: 'status' });
  const customList = createEl('div', { className: 'domain-list' });

  const addForm = createEl(
    'form',
    { className: 'inline-form' },
    domainInput,
    btnAddDomain,
    btnToggleBatch
  );

  const panelCustom = createEl(
    'div',
    {
      id: 'panel-custom',
      role: 'tabpanel',
      'aria-labelledby': 'tab-custom',
      className: 'panel-card',
      hidden: true,
    },
    addForm,
    smartBanner,
    batchBox,
    batchNoticeEl,
    customList
  );

  rootEl.replaceChildren(
    createEl(
      'div',
      { className: 'view-stack' },
      createEl(
        'div',
        { className: 'view-header' },
        createEl('div', {}, titleEl, subtitleEl),
        tablistEl
      ),
      panelPresets,
      panelCustom
    )
  );

  function setActiveTab(nextTab, focusTab = false) {
    activeTab = nextTab;
    const isPresets = activeTab === 'presets';

    tabPresetsBtn.setAttribute('aria-selected', String(isPresets));
    tabPresetsBtn.setAttribute('tabindex', isPresets ? '0' : '-1');
    tabCustomBtn.setAttribute('aria-selected', String(!isPresets));
    tabCustomBtn.setAttribute('tabindex', !isPresets ? '0' : '-1');

    panelPresets.hidden = !isPresets;
    panelCustom.hidden = isPresets;

    if (focusTab) {
      (isPresets ? tabPresetsBtn : tabCustomBtn).focus();
    }
  }

  function getFilteredPresets() {
    const q = searchQuery.trim().toLowerCase();
    return PRESET_SITES.filter((site) => {
      const catOk = selectedCategory === 'All' || site.category === selectedCategory;
      if (!catOk) return false;
      if (!q) return true;
      return (
        site.label.toLowerCase().includes(q) ||
        site.host.toLowerCase().includes(q) ||
        site.desc.toLowerCase().includes(q) ||
        site.hosts.some((h) => h.toLowerCase().includes(q))
      );
    });
  }

  function renderPills() {
    if (!state) return;
    const lang = state.language;
    pillsRow.replaceChildren(
      ...PRESET_CATEGORIES.map((cat) => {
        const label = cat === 'All' ? t(lang, 'sites.allCategories') : cat;
        return createEl('button', {
          type: 'button',
          className: 'cat-pill',
          'aria-pressed': String(selectedCategory === cat),
          text: label,
          onClick: () => {
            selectedCategory = cat;
            renderPills();
            renderPresetsGrid();
          },
        });
      })
    );
  }

  function formatHealthNode(site, lang) {
    const h = healthMap.get(site.id);
    if (!h) return null;
    if (h.status === 'checking') {
      return createEl('span', { className: 'health-pill', text: t(lang, 'sites.checking') });
    }
    if (h.status === 'ok') {
      return createEl('span', { className: 'health-pill ok', text: `${h.latencyMs} ms` });
    }
    return createEl('span', {
      className: 'health-pill',
      text: t(lang, 'sites.error'),
      title: h.error || '',
    });
  }

  function renderPresetsGrid() {
    if (!state) return;
    const lang = state.language;
    const enabledSet = new Set(state.enabledPresetIds);
    const items = getFilteredPresets();

    if (items.length === 0) {
      presetsGrid.replaceChildren(
        createEl('div', { className: 'empty-state', text: t(lang, 'sites.searchPlaceholder') })
      );
      return;
    }

    presetsGrid.replaceChildren(
      ...items.map((site) => {
        const enabled = enabledSet.has(site.id);
        const health = healthMap.get(site.id);

        const switchInput = createEl('input', {
          type: 'checkbox',
          checked: enabled,
          'aria-label': site.label,
          onChange: () => togglePreset(site.id, switchInput.checked),
        });

        const checkBtn = createEl(
          'button',
          {
            type: 'button',
            className: 'health-btn',
            disabled: health?.status === 'checking',
            onClick: () => runSingleCheck(site),
          },
          createIcon('activity', 12),
          health?.status === 'checking' ? t(lang, 'sites.checking') : t(lang, 'sites.check')
        );

        return createEl(
          'article',
          { className: `preset-card${enabled ? ' enabled' : ''}` },
          createEl(
            'div',
            { className: 'preset-top' },
            createEl(
              'div',
              { className: 'preset-info' },
              createEl(
                'div',
                { className: 'preset-title-line' },
                createEl('span', { className: 'preset-name', text: site.label }),
                createEl('span', { className: 'badge', text: site.category })
              ),
              createEl('span', { className: 'preset-host mono', text: site.host }),
              createEl('p', { className: 'preset-desc', text: site.desc })
            ),
            createEl('label', { className: 'switch-control' }, switchInput)
          ),
          createEl(
            'div',
            { className: 'preset-footer' },
            checkBtn,
            formatHealthNode(site, lang)
          )
        );
      })
    );
  }

  function renderSmartBanner() {
    if (!state) return;
    const q = domainInput.value.trim().toLowerCase();
    if (q.length < 3) {
      smartBanner.hidden = true;
      smartBanner.replaceChildren();
      return;
    }

    const matchedBundle = KNOWN_DOMAIN_BUNDLES.find((bundle) =>
      bundle.match.some((m) => q.includes(m) || m.includes(q))
    );
    if (!matchedBundle) {
      smartBanner.hidden = true;
      smartBanner.replaceChildren();
      return;
    }

    const existing = new Set(state.customDomains.map((d) => normalizeDomain(d)));
    const missing = matchedBundle.domains.filter((d) => !existing.has(normalizeDomain(d)));
    if (missing.length === 0) {
      smartBanner.hidden = true;
      smartBanner.replaceChildren();
      return;
    }

    const lang = state.language;
    smartBanner.hidden = false;
    smartBanner.replaceChildren(
      createEl(
        'div',
        { className: 'smart-info' },
        createIcon('lightbulb', 14),
        createEl('span', { text: `${t(lang, 'sites.smartTitle')} ${matchedBundle.name}:` }),
        createEl(
          'div',
          { className: 'smart-domains' },
          ...missing.map((d) => createEl('span', { className: 'badge mono', text: d }))
        )
      ),
      createEl(
        'button',
        {
          type: 'button',
          className: 'btn-primary btn-xs',
          onClick: async () => {
            await addDomains(missing);
            domainInput.value = '';
            renderSmartBanner();
          },
        },
        createIcon('plus', 12),
        t(lang, 'sites.smartAddAll')
      )
    );
  }

  function renderCustomList() {
    if (!state) return;
    const lang = state.language;
    const domains = state.customDomains;

    if (domains.length === 0) {
      customList.replaceChildren(
        createEl('div', { className: 'empty-state', text: t(lang, 'sites.emptyCustom') })
      );
      return;
    }

    customList.replaceChildren(
      ...domains.map((domain) =>
        createEl(
          'div',
          { className: 'list-item' },
          createEl(
            'div',
            { className: 'list-item-main' },
            createIcon('globe', 14),
            createEl('span', { className: 'list-item-text mono', text: domain })
          ),
          createEl(
            'button',
            {
              type: 'button',
              className: 'btn-icon',
              'aria-label': `${t(lang, 'sites.removeDomain')}: ${domain}`,
              title: t(lang, 'sites.removeDomain'),
              onClick: () => removeDomain(domain),
            },
            createIcon('trash', 14)
          )
        )
      )
    );
  }

  async function togglePreset(presetId, enabled) {
    const next = await updateState((prev) => {
      const set = new Set(prev.enabledPresetIds);
      if (enabled) set.add(presetId);
      else set.delete(presetId);
      return { enabledPresetIds: [...set] };
    });
    update(next);
    await syncProxy().catch(() => {});
  }

  async function setAllPresets(enabled) {
    const ids = enabled ? PRESET_SITES.map((s) => s.id) : [];
    const next = await updateState({ enabledPresetIds: ids });
    update(next);
    await syncProxy().catch(() => {});
  }

  async function addDomains(rawList) {
    const cleaned = rawList.map(normalizeRuleDomain).filter(Boolean);
    if (cleaned.length === 0) return 0;

    let addedCount = 0;
    const next = await updateState((prev) => {
      const set = new Set(prev.customDomains.map(normalizeDomain).filter(Boolean));
      const before = set.size;
      for (const d of cleaned) set.add(d);
      addedCount = set.size - before;
      return { customDomains: [...set] };
    });
    update(next);
    await syncProxy().catch(() => {});
    return addedCount;
  }

  async function removeDomain(domain) {
    const target = normalizeDomain(domain);
    const next = await updateState((prev) => ({
      customDomains: prev.customDomains.filter((d) => normalizeDomain(d) !== target),
    }));
    update(next);
    await syncProxy().catch(() => {});
  }

  async function runSingleCheck(site) {
    healthMap.set(site.id, { status: 'checking', latencyMs: 0, error: null });
    renderPresetsGrid();

    const host = site.host || site.hosts?.[0] || '';
    const res = await checkServiceHealth(host);
    healthMap.set(site.id, {
      status: res.ok ? 'ok' : 'error',
      latencyMs: res.latencyMs,
      error: res.error,
    });
    renderPresetsGrid();
  }

  async function runCheckAll() {
    if (isCheckingAll) return;
    const targets = getFilteredPresets();
    if (targets.length === 0) return;

    isCheckingAll = true;
    btnCheckAll.disabled = true;
    for (const s of targets) {
      healthMap.set(s.id, { status: 'checking', latencyMs: 0, error: null });
    }
    renderPresetsGrid();

    const queue = [...targets];
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length > 0) {
        const site = queue.shift();
        if (!site) break;
        const res = await checkServiceHealth(site.host || site.hosts?.[0] || '');
        healthMap.set(site.id, {
          status: res.ok ? 'ok' : 'error',
          latencyMs: res.latencyMs,
          error: res.error,
        });
        renderPresetsGrid();
      }
    });
    await Promise.all(workers);

    isCheckingAll = false;
    btnCheckAll.disabled = false;
  }

  function showBatchNotice(msg) {
    clearTimeout(batchTimer);
    batchNotice = msg;
    if (!msg) {
      batchNoticeEl.hidden = true;
      batchNoticeEl.textContent = '';
      return;
    }
    batchNoticeEl.hidden = false;
    batchNoticeEl.textContent = msg;
    batchTimer = setTimeout(() => showBatchNotice(''), 3500);
  }

  // Event bindings
  tabPresetsBtn.addEventListener('click', () => setActiveTab('presets'));
  tabCustomBtn.addEventListener('click', () => setActiveTab('custom'));
  tablistEl.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    if (e.key === 'Home') return setActiveTab('presets', true);
    if (e.key === 'End') return setActiveTab('custom', true);
    setActiveTab(activeTab === 'presets' ? 'custom' : 'presets', true);
  });

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    renderPresetsGrid();
  });

  btnCheckAll.addEventListener('click', runCheckAll);
  btnEnableAll.addEventListener('click', () => setAllPresets(true));
  btnDisableAll.addEventListener('click', () => setAllPresets(false));

  domainInput.addEventListener('input', renderSmartBanner);

  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = domainInput.value.trim();
    if (!raw) return;
    const tokens = raw.split(/[\s,;]+/).filter(Boolean);
    await addDomains(tokens);
    domainInput.value = '';
    renderSmartBanner();
  });

  btnToggleBatch.addEventListener('click', () => {
    isBatchOpen = !isBatchOpen;
    batchBox.hidden = !isBatchOpen;
    if (isBatchOpen) batchTextarea.focus();
  });

  btnImportBatch.addEventListener('click', async () => {
    const raw = batchTextarea.value.trim();
    if (!raw) return;
    const tokens = raw.split(/[\n\r,\s;]+/).filter(Boolean);
    const added = await addDomains(tokens);
    batchTextarea.value = '';
    showBatchNotice(t(state.language, 'sites.batchResult', { count: added }));
  });

  function update(nextState) {
    state = nextState;
    const lang = state.language;

    titleEl.textContent = t(lang, 'sites.title');
    subtitleEl.textContent = t(lang, 'sites.subtitle');
    tablistEl.setAttribute('aria-label', t(lang, 'sites.title'));
    tabPresetsLabel.textContent = t(lang, 'sites.tabPresets');
    tabPresetsCount.textContent = `${state.enabledPresetIds.length}/${PRESET_SITES.length}`;
    tabCustomLabel.textContent = t(lang, 'sites.tabCustom');
    tabCustomCount.textContent = String(state.customDomains.length);

    searchInput.placeholder = t(lang, 'sites.searchPlaceholder');
    btnCheckAll.replaceChildren(createIcon('activity', 13), t(lang, 'sites.checkAll'));
    btnEnableAll.textContent = t(lang, 'sites.enableAll');
    btnDisableAll.textContent = t(lang, 'sites.disableAll');

    domainInput.placeholder = t(lang, 'sites.addPlaceholder');
    btnAddDomain.replaceChildren(createIcon('plus', 14), t(lang, 'sites.btnAdd'));
    btnToggleBatch.replaceChildren(createIcon('layers', 14), t(lang, 'sites.btnBatch'));
    batchTextarea.placeholder = t(lang, 'sites.batchPlaceholder');
    btnImportBatch.textContent = t(lang, 'sites.btnImportBatch');

    renderPills();
    renderPresetsGrid();
    renderSmartBanner();
    renderCustomList();
    if (batchNotice) {
      batchNoticeEl.hidden = false;
      batchNoticeEl.textContent = batchNotice;
    }
  }

  return {
    update,
    activate: (nextState) => update(nextState),
  };
}
