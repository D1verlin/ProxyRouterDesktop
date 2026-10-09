/**
 * ActivityLog — Granular telemetry and event auditing screen.
 * Displays categorised events [NET], [AUTH], [SYS], [PAC], [PROC] with millisecond timestamps.
 */

import { useState, useMemo } from 'react';
import { Trash2, Copy, Check, Search, Filter } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import styles from './ActivityLog.module.css';

const CATEGORIES = ['ALL', 'NET', 'AUTH', 'SYS', 'PAC', 'PROC', 'CLI'];

export default function ActivityLog() {
  const { state, dispatch } = useAppStore();
  const { log } = state;

  const [activeCategory, setActiveCategory] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);

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

  const handleCopyAll = () => {
    if (log.length === 0) return;
    const text = log
      .map(e => `[${e.ts}] [${e.category || 'SYS'}] [${(e.level || 'INFO').toUpperCase()}] ${e.msg}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Activity Telemetry Log</h1>
          <p className={styles.subtitle}>Granular routing audits, network handshakes, and system events.</p>
        </div>

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
            {copied ? 'Copied' : 'Copy All'}
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
            Clear
          </button>
        </div>
      </header>

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
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Log Feed */}
      {filteredLog.length === 0 ? (
        <div className={styles.empty}>
          {log.length === 0
            ? 'No activity recorded yet. System events will appear here in real time.'
            : 'No log entries match your current filter.'}
        </div>
      ) : (
        <div className={styles.feed}>
          {filteredLog.map((entry) => {
            const level = (entry.level || 'info').toLowerCase();
            return (
              <div key={entry.id} className={styles.row}>
                <span className={`mono ${styles.ts}`}>{entry.ts}</span>

                <span className={`${styles.catBadge} ${styles[`cat_${entry.category || 'SYS'}`]}`}>
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
    </div>
  );
}
