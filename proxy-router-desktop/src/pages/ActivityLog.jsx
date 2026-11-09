/**
 * ActivityLog — Telemetry, Network Activity, and Event Auditing screen.
 * Displays categorised events [NET], [AUTH], [SYS], [PAC], [PROC] with millisecond timestamps,
 * and live network traffic metrics and intercepted forwarder sessions.
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Trash2,
  Copy,
  Check,
  Search,
  ScrollText,
  Activity,
  ArrowDown,
  ArrowUp,
  Radio,
  Globe,
  Shield,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useTauri } from '../hooks/useTauri';
import { clayIcons } from '../assets/clayIcons';
import ClayIcon from '../components/ClayIcon';
import styles from './ActivityLog.module.css';

const CATEGORIES = ['ALL', 'NET', 'AUTH', 'SYS', 'PAC', 'PROC', 'CLI'];

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 B/s';
  const k = 1024;
  if (bytesPerSec < k) return `${Math.round(bytesPerSec)} B/s`;
  if (bytesPerSec < k * k) return `${(bytesPerSec / k).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (k * k)).toFixed(2)} MB/s`;
}

function formatTime(timestamp) {
  if (!timestamp) return '—';
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
  if (diff < 5) return 'Just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  const d = new Date(timestamp * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function ActivityLog() {
  const { state, dispatch, t } = useAppStore();
  const { getTrafficStats } = useTauri();
  const isVela = state.customization?.theme === 'vela';
  const { log } = state;

  const [activeTab, setActiveTab] = useState('events'); // 'events' | 'network'
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sessionSearch, setSessionSearch] = useState('');
  const [copied, setCopied] = useState(false);

  // Live Traffic Stats
  const [stats, setStats] = useState({
    total_rx_bytes: 0,
    total_tx_bytes: 0,
    active_connections: 0,
    recent_sessions: [],
  });
  const [speeds, setSpeeds] = useState({ down: 0, up: 0 });
  const prevRef = useRef({ rx: 0, tx: 0, time: Date.now() });

  useEffect(() => {
    let active = true;

    const pollStats = async () => {
      try {
        const data = await getTrafficStats();
        if (!active || !data) return;

        const now = Date.now();
        const dt = Math.max(0.5, (now - prevRef.current.time) / 1000);

        const currentRx = data.total_rx_bytes || 0;
        const currentTx = data.total_tx_bytes || 0;

        const deltaRx = Math.max(0, currentRx - prevRef.current.rx);
        const deltaTx = Math.max(0, currentTx - prevRef.current.tx);

        setSpeeds({
          down: deltaRx / dt,
          up: deltaTx / dt,
        });

        prevRef.current = { rx: currentRx, tx: currentTx, time: now };
        setStats(data);
      } catch (err) {
        console.warn('[ActivityLog] Failed fetching traffic stats:', err);
      }
    };

    pollStats();
    const interval = setInterval(pollStats, 1400);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [getTrafficStats]);

  const filteredLog = useMemo(() => {
    return log.filter((entry) => {
      const matchCat =
        activeCategory === 'ALL' || (entry.category && entry.category === activeCategory);
      const query = searchQuery.trim().toLowerCase();
      const matchQuery =
        !query ||
        entry.msg.toLowerCase().includes(query) ||
        (entry.details && JSON.stringify(entry.details).toLowerCase().includes(query));
      return matchCat && matchQuery;
    });
  }, [log, activeCategory, searchQuery]);

  const filteredSessions = useMemo(() => {
    const list = stats.recent_sessions || [];
    const q = sessionSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) => s.host && s.host.toLowerCase().includes(q));
  }, [stats.recent_sessions, sessionSearch]);

  const handleCopyAll = () => {
    if (log.length === 0) return;
    const text = log
      .map(
        (e) =>
          `[${e.ts}] [${e.category || 'SYS'}] [${(e.level || 'INFO').toUpperCase()}] ${e.msg}`
      )
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {isVela && (
            <ClayIcon icon={clayIcons.logs} tint="#F43F5E" size={42} />
          )}
          <div>
            <h1 className={styles.title}>{t('log.title', 'Activity & Telemetry Log')}</h1>
            <p className={styles.subtitle}>
              {t(
                'log.subtitle',
                'Real-time audit log of proxy tunnels, routing events, and live network telemetry.'
              )}
            </p>
          </div>
        </div>

        {activeTab === 'events' && (
          <div className={styles.topActions}>
            <button
              type="button"
              className="btn-secondary"
              style={{ height: '32px', fontSize: '12px', padding: '0 12px' }}
              onClick={handleCopyAll}
              disabled={log.length === 0}
              title="Copy entire log to clipboard"
            >
              {copied ? <Check size={13} color="#ffffff" /> : <Copy size={13} />}
              {copied ? t('common.copied', 'Copied') : t('common.copy', 'Copy All')}
            </button>

            <button
              type="button"
              className="btn-secondary"
              style={{ height: '32px', fontSize: '12px', padding: '0 12px' }}
              onClick={() => dispatch({ type: 'CLEAR_LOG' })}
              disabled={log.length === 0}
              title="Clear all recorded entries"
            >
              <Trash2 size={13} />
              {t('log.btnClear', 'Clear Log')}
            </button>
          </div>
        )}
      </header>

      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === 'events' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('events')}
        >
          <ScrollText size={14} />
          <span>{t('log.eventsTab', 'Event Log')}</span>
          <span className="badge">{log.length}</span>
        </button>

        <button
          type="button"
          className={`${styles.tab} ${activeTab === 'network' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('network')}
        >
          <Activity size={14} />
          <span>{t('log.networkTab', 'Network Activity')}</span>
          <span className={styles.livePill}>LIVE</span>
        </button>
      </div>

      {/* Tab: Event Log */}
      {activeTab === 'events' && (
        <>
          {/* Filter and Search Bar */}
          <div className={styles.filterBar}>
            <div className={styles.searchBox}>
              <Search size={14} className={styles.searchIcon} />
              <input
                type="text"
                className="input"
                style={{ paddingLeft: '32px', height: '32px', fontSize: '12px' }}
                placeholder="Search events, IPs, paths..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className={styles.categories}>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`${styles.catPill} ${activeCategory === cat ? styles.catPillActive : ''}`}
                  onClick={() => setActiveCategory(cat)}
                >
                  {cat === 'ALL' ? t('log.filterAll', 'ALL') : cat}
                </button>
              ))}
            </div>
          </div>

          {/* Log Feed */}
          {filteredLog.length === 0 ? (
            <div className={styles.empty}>
              {log.length === 0
                ? t('log.noLogs', 'Log is empty.')
                : 'No log entries match your current filter.'}
            </div>
          ) : (
            <div className={styles.feed}>
              {filteredLog.map((entry) => {
                const level = (entry.level || 'info').toLowerCase();
                return (
                  <div key={entry.id} className={styles.row}>
                    <span className={`mono ${styles.ts}`}>{entry.ts}</span>

                    <span
                      className={`${styles.catBadge} ${styles[`cat_${entry.category || 'SYS'}`]}`}
                    >
                      [{entry.category || 'SYS'}]
                    </span>

                    <span className={`${styles.levelBadge} ${styles[level]}`}>
                      {level.toUpperCase()}
                    </span>

                    <span className={styles.msg}>{entry.msg}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Tab: Network Activity (Telemetry & Active Sessions) */}
      {activeTab === 'network' && (
        <div className={styles.networkView}>
          {/* Hero Metrics Row */}
          <div className={styles.metricsGrid}>
            <div className={styles.metricCard}>
              <div className={styles.metricLabel}>
                <ArrowDown size={13} color="#22C55E" />
                <span>{t('log.speedDown', 'Download')}</span>
              </div>
              <div className={`${styles.metricVal} ${styles.valDown}`}>
                {formatSpeed(speeds.down)}
              </div>
            </div>

            <div className={styles.metricCard}>
              <div className={styles.metricLabel}>
                <ArrowUp size={13} color="#3B82F6" />
                <span>{t('log.speedUp', 'Upload')}</span>
              </div>
              <div className={`${styles.metricVal} ${styles.valUp}`}>
                {formatSpeed(speeds.up)}
              </div>
            </div>

            <div className={styles.metricCard}>
              <div className={styles.metricLabel}>
                <Radio size={13} color="#F59E0B" />
                <span>{t('log.sockets', 'Active Sockets')}</span>
              </div>
              <div className={styles.metricVal}>
                {stats.active_connections}
              </div>
            </div>

            <div className={styles.metricCard}>
              <div className={styles.metricLabel}>
                <Globe size={13} color="var(--text-sec)" />
                <span>{t('log.totalData', 'Total Data')}</span>
              </div>
              <div className={styles.metricVal}>
                {formatBytes(stats.total_rx_bytes + stats.total_tx_bytes)}
              </div>
            </div>
          </div>

          {/* Sessions Section */}
          <div className={styles.sessionsContainer}>
            <div className={styles.sessionsHeader}>
              <div className={styles.sessionsTitleLine}>
                <Activity size={14} color="var(--text-sec)" />
                <span className={styles.sessionsTitle}>
                  {t('log.sessionsFeed', 'Live Intercepted Traffic Feed')}
                </span>
                <span className="badge">{stats.recent_sessions?.length || 0}</span>
              </div>

              <div className={styles.sessionSearchBox}>
                <Search size={13} className={styles.searchIcon} />
                <input
                  type="text"
                  className="input"
                  style={{ paddingLeft: '30px', height: '30px', fontSize: '11px', width: '220px' }}
                  placeholder={t('log.searchSessions', 'Filter by host...')}
                  value={sessionSearch}
                  onChange={(e) => setSessionSearch(e.target.value)}
                />
              </div>
            </div>

            {filteredSessions.length === 0 ? (
              <div className={styles.emptySessions}>
                {t('log.noSessions', 'No network traffic recorded yet')}
              </div>
            ) : (
              <div className={styles.sessionsTable}>
                <div className={styles.tableHeader}>
                  <span className={styles.colHost}>Host</span>
                  <span className={styles.colRoute}>Routing</span>
                  <span className={styles.colBytes}>Transferred</span>
                  <span className={styles.colTime}>Time</span>
                </div>
                <div className={styles.tableBody}>
                  {filteredSessions.map((session, idx) => (
                    <div key={`${session.host}_${session.timestamp}_${idx}`} className={styles.sessionRow}>
                      <span className={`mono ${styles.colHost} ${styles.hostText}`}>
                        {session.host}
                      </span>
                      <span className={styles.colRoute}>
                        <span
                          className={`${styles.routeBadge} ${
                            session.proxied ? styles.badgeProxied : styles.badgeDirect
                          }`}
                        >
                          {session.proxied ? 'PROXIED' : 'DIRECT'}
                        </span>
                      </span>
                      <span className={`mono ${styles.colBytes}`}>
                        {formatBytes(session.bytes)}
                      </span>
                      <span className={styles.colTime}>
                        {formatTime(session.timestamp)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
