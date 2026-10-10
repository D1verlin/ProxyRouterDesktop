/**
 * Sites page — AI & Neural Network Services Routing.
 * Manages neural platform rules, APIs, and custom domains.
 */

import { useState, useMemo } from 'react';
import { Plus, X, Search, Sparkles } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import styles from './Sites.module.css';

const CATEGORIES = ['All', 'Google AI', 'OpenAI', 'Anthropic', 'Inference'];

export default function Sites() {
  const { state, dispatch, t } = useAppStore();
  const { presetSites, customDomains } = state;

  const [inputValue, setInputValue] = useState('');
  const [activeTab, setActiveTab] = useState('preset');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

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
        <div>
          <h1 className={styles.title}>
            {t('sites.title', 'AI Services & Routing')}
          </h1>
          <p className={styles.subtitle}>
            {t(
              'sites.subtitle',
              'Select neural networks, AI APIs, and endpoints to route through proxy.'
            )}
          </p>
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
            {filteredPresets.map((site) => (
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
            ))}
          </div>
        </div>
      )}

      {activeTab === 'custom' && (
        <div className={styles.customSection}>
          <div className={styles.addRow}>
            <input
              type="text"
              className={`input ${styles.addInput}`}
              placeholder="e.g. api.groq.com or *.ai-service.org"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button className={`btn-primary ${styles.addBtn}`} onClick={handleAddCustom}>
              <Plus size={15} />
              {t('sites.btnAddDomain', 'Add Domain')}
            </button>
          </div>

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
