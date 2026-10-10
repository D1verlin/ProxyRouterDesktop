/**
 * Whitelist page — View and manage allowed IPs on Squid proxy server.
 * Redesigned with pixel-perfect uniform button and row dimensions.
 */

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Plus, Trash2, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import styles from './Whitelist.module.css';

export default function Whitelist() {
  const { state, dispatch, t } = useAppStore();
  const { serverConfig, publicIp } = state;
  const [ips, setIps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [manualIp, setManualIp] = useState('');
  const [notice, setNotice] = useState(null);

  const normalizedUrl = (serverConfig.apiUrl || '').replace(/\/+$/, '');

  const fetchWhitelist = useCallback(async () => {
    if (!normalizedUrl || !serverConfig.authToken) {
      setNotice({
        type: 'warn',
        text: t(
          'whitelist.statusError',
          'Configure API URL and Token in Settings first'
        ),
      });
      return;
    }

    setLoading(true);
    setNotice(null);
    try {
      const res = await fetch(`${normalizedUrl}/api/whitelist`, {
        headers: { Authorization: `Bearer ${serverConfig.authToken}` },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        throw new Error(
          res.status === 401 ? 'Unauthorized (Invalid Token)' : `HTTP ${res.status}`
        );
      }

      const data = await res.json();
      const list = Array.isArray(data.ips) ? data.ips : [];
      setIps(list);
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: {
          category: 'AUTH',
          level: 'info',
          msg: `Fetched ${list.length} whitelist entries from Squid`,
        },
      });
    } catch (err) {
      setNotice({ type: 'error', text: `Failed to load whitelist: ${err.message}` });
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: {
          category: 'AUTH',
          level: 'error',
          msg: `Whitelist fetch failed: ${err.message}`,
        },
      });
    } finally {
      setLoading(false);
    }
  }, [normalizedUrl, serverConfig.authToken, dispatch, t]);

  const handleAddIp = async (ipToAdd) => {
    const target = (ipToAdd || manualIp).trim();
    if (!target) return;

    setLoading(true);
    setNotice(null);
    try {
      const res = await fetch(`${normalizedUrl}/api/whitelist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serverConfig.authToken}`,
        },
        body: JSON.stringify({ ip: target }),
        signal: AbortSignal.timeout(6000),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      setManualIp('');
      setNotice({
        type: 'success',
        text: `IP ${target} ${t('whitelist.statusSuccess', 'successfully authorized in Squid')}`,
      });
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: {
          category: 'AUTH',
          level: 'info',
          msg: `IP ${target} added to Squid whitelist`,
        },
      });
      await fetchWhitelist();
    } catch (err) {
      setNotice({ type: 'error', text: `Could not add IP: ${err.message}` });
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: {
          category: 'AUTH',
          level: 'error',
          msg: `Add IP ${target} failed: ${err.message}`,
        },
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveIp = async (ipToRemove) => {
    setLoading(true);
    setNotice(null);
    try {
      const res = await fetch(`${normalizedUrl}/api/whitelist`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serverConfig.authToken}`,
        },
        body: JSON.stringify({ ip: ipToRemove }),
        signal: AbortSignal.timeout(6000),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      setNotice({
        type: 'success',
        text: `IP ${ipToRemove} removed from whitelist`,
      });
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: {
          category: 'AUTH',
          level: 'info',
          msg: `IP ${ipToRemove} removed from whitelist`,
        },
      });
      await fetchWhitelist();
    } catch (err) {
      setNotice({ type: 'error', text: `Could not remove IP: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWhitelist();
  }, [fetchWhitelist]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('whitelist.title', 'Server Whitelist')}</h1>
          <p className={styles.subtitle}>
            {t(
              'whitelist.subtitle',
              'Authorized IP addresses allowed to route through Squid proxy.'
            )}
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          style={{ height: '32px', fontSize: '12px', padding: '0 12px' }}
          onClick={fetchWhitelist}
          disabled={loading}
        >
          <RefreshCw size={13} className={loading ? styles.spinning : ''} />
          {t('common.refresh', 'Refresh')}
        </button>
      </header>

      {/* Manual Input Card */}
      <div className={styles.addCard}>
        <div className={styles.inputRow}>
          <input
            type="text"
            className={`input ${styles.ipInput} mono`}
            placeholder="Enter IPv4 address (e.g. 178.120.53.202)"
            value={manualIp}
            onChange={(e) => setManualIp(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddIp()}
          />
          <button
            type="button"
            className="btn-primary"
            style={{ height: '34px', fontSize: '13px', padding: '0 16px' }}
            onClick={() => handleAddIp()}
            disabled={loading || !manualIp.trim()}
          >
            <Plus size={14} />
            {t('common.add', 'Add')} IP
          </button>
        </div>

        {/* Current IP Suggestion Bar */}
        {publicIp && !ips.includes(publicIp) && (
          <div className={styles.currentIpRow}>
            <div className={styles.currentIpText}>
              <span>{t('whitelist.ipCardTitle', 'Detected WAN IP')}:</span>
              <strong className="mono">{publicIp}</strong>
              <span className={styles.unlistedTag}>(not whitelisted)</span>
            </div>
            <button
              type="button"
              className="btn-secondary"
              style={{ height: '28px', fontSize: '11px', padding: '0 10px' }}
              onClick={() => handleAddIp(publicIp)}
              disabled={loading}
            >
              + {t('whitelist.btnSync', 'Whitelist My IP')}
            </button>
          </div>
        )}
      </div>

      {/* Notice */}
      {notice && (
        <div className={`${styles.notice} ${styles[notice.type]}`}>
          {notice.text}
        </div>
      )}

      {/* List Header */}
      <div className={styles.listHeader}>
        <span className={styles.countLabel}>
          {t('whitelist.historyTitle', 'Allowed Addresses')}
        </span>
        <span className="badge">{ips.length}</span>
      </div>

      {/* Whitelist Rows */}
      {ips.length === 0 ? (
        <div className={styles.empty}>
          {loading
            ? 'Reading whitelist from Squid server...'
            : t('whitelist.noHistory', 'No IP addresses found in server whitelist.')}
        </div>
      ) : (
        <div className={styles.list}>
          {ips.map((ip) => {
            const isCurrent = ip === publicIp;
            return (
              <div key={ip} className={styles.ipRow}>
                <div className={styles.ipLeft}>
                  <ShieldCheck size={14} className={styles.shieldIcon} />
                  <span className={`mono ${styles.ipAddress}`}>{ip}</span>
                  {isCurrent && (
                    <span className="badge active">
                      <CheckCircle2 size={10} style={{ marginRight: 4 }} />
                      Your Device
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  className="btn-icon"
                  style={{ width: '28px', height: '28px' }}
                  onClick={() => handleRemoveIp(ip)}
                  aria-label={`Remove IP ${ip}`}
                  title={`Remove IP ${ip}`}
                  disabled={loading}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
