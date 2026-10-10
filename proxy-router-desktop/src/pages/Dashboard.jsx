/**
 * Dashboard — 3D Planetary visualizer, proxy control, and real external IPv4 display.
 * Includes strict connection and configuration validation before allowing proxy activation.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { useAppStore, getEffectiveProxyHost } from '../store/useAppStore';
import { useTauri } from '../hooks/useTauri';
import { usePacServer } from '../hooks/usePacServer';
import PlanetVisualizer from '../components/PlanetVisualizer';
import styles from './Dashboard.module.css';

export default function Dashboard() {
  const navigate = useNavigate();
  const { state, dispatch, t } = useAppStore();
  const {
    isActive,
    publicIp,
    isWhitelisting,
    serverConfig,
    presetSites,
    customDomains,
  } = state;

  const { setSystemProxy, clearSystemProxy, getNativeIp } = useTauri();
  const { pacUrl, checkHealth, updateConfig } = usePacServer();
  const [errorNotice, setErrorNotice] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isUnconfiguredWarning, setIsUnconfiguredWarning] = useState(false);
  const isConnectingRef = useRef(false);
  const pollRef   = useRef(null);
  const lastIpRef = useRef(null);

  // Check if proxy server credentials have actually been configured
  const isConfigured = Boolean(
    serverConfig?.apiUrl &&
    serverConfig?.authToken &&
    !serverConfig.apiUrl.includes('your-server-ip') &&
    serverConfig.apiUrl.trim() !== ''
  );

  // Active services for the visualizer (preset enabled + custom)
  const activeServices = [
    ...presetSites.filter((s) => s.enabled),
    ...customDomains,
  ];

  // ── Fetch real public IPv4 ───────────────────────────────────────────────────
  const fetchIp = useCallback(async () => {
    try {
      const ip = await getNativeIp();
      dispatch({ type: 'SET_PUBLIC_IP', payload: ip });
      lastIpRef.current = ip;
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: { category: 'NET', level: 'info', msg: `Public IPv4 detected: ${ip}` },
      });
      return ip;
    } catch (err) {
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: { category: 'NET', level: 'error', msg: `Failed to detect public IP: ${err.message || err}` },
      });
      return null;
    }
  }, [dispatch, getNativeIp]);

  // ── Whitelist current IP via server API (returns true if successful) ────────
  const whitelistIp = useCallback(async (ip) => {
    const normalizedUrl = (serverConfig.apiUrl || '').replace(/\/+$/, '');
    if (!ip || !normalizedUrl || !serverConfig.authToken) {
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: { category: 'AUTH', level: 'warn', msg: 'Skipping whitelist: Server URL or Token not configured in Settings' },
      });
      return false;
    }

    dispatch({ type: 'SET_WHITELISTING', payload: true });
    dispatch({ type: 'SET_WHITELIST_STATUS', payload: null });

    try {
      const res = await fetch(`${normalizedUrl}/api/whitelist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serverConfig.authToken}`,
        },
        body: JSON.stringify({ ip }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      const resData = await res.json();
      dispatch({ type: 'SET_WHITELIST_STATUS', payload: 'success' });
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: {
          category: 'AUTH',
          level: 'info',
          msg: `IP ${ip} authorized on Squid whitelist (${resData.user || 'authorized'})`,
        },
      });
      return true;
    } catch (err) {
      dispatch({ type: 'SET_WHITELIST_STATUS', payload: 'error' });
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: { category: 'AUTH', level: 'error', msg: `Whitelist API request failed: ${err.message}` },
      });
      setErrorNotice(`${t('whitelist.statusError', 'Whitelist request failed')}: ${err.message}`);
      return false;
    } finally {
      dispatch({ type: 'SET_WHITELISTING', payload: false });
    }
  }, [serverConfig, dispatch]);

  // ── Remove old IP from whitelist ─────────────────────────────────────────────
  const removeIp = useCallback(async (ip) => {
    const normalizedUrl = (serverConfig.apiUrl || '').replace(/\/+$/, '');
    if (!ip || !normalizedUrl || !serverConfig.authToken) return;
    try {
      await fetch(`${normalizedUrl}/api/whitelist`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serverConfig.authToken}`,
        },
        body: JSON.stringify({ ip }),
        signal: AbortSignal.timeout(5000),
      });
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: { category: 'AUTH', level: 'info', msg: `Old IP ${ip} removed from Squid whitelist` },
      });
    } catch { /* non-critical */ }
  }, [serverConfig, dispatch]);

  // ── Toggle proxy on/off with Strict Authorization Check & Handshake Lock ────
  const handleToggle = useCallback(async () => {
    // Strictly block concurrent activations / flapping clicks
    if (isConnectingRef.current) return;

    setErrorNotice(null);

    if (!isActive) {
      // 1. Strict Configuration Validation: flash red on globe, NO popups or banner
      if (!isConfigured) {
        setIsUnconfiguredWarning(true);
        setTimeout(() => setIsUnconfiguredWarning(false), 1400);
        return;
      }

      isConnectingRef.current = true;
      setIsConnecting(true);

      try {
        // 2. Detect WAN IP
        const ip = await fetchIp();
        if (!ip) {
          setErrorNotice(t('dashboard.statCheckingIp', 'Could not detect public IPv4. Check network connection.'));
          return;
        }

        // 3. Authenticate & Authorize with Squid Whitelist API
        const startTime = Date.now();
        const authorized = await whitelistIp(ip);
        if (!authorized) {
          // Do NOT activate proxy if server rejected or could not be reached!
          return;
        }

        // Keep handshake packet transmission animation visible for at least 2.8s
        const elapsed = Date.now() - startTime;
        if (elapsed < 2800) {
          await new Promise((resolve) => setTimeout(resolve, 2800 - elapsed));
        }

        // 4. Update PAC server rules with currently enabled sites and VPS proxy host
        const proxyHost = getEffectiveProxyHost(serverConfig);

        const enabledHosts = presetSites
          .filter(s => s.enabled)
          .flatMap(s => (s.hosts && s.hosts.length > 0 ? s.hosts : [s.host]));

        await updateConfig({
          proxyHost,
          proxyPort: 3128,
          enabledHosts,
          customDomains,
        });

        // 5. Set Windows system proxy to PAC URL
        const pacAlive = await checkHealth();
        if (pacAlive) {
          try {
            await setSystemProxy(pacUrl);
            dispatch({
              type: 'ADD_LOG_ENTRY',
              payload: { category: 'SYS', level: 'info', msg: `Windows registry: AutoConfigURL set to ${pacUrl}` },
            });
          } catch (err) {
            dispatch({
              type: 'ADD_LOG_ENTRY',
              payload: { category: 'SYS', level: 'warn', msg: `Failed setting Windows proxy: ${err}` },
            });
          }
        } else {
          dispatch({
            type: 'ADD_LOG_ENTRY',
            payload: { category: 'PAC', level: 'warn', msg: 'Local PAC server not detected on :8182' },
          });
        }

        // 5. Officially Activate Proxy
        dispatch({ type: 'SET_ACTIVE', payload: true });
        dispatch({
          type: 'ADD_LOG_ENTRY',
          payload: { category: 'SYS', level: 'info', msg: 'Proxy split tunneling activated' },
        });

        // 6. Dynamic IP monitoring interval (every 5 min)
        clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          const prevIp = lastIpRef.current;
          const newIp  = await fetchIp();
          if (newIp && prevIp && newIp !== prevIp) {
            dispatch({
              type: 'ADD_LOG_ENTRY',
              payload: { category: 'NET', level: 'warn', msg: `Network switch detected: ${prevIp} -> ${newIp}` },
            });
            await removeIp(prevIp);
            await whitelistIp(newIp);
          }
        }, 5 * 60 * 1000);
      } finally {
        isConnectingRef.current = false;
        setIsConnecting(false);
      }
    } else {
      // Deactivate with distinct teardown animation
      isConnectingRef.current = true;
      setIsDisconnecting(true);
      try {
        clearInterval(pollRef.current);
        const startTime = Date.now();
        await clearSystemProxy();
        dispatch({
          type: 'ADD_LOG_ENTRY',
          payload: { category: 'SYS', level: 'info', msg: 'Windows registry: AutoConfigURL cleared' },
        });

        // Keep teardown animation visible for at least 2.2s
        const elapsed = Date.now() - startTime;
        if (elapsed < 2200) {
          await new Promise((resolve) => setTimeout(resolve, 2200 - elapsed));
        }

        dispatch({ type: 'SET_ACTIVE', payload: false });
        dispatch({
          type: 'ADD_LOG_ENTRY',
          payload: { category: 'SYS', level: 'info', msg: 'Proxy split tunneling deactivated' },
        });
      } catch (err) {
        dispatch({
          type: 'ADD_LOG_ENTRY',
          payload: { category: 'SYS', level: 'warn', msg: `Could not clear system proxy: ${err}` },
        });
      } finally {
        isConnectingRef.current = false;
        setIsDisconnecting(false);
      }
    }
  }, [
    isActive,
    isConfigured,
    fetchIp,
    whitelistIp,
    removeIp,
    setSystemProxy,
    clearSystemProxy,
    checkHealth,
    pacUrl,
    dispatch,
  ]);

  useEffect(() => { fetchIp(); }, [fetchIp]);
  useEffect(() => () => clearInterval(pollRef.current), []);

  return (
    <div className={styles.page}>
      {/* Notice Banner only for network connectivity errors */}
      {errorNotice && (
        <div className={styles.noticeBar}>
          <AlertCircle size={14} className={styles.noticeIcon} />
          <span className={styles.noticeText}>{errorNotice}</span>
          <button
            type="button"
            className={styles.noticeClose}
            onClick={() => setErrorNotice(null)}
          >
            ×
          </button>
        </div>
      )}

      <PlanetVisualizer
        isActive={isActive}
        isConnecting={isConnecting}
        isDisconnecting={isDisconnecting}
        isUnconfiguredWarning={isUnconfiguredWarning}
        isConfigured={isConfigured}
        activeServices={activeServices}
        onToggle={handleToggle}
        disabled={isConnecting || isDisconnecting}
        publicIp={publicIp}
        onRefreshIp={fetchIp}
        onOpenSettings={() => navigate('/settings')}
      />
    </div>
  );
}
