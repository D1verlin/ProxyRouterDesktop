/**
 * DnsSettings.jsx — DNS Management & Network Adapter Configuration.
 * Dark Monolith minimalist interface for DNS routing and network restoration.
 * Strictly adheres to Dark Monolith principles: no emojis, no neon glows,
 * symmetric 1px borders, static metrics in JetBrains Mono.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Globe,
  RefreshCw,
  Server,
  ShieldCheck,
  Check,
  Sliders,
  RotateCcw,
  AlertCircle,
  Network,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useTauri } from '../hooks/useTauri';
import styles from './DnsSettings.module.css';

const DNS_PRESETS = [
  {
    id: 'cloudflare',
    name: 'Cloudflare DNS',
    tag: 'Privacy & Fast Anycast',
    primary: '1.1.1.1',
    secondary: '1.0.0.1',
    v6: ['2606:4700:4700::1111', '2606:4700:4700::1001'],
    desc: 'Ultra-fast public resolver with strict privacy policy and zero logging.',
  },
  {
    id: 'cloudflare_sec',
    name: 'Cloudflare Security',
    tag: 'Malware & Threat Shield',
    primary: '1.1.1.2',
    secondary: '1.0.0.2',
    v6: ['2606:4700:4700::1112', '2606:4700:4700::1002'],
    desc: 'Blocks malicious domains, botnets, and known phishing threats automatically.',
  },
  {
    id: 'google',
    name: 'Google Public DNS',
    tag: 'Global Infrastructure',
    primary: '8.8.8.8',
    secondary: '8.8.4.4',
    v6: ['2001:4860:4860::8888', '2001:4860:4860::8844'],
    desc: 'Worldwide Anycast infrastructure with resilient query handling and DNSSEC validation.',
  },
  {
    id: 'quad9',
    name: 'Quad9',
    tag: 'Threat Intelligence & Swiss Privacy',
    primary: '9.9.9.9',
    secondary: '149.112.112.112',
    v6: ['2620:fe::fe', '2620:fe::9'],
    desc: 'Non-profit foundation based in Switzerland blocking infected hosts using multi-source intelligence.',
  },
  {
    id: 'adguard',
    name: 'AdGuard DNS',
    tag: 'Ad & Tracker Filtering',
    primary: '94.140.14.14',
    secondary: '94.140.15.15',
    v6: ['2a10:50c0::ad1:ff', '2a10:50c0::ad2:ff'],
    desc: 'Filters advertising networks, telemetry beacons, and analytical tracking scripts.',
  },
  {
    id: 'opendns',
    name: 'OpenDNS (Cisco)',
    tag: 'Cisco Anycast',
    primary: '208.67.222.222',
    secondary: '208.67.220.220',
    v6: ['2620:119:35::35', '2620:119:53::53'],
    desc: 'Enterprise DNS resolution powered by Cisco Umbrella security intelligence.',
  },
];

export default function DnsSettings() {
  const { t, dispatch } = useAppStore();
  const {
    getNetworkAdapters,
    setActiveDns,
    applyAdapterDns,
    resetAdapterDns,
    testDnsLatency,
    restoreNetworkDefaults,
  } = useTauri();

  const [activeProviderId, setActiveProviderId] = useState(() => {
    return localStorage.getItem('proxy_router_dns_provider') || 'cloudflare';
  });

  const [latencies, setLatencies] = useState({});
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [adapters, setAdapters] = useState([]);
  const [selectedAdapterIndex, setSelectedAdapterIndex] = useState(null);
  const [customPrimary, setCustomPrimary] = useState('');
  const [customSecondary, setCustomSecondary] = useState('');
  const [statusNotice, setStatusNotice] = useState(null);
  const [isRestoring, setIsRestoring] = useState(false);

  // Load adapters on mount
  const refreshAdapters = useCallback(async () => {
    try {
      const list = await getNetworkAdapters();
      if (Array.isArray(list)) {
        setAdapters(list);
        setSelectedAdapterIndex((prev) => prev ?? (list.length > 0 ? list[0].index : null));
      }
    } catch (err) {
      console.warn('Failed loading network adapters:', err);
    }
  }, [getNetworkAdapters]);

  // Test UDP latency to all DNS providers
  const measureAllLatencies = useCallback(async (extraServer = null) => {
    setIsMeasuring(true);
    setStatusNotice(null);

    const serversToTest = DNS_PRESETS.map((p) => p.primary);
    const custom = (extraServer || customPrimary || '').trim();
    if (custom && !serversToTest.includes(custom)) {
      serversToTest.push(custom);
    }

    try {
      const results = await testDnsLatency(serversToTest);
      const newLatencies = {};
      if (Array.isArray(results)) {
        results.forEach((r) => {
          if (r.latency_ms !== null && r.latency_ms !== undefined) {
            newLatencies[r.server] = r.latency_ms;
          }
        });
      }
      setLatencies(newLatencies);
    } catch (err) {
      console.warn('Failed testing DNS latency:', err);
    } finally {
      setIsMeasuring(false);
    }
  }, [testDnsLatency, customPrimary]);

  // Initial load on mount
  useEffect(() => {
    refreshAdapters();
    measureAllLatencies();
  }, [refreshAdapters, measureAllLatencies]);

  // Select provider for internal forwarder
  const handleSelectProvider = useCallback(
    async (preset) => {
      try {
        await setActiveDns(preset.id, [preset.primary, preset.secondary], preset.v6 || []);
        setActiveProviderId(preset.id);
        localStorage.setItem('proxy_router_dns_provider', preset.id);
        setStatusNotice({
          type: 'success',
          msg: `${t('dns.activeProvider', 'Active Provider')}: ${preset.name}`,
        });
        dispatch({
          type: 'ADD_LOG_ENTRY',
          payload: {
            category: 'NET',
            level: 'info',
            msg: `Forwarder DNS set to ${preset.name} (${preset.primary}, ${preset.secondary})`,
          },
        });
      } catch (err) {
        setStatusNotice({
          type: 'error',
          msg: `Failed to set active DNS: ${err.message || err}`,
        });
      }
    },
    [setActiveDns, dispatch, t]
  );

  // Apply chosen preset to selected Windows network adapter
  const handleApplyToAdapter = useCallback(
    async (preset) => {
      if (!selectedAdapterIndex && selectedAdapterIndex !== 0) {
        setStatusNotice({
          type: 'error',
          msg: t('dns.selectAdapter', 'Please select a network adapter first.'),
        });
        return;
      }
      try {
        await applyAdapterDns(
          selectedAdapterIndex,
          [preset.primary, preset.secondary],
          preset.v6 || []
        );
        await refreshAdapters();
        setStatusNotice({
          type: 'success',
          msg: t('dns.appliedToAdapter', 'Applied DNS to network adapter successfully.'),
        });
        dispatch({
          type: 'ADD_LOG_ENTRY',
          payload: {
            category: 'NET',
            level: 'info',
            msg: `Applied ${preset.name} (${preset.primary}) to adapter index ${selectedAdapterIndex}`,
          },
        });
      } catch (err) {
        setStatusNotice({
          type: 'error',
          msg: `Failed to apply DNS to adapter: ${err.message || err}`,
        });
      }
    },
    [selectedAdapterIndex, applyAdapterDns, refreshAdapters, dispatch, t]
  );

  // Reset adapter DNS to automatic (DHCP)
  const handleResetAdapter = useCallback(
    async (index) => {
      try {
        await resetAdapterDns(index);
        await refreshAdapters();
        setStatusNotice({
          type: 'success',
          msg: t('dns.resetSuccess', 'Adapter DNS reset to automatic (DHCP).'),
        });
        dispatch({
          type: 'ADD_LOG_ENTRY',
          payload: {
            category: 'NET',
            level: 'info',
            msg: `Reset adapter index ${index} DNS to DHCP`,
          },
        });
      } catch (err) {
        setStatusNotice({
          type: 'error',
          msg: `Failed to reset adapter DNS: ${err.message || err}`,
        });
      }
    },
    [resetAdapterDns, refreshAdapters, dispatch, t]
  );

  // Apply custom DNS
  const handleApplyCustom = useCallback(async () => {
    const p = customPrimary.trim();
    const s = customSecondary.trim();
    if (!p) return;

    try {
      const v4List = s ? [p, s] : [p];
      await setActiveDns('custom', v4List, []);
      setActiveProviderId('custom');
      localStorage.setItem('proxy_router_dns_provider', 'custom');
      setStatusNotice({
        type: 'success',
        msg: `Custom DNS activated: ${v4List.join(', ')}`,
      });
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: {
          category: 'NET',
          level: 'info',
          msg: `Custom forwarder DNS configured: ${v4List.join(', ')}`,
        },
      });
    } catch (err) {
      setStatusNotice({
        type: 'error',
        msg: `Failed to apply custom DNS: ${err.message || err}`,
      });
    }
  }, [customPrimary, customSecondary, setActiveDns, dispatch]);

  // Full clean restore
  const handleRestoreDefaults = useCallback(async () => {
    setIsRestoring(true);
    setStatusNotice(null);
    try {
      await restoreNetworkDefaults();
      setActiveProviderId('cloudflare');
      localStorage.setItem('proxy_router_dns_provider', 'cloudflare');
      await refreshAdapters();
      setStatusNotice({
        type: 'success',
        msg: t(
          'dns.cleanRestored',
          'All network settings, IPv6 defaults, and environment variables restored.'
        ),
      });
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: {
          category: 'SYS',
          level: 'info',
          msg: 'Full network restoration executed: adapter DNS, IPv6, env vars cleaned',
        },
      });
    } catch (err) {
      setStatusNotice({
        type: 'error',
        msg: `Network restoration error: ${err.message || err}`,
      });
    } finally {
      setIsRestoring(false);
    }
  }, [restoreNetworkDefaults, refreshAdapters, dispatch, t]);

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <h1 className={styles.title}>{t('dns.title', 'DNS Resolvers & Routing')}</h1>
          <p className={styles.subtitle}>
            {t(
              'dns.subtitle',
              'Manage upstream DNS servers, measure UDP query latency, and configure Windows adapter resolvers.'
            )}
          </p>
        </div>

        <div className={styles.headerActions}>
          <button
            className="btn btn-secondary"
            onClick={measureAllLatencies}
            disabled={isMeasuring}
          >
            <RefreshCw
              size={14}
              strokeWidth={1.8}
              className={isMeasuring ? styles.spinning : ''}
            />
            {isMeasuring
              ? t('dns.measuring', 'Measuring...')
              : t('dns.measureLatency', 'Measure Latency')}
          </button>
        </div>
      </div>

      {/* Notice / Feedback */}
      {statusNotice && (
        <div
          className={`${styles.notice} ${
            statusNotice.type === 'error' ? styles.error : styles.success
          }`}
        >
          {statusNotice.type === 'error' ? (
            <AlertCircle size={15} strokeWidth={1.8} />
          ) : (
            <Check size={15} strokeWidth={1.8} />
          )}
          <span>{statusNotice.msg}</span>
        </div>
      )}

      {/* Global Presets Grid */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>
            {t('dns.providersTitle', 'Global DNS Presets')}
          </span>
          <span className={styles.sectionSubtitle}>
            {DNS_PRESETS.length} {t('dns.serversCount', 'servers')}
          </span>
        </div>

        <div className={styles.presetsGrid}>
          {DNS_PRESETS.map((preset) => {
            const isActive = activeProviderId === preset.id;
            const latency = latencies[preset.primary];

            return (
              <div
                key={preset.id}
                className={`${styles.presetCard} ${
                  isActive ? styles.presetCardActive : ''
                }`}
              >
                <div className={styles.cardTop}>
                  <div className={styles.presetInfo}>
                    <div className={styles.presetTitleRow}>
                      <span className={styles.presetName}>{preset.name}</span>
                      {isActive && (
                        <span className={styles.activeBadge}>
                          {t('common.active', 'Active')}
                        </span>
                      )}
                    </div>
                    <span className={styles.presetDesc}>{preset.desc}</span>
                  </div>

                  {latency !== undefined && (
                    <div className={styles.latencyBadge} title="UDP RTT">
                      <span>{latency} ms</span>
                    </div>
                  )}
                </div>

                <div className={styles.ipsBlock}>
                  <div className={styles.ipRow}>
                    <span>IPv4 Primary</span>
                    <span className={styles.ipVal}>{preset.primary}</span>
                  </div>
                  <div className={styles.ipRow}>
                    <span>IPv4 Secondary</span>
                    <span className={styles.ipVal}>{preset.secondary}</span>
                  </div>
                </div>

                <div className={styles.cardActions}>
                  <button
                    className={`btn ${isActive ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => handleSelectProvider(preset)}
                  >
                    {isActive ? (
                      <>
                        <Check size={14} strokeWidth={2} />
                        {t('common.active', 'Active')}
                      </>
                    ) : (
                      <>
                        <Server size={14} strokeWidth={1.8} />
                        {t('dns.applyToForwarder', 'Use for Forwarder')}
                      </>
                    )}
                  </button>

                  <button
                    className="btn btn-secondary"
                    onClick={() => handleApplyToAdapter(preset)}
                    title={t('dns.applyToAdapter', 'Apply to Windows Adapter')}
                  >
                    <Network size={14} strokeWidth={1.8} />
                    {t('dns.applyToAdapter', 'Apply to Adapter')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Network Adapters Section */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>
            {t('dns.adapterTitle', 'Windows Network Adapters')}
          </span>
          <span className={styles.sectionSubtitle}>
            {t(
              'dns.adapterSubtitle',
              'Directly configure DNS addresses on physical and virtual network adapters.'
            )}
          </span>
        </div>

        <div className={styles.cardBlock}>
          {adapters.length === 0 ? (
            <div style={{ color: 'var(--text-sec)', fontSize: 13 }}>
              Scanning active network adapters...
            </div>
          ) : (
            <div className={styles.adapterList}>
              {adapters.map((adapter) => {
                const isSelected = selectedAdapterIndex === adapter.index;
                const dnsList = Array.isArray(adapter?.ipv4_dns) ? adapter.ipv4_dns.filter(Boolean) : [];
                const dnsDisplay =
                  dnsList.length > 0 ? dnsList.join(', ') : t('dns.adapterDhcp', 'DHCP (Automatic)');

                return (
                  <div
                    key={adapter.index}
                    className={styles.adapterRow}
                    style={{
                      borderColor: isSelected
                        ? 'rgba(255, 255, 255, 0.35)'
                        : 'var(--border)',
                    }}
                  >
                    <div className={styles.adapterMeta}>
                      <div className={styles.adapterNameRow}>
                        <span className={styles.adapterName}>{adapter.name}</span>
                        <span className={styles.adapterIndex}>
                          Index #{adapter.index}
                        </span>
                        {adapter.is_dhcp && (
                          <span
                            className={styles.activeBadge}
                            style={{
                              background: 'transparent',
                              border: '1px solid var(--border)',
                              color: 'var(--text-sec)',
                            }}
                          >
                            DHCP
                          </span>
                        )}
                      </div>
                      <span className={styles.adapterDesc} title={adapter.description}>
                        {adapter.description}
                      </span>
                    </div>

                    <div className={styles.adapterDnsList}>
                      <span>DNS: {dnsDisplay}</span>
                    </div>

                    <div className={styles.adapterActions}>
                      <button
                        className={`btn ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setSelectedAdapterIndex(adapter.index)}
                      >
                        {isSelected ? 'Targeted' : 'Select'}
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={() => handleResetAdapter(adapter.index)}
                        title={t('dns.resetDhcp', 'Reset to DHCP')}
                      >
                        <RotateCcw size={13} strokeWidth={1.8} />
                        {t('dns.resetDhcp', 'Reset to DHCP')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Custom DNS Configuration */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>
            {t('dns.customTitle', 'Custom DNS Configuration')}
          </span>
          <span className={styles.sectionSubtitle}>
            {t(
              'dns.customSubtitle',
              'Specify your own primary and secondary DNS server IPv4 addresses.'
            )}
          </span>
        </div>

        <div className={styles.cardBlock}>
          <div className={styles.customForm}>
            <div className={styles.customField}>
              <label className={styles.customLabel}>
                {t('dns.primaryDns', 'Primary DNS IPv4')}
              </label>
              <input
                type="text"
                className={styles.customInput}
                placeholder="e.g. 1.1.1.1"
                value={customPrimary}
                onChange={(e) => setCustomPrimary(e.target.value)}
              />
            </div>

            <div className={styles.customField}>
              <label className={styles.customLabel}>
                {t('dns.secondaryDns', 'Secondary DNS IPv4')}
              </label>
              <input
                type="text"
                className={styles.customInput}
                placeholder="e.g. 1.0.0.1"
                value={customSecondary}
                onChange={(e) => setCustomSecondary(e.target.value)}
              />
            </div>

            <button
              className="btn btn-secondary"
              onClick={handleApplyCustom}
              disabled={!customPrimary.trim()}
            >
              <Sliders size={14} strokeWidth={1.8} />
              {t('dns.customApply', 'Apply Custom DNS')}
            </button>
          </div>
        </div>
      </div>

      {/* Clean Restore Card */}
      <div className={styles.section}>
        <div className={styles.restoreCard}>
          <div className={styles.restoreInfo}>
            <span className={styles.restoreTitle}>
              {t('dns.cleanRestoreTitle', 'Full Network Recovery & Restoration')}
            </span>
            <span className={styles.restoreDesc}>
              {t(
                'dns.cleanRestoreDesc',
                'Completely resets all adapter DNS back to DHCP, cleans proxy environment variables, flushes Windows DNS cache, and restores IPv6 defaults.'
              )}
            </span>
          </div>

          <button
            className="btn btn-secondary"
            onClick={handleRestoreDefaults}
            disabled={isRestoring}
          >
            <RotateCcw
              size={14}
              strokeWidth={1.8}
              className={isRestoring ? styles.spinning : ''}
            />
            {isRestoring
              ? t('dns.cleanRestoring', 'Restoring network...')
              : t('dns.btnCleanRestore', 'Restore Clean Network Defaults')}
          </button>
        </div>
      </div>
    </div>
  );
}
