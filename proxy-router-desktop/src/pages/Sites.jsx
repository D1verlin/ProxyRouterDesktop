/**
 * Sites page — AI & Neural Network Services Routing.
 * Manages neural platform rules, APIs, and custom domains.
 */

import { useState, useMemo } from 'react';
import { Plus, X, Search, Sparkles, Layers, Lightbulb, Check, Activity, AlertTriangle, RotateCw } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useTauri } from '../hooks/useTauri';
import { clayIcons } from '../assets/clayIcons';
import ClayIcon from '../components/ClayIcon';
import styles from './Sites.module.css';

const CATEGORIES = ['All', 'Google AI', 'OpenAI', 'Anthropic', 'Inference'];

const KNOWN_DOMAIN_BUNDLES = [
  {
    name: 'Notion',
    match: ['notion.so', 'notion.site', 'notion'],
    domains: ['notion.so', 'notion.site', 'notion-static.com', 'splunk.notion.so'],
  },
  {
    name: 'Discord',
    match: ['discord.com', 'discord.gg', 'discordapp.com', 'discord'],
    domains: ['discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net', 'discord.media'],
  },
  {
    name: 'Figma',
    match: ['figma.com', 'figma'],
    domains: ['figma.com', 'figmasite.com'],
  },
  {
    name: 'Spotify',
    match: ['spotify.com', 'spotify', 'scdn.co'],
    domains: ['spotify.com', 'scdn.co', 'spotifycdn.com', 'spoti.fi'],
  },
  {
    name: 'Twitter / X',
    match: ['twitter.com', 'x.com', 'twitter'],
    domains: ['x.com', 'twitter.com', 'twimg.com', 't.co'],
  },
  {
    name: 'GitHub',
    match: ['github.com', 'github'],
    domains: ['github.com', 'githubusercontent.com', 'githubassets.com', 'ghcr.io'],
  },
  {
    name: 'Midjourney',
    match: ['midjourney.com', 'midjourney'],
    domains: ['midjourney.com', 'mj.run'],
  },
  {
    name: 'Canva',
    match: ['canva.com', 'canva'],
    domains: ['canva.com', 'canva-apps.com'],
  },
  {
    name: 'Telegram',
    match: ['telegram.org', 't.me', 'telegram'],
    domains: ['telegram.org', 't.me', 'telegra.ph'],
  },
  {
    name: 'Reddit',
    match: ['reddit.com', 'reddit'],
    domains: ['reddit.com', 'redd.it', 'redditmedia.com', 'redditstatic.com'],
  },
  {
    name: 'Cursor',
    match: ['cursor.com', 'cursor.sh', 'cursor'],
    domains: ['cursor.com', 'cursor.sh', 'anysphere.co'],
  },
  {
    name: 'Hugging Face',
    match: ['huggingface.co', 'huggingface'],
    domains: ['huggingface.co', 'hf.co'],
  },
  {
    name: 'Perplexity',
    match: ['perplexity.ai', 'perplexity'],
    domains: ['perplexity.ai', 'pplx.ai'],
  },
];

export default function Sites() {
  const { state, dispatch, t } = useAppStore();
  const { checkServiceHealth } = useTauri();
  const isVela = state.customization?.theme === 'vela';
  const { presetSites, customDomains } = state;

  const [inputValue, setInputValue] = useState('');
  const [activeTab, setActiveTab] = useState('preset');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [isBatchOpen, setIsBatchOpen] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [batchNotice, setBatchNotice] = useState('');
  const [healthMap, setHealthMap] = useState({});

  // Active smart recommendation based on inputValue
  const matchedBundle = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    if (!q || q.length < 3) return null;
    return KNOWN_DOMAIN_BUNDLES.find((b) =>
      b.match.some((m) => q.includes(m) || m.includes(q))
    );
  }, [inputValue]);

  const missingSuggestedDomains = useMemo(() => {
    if (!matchedBundle) return [];
    return matchedBundle.domains.filter((d) => !customDomains.includes(d));
  }, [matchedBundle, customDomains]);

  const handleAddAllSuggested = () => {
    if (!missingSuggestedDomains.length) return;
    missingSuggestedDomains.forEach((d) => {
      dispatch({ type: 'ADD_CUSTOM_DOMAIN', payload: d });
    });
    dispatch({
      type: 'ADD_LOG_ENTRY',
      payload: { level: 'info', msg: `Added ${missingSuggestedDomains.length} related domains for ${matchedBundle.name}` },
    });
    setInputValue('');
  };

  const handleBatchImport = () => {
    if (!batchText.trim()) return;
    const rawList = batchText
      .split(/[\n,\s]+/)
      .map((d) =>
        d
          .trim()
          .toLowerCase()
          .replace(/^https?:\/\//, '')
          .split('/')[0]
          .split(':')[0]
          .replace(/^\*\./, '')
      )
      .filter((d) => d && d.includes('.') && !customDomains.includes(d));

    const unique = Array.from(new Set(rawList));
    unique.forEach((d) => {
      dispatch({ type: 'ADD_CUSTOM_DOMAIN', payload: d });
    });

    dispatch({
      type: 'ADD_LOG_ENTRY',
      payload: { level: 'info', msg: `Batch imported ${unique.length} custom domains` },
    });

    setBatchNotice(`${unique.length} ${t('sites.batchSuccess', 'domains successfully imported')}`);
    setBatchText('');
    setTimeout(() => setBatchNotice(''), 3500);
  };

  const filteredPresets = useMemo(() => {
    return presetSites.filter((site) => {
      const matchesCategory =
        selectedCategory === 'All' || site.category === selectedCategory;
      const query = searchQuery.trim().toLowerCase();
      const matchesQuery =
        !query ||
        site.label.toLowerCase().includes(query) ||
        site.host.toLowerCase().includes(query) ||
        (site.desc && site.desc.toLowerCase().includes(query));
      return matchesCategory && matchesQuery;
    });
  }, [presetSites, selectedCategory, searchQuery]);

  const activePresetsCount = presetSites.filter((s) => s.enabled).length;

  const handleCheckService = async (site, e) => {
    if (e) e.stopPropagation();
    setHealthMap((prev) => ({
      ...prev,
      [site.id]: { status: 'checking' },
    }));

    try {
      const primaryHost = site.host || (site.hosts && site.hosts[0]) || '';
      const res = await checkServiceHealth(primaryHost, 443);
      setHealthMap((prev) => ({
        ...prev,
        [site.id]: {
          status: res?.ok ? 'ok' : 'error',
          latency: res?.latency_ms || 0,
          error: res?.error,
        },
      }));
    } catch (err) {
      setHealthMap((prev) => ({
        ...prev,
        [site.id]: {
          status: 'error',
          latency: 0,
          error: err?.message || String(err),
        },
      }));
    }
  };

  const handleCheckAll = async () => {
    const targets = filteredPresets.slice(0, 16);
    setHealthMap((prev) => {
      const next = { ...prev };
      targets.forEach((s) => {
        next[s.id] = { status: 'checking' };
      });
      return next;
    });

    await Promise.all(
      targets.map(async (site) => {
        try {
          const primaryHost = site.host || (site.hosts && site.hosts[0]) || '';
          const res = await checkServiceHealth(primaryHost, 443);
          setHealthMap((prev) => ({
            ...prev,
            [site.id]: {
              status: res?.ok ? 'ok' : 'error',
              latency: res?.latency_ms || 0,
              error: res?.error,
            },
          }));
        } catch (err) {
          setHealthMap((prev) => ({
            ...prev,
            [site.id]: {
              status: 'error',
              latency: 0,
              error: err?.message || String(err),
            },
          }));
        }
      })
    );
  };

  const handleAddCustom = () => {
    const val = inputValue.trim().toLowerCase();
    if (!val) return;
    dispatch({ type: 'ADD_CUSTOM_DOMAIN', payload: val });
    setInputValue('');
    dispatch({
      type: 'ADD_LOG_ENTRY',
      payload: { level: 'info', msg: `Added custom domain: ${val}` },
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleAddCustom();
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {isVela && (
            <ClayIcon icon={clayIcons.sites} tint="#F2772F" size={42} />
          )}
          <div>
            <h1 className={styles.title}>{t('sites.title', 'AI Services & Routing')}</h1>
            <p className={styles.subtitle}>
            {t(
              'sites.subtitle',
              'Select neural networks, AI APIs, and endpoints to route through proxy.'
            )}
          </p>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === 'preset' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('preset')}
        >
          <Sparkles size={14} />
          {t('sites.title', 'AI & Neural Presets')}
          <span className="badge">
            {activePresetsCount}/{presetSites.length}
          </span>
        </button>

        <button
          type="button"
          className={`${styles.tab} ${activeTab === 'custom' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('custom')}
        >
          {t('sites.customDomainsTitle', 'Custom Domains')}
          <span className="badge">{customDomains.length}</span>
        </button>
      </div>

      {activeTab === 'preset' && (
        <div className={styles.presetSection}>
          {/* Controls: Search & Category Pills & Bulk Toggle */}
          <div className={styles.filterBar}>
            <div className={styles.searchBox}>
              <Search size={14} className={styles.searchIcon} />
              <input
                type="text"
                className="input"
                style={{ paddingLeft: '32px', height: '34px' }}
                placeholder={t('sites.searchPlaceholder', 'Search AI platforms or APIs...')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className={styles.bulkActions}>
              <button
                type="button"
                className="btn-secondary"
                style={{ height: '34px', fontSize: '12px', padding: '0 12px' }}
                onClick={handleCheckAll}
                title={t('sites.checkAllTooltip', 'Check latency for all listed services')}
              >
                <Activity size={12} />
                {t('sites.checkAll', 'Check All')}
              </button>
              <button
                type="button"
                className="btn-secondary"
                style={{ height: '34px', fontSize: '12px', padding: '0 12px' }}
                onClick={() => dispatch({ type: 'SET_ALL_PRESETS', payload: true })}
              >
                {t('sites.toggleAllOn', 'Enable All')}
              </button>
              <button
                type="button"
                className="btn-secondary"
                style={{ height: '34px', fontSize: '12px', padding: '0 12px' }}
                onClick={() => dispatch({ type: 'SET_ALL_PRESETS', payload: false })}
              >
                {t('sites.toggleAllOff', 'Disable All')}
              </button>
            </div>
          </div>

          {/* Category Filter Pills */}
          <div className={styles.categories}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`${styles.categoryPill} ${selectedCategory === cat ? styles.categoryActive : ''}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat === 'All' ? t('sites.allCategories', 'All') : cat}
              </button>
            ))}
          </div>

          {/* AI Services List */}
          <div className={styles.list}>
            {filteredPresets.map((site) => {
              const health = healthMap[site.id];
              return (
                <div
                  key={site.id}
                  className={`${styles.siteRow} ${site.enabled ? styles.siteRowActive : ''}`}
                  onClick={() => dispatch({ type: 'TOGGLE_PRESET_SITE', payload: site.id })}
                >
                  <div className={styles.siteInfo}>
                    <div className={styles.siteTitleRow}>
                      <span className={styles.siteName}>{site.label}</span>
                      <span className="badge">{site.category}</span>
                    </div>
                    <span className={styles.siteDesc}>{site.desc}</span>
                    <span className={`mono ${styles.siteHost}`}>
                      {site.hosts ? site.hosts.join(', ') : site.host}
                    </span>
                  </div>

                  <div className={styles.rowControls}>
                    <button
                      type="button"
                      className={`${styles.checkBtn} ${
                        health?.status ? styles[`checkBtn_${health.status}`] : ''
                      }`}
                      onClick={(e) => handleCheckService(site, e)}
                      disabled={health?.status === 'checking'}
                      title={
                        health?.error
                          ? `${health.error} (${t('sites.checkAgain', 'Click to re-test')})`
                          : health?.status === 'ok'
                          ? `${health.latency} ms (${t('sites.checkAgain', 'Click to re-test')})`
                          : t('sites.checkTooltip', 'Check latency & availability')
                      }
                    >
                      {health?.status === 'checking' ? (
                        <>
                          <RotateCw size={11} className={styles.spin} />
                          <span>{t('sites.checking', 'Wait...')}</span>
                        </>
                      ) : health?.status === 'ok' ? (
                        <>
                          <Check size={11} />
                          <span className="mono">{health.latency}ms</span>
                        </>
                      ) : health?.status === 'error' ? (
                        <>
                          <AlertTriangle size={11} />
                          <span>{t('sites.failed', 'Error')}</span>
                        </>
                      ) : (
                        <>
                          <Activity size={11} />
                          <span>{t('sites.check', 'Check')}</span>
                        </>
                      )}
                    </button>

                    <div
                      className={`${styles.toggle} ${site.enabled ? styles.toggleOn : ''}`}
                      role="switch"
                      aria-checked={site.enabled}
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        dispatch({ type: 'TOGGLE_PRESET_SITE', payload: site.id });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === ' ') {
                          e.stopPropagation();
                          dispatch({ type: 'TOGGLE_PRESET_SITE', payload: site.id });
                        }
                      }}
                    >
                      <span className={styles.toggleThumb} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'custom' && (
        <div className={styles.customSection}>
          <div className={styles.addRow}>
            <input
              type="text"
              className={`input ${styles.addInput}`}
              placeholder="e.g. notion.so, api.groq.com or *.ai-service.org"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button className={`btn-primary ${styles.addBtn}`} onClick={handleAddCustom}>
              <Plus size={15} />
              {t('sites.btnAddDomain', 'Add Domain')}
            </button>
            <button
              type="button"
              className={`${styles.batchToggleBtn} ${isBatchOpen ? styles.batchActive : ''}`}
              onClick={() => setIsBatchOpen((v) => !v)}
              title={t('sites.batchMode', 'Batch Import')}
            >
              <Layers size={13} />
              <span>{t('sites.batchMode', 'Batch Import')}</span>
            </button>
          </div>

          {/* Smart Domain Expander Suggestion Pill */}
          {matchedBundle && missingSuggestedDomains.length > 0 && (
            <div className={styles.smartSuggest}>
              <div className={styles.suggestTextGroup}>
                <Lightbulb size={14} className={styles.suggestIcon} />
                <span>
                  {t('sites.smartSuggestTitle', 'Related domains detected for')}{' '}
                  <strong>{matchedBundle.name}</strong>:{' '}
                  <span className={styles.suggestDomains}>{missingSuggestedDomains.join(', ')}</span>
                </span>
              </div>
              <button
                type="button"
                className={styles.suggestBtn}
                onClick={handleAddAllSuggested}
              >
                {t('sites.addAll', 'Add All')} (+{missingSuggestedDomains.length})
              </button>
            </div>
          )}

          {/* Batch Import Textarea Box */}
          {isBatchOpen && (
            <div className={styles.batchArea}>
              <textarea
                className={styles.batchTextarea}
                placeholder={t('sites.batchPlaceholder', 'Paste domain list separated by commas, spaces or newlines (e.g. notion.so, notion.site)')}
                value={batchText}
                onChange={(e) => setBatchText(e.target.value)}
              />
              <div className={styles.batchActions}>
                {batchNotice && (
                  <span style={{ fontSize: '11px', color: '#10B981', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <Check size={12} /> {batchNotice}
                  </span>
                )}
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleBatchImport}
                  style={{ height: '32px', padding: '0 14px', fontSize: '11px' }}
                >
                  {t('sites.batchImportBtn', 'Import Domains')}
                </button>
              </div>
            </div>
          )}

          {customDomains.length === 0 ? (
            <div className={styles.empty}>
              {t('sites.noCustomDomains', 'No custom domains added yet.')}
            </div>
          ) : (
            <div className={styles.list}>
              {customDomains.map((domain) => (
                <div key={domain} className={styles.domainRow}>
                  <span className={`mono ${styles.domainText}`}>{domain}</span>
                  <button
                    className="btn-icon"
                    onClick={() => dispatch({ type: 'REMOVE_CUSTOM_DOMAIN', payload: domain })}
                    aria-label={`Remove ${domain}`}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
