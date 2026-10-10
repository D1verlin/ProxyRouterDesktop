/**
 * Apps.jsx — Application Routing & Process Management
 *
 * Intercepts desktop application traffic via a local HTTP CONNECT forwarder
 * running on 127.0.0.1:8183, which tunnels directly to the upstream proxy.
 *
 * Features:
 * - Smart profiles for Chromium / Electron (isolated user-data-dir)
 * - Telegram Desktop native proxy parameters
 * - One-click interactive Proxied PowerShell Terminal
 * - Process status monitoring & Auto-Relaunch unrouted instances
 */

import { useState, useEffect, useRef } from 'react';
import {
  FolderOpen,
  Plus,
  Play,
  RotateCw,
  Trash2,
  Terminal,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Radio,
} from 'lucide-react';
import { useAppStore, getEffectiveProxyHost } from '../store/useAppStore';
import { useTauri } from '../hooks/useTauri';
import styles from './Apps.module.css';

export default function Apps() {
  const { state, dispatch, t } = useAppStore();
  const { routedApps, terminalProxyActive, autoRouteDetected, proxyHost, proxyPort } = state;
  const {
    pickExeFile,
    launchAppWithProxy,
    launchProxiedTerminal,
    updateUpstreamProxy,
    checkRunningProcesses,
    killProcess,
    setTerminalEnvProxy,
  } = useTauri();

  const [appName, setAppName] = useState('');
  const [appPath, setAppPath] = useState('');
  const [appArgs, setAppArgs] = useState('');
  const [actionNotice, setActionNotice] = useState(null);

  const localProxyUrl = 'http://127.0.0.1:8183';
  const autoRoutedHistoryRef = useRef(new Set());

  // Keep Rust upstream proxy target in sync whenever proxyHost/proxyPort changes
  useEffect(() => {
    const host = proxyHost || getEffectiveProxyHost(state.serverConfig);
    const port = proxyPort || 3128;
    updateUpstreamProxy(host, port).catch(() => {});
  }, [proxyHost, proxyPort, state.serverConfig, updateUpstreamProxy]);

  // ── Browse .exe using native Windows Explorer ──────────────────────────────
  const handleBrowseExe = async () => {
    try {
      const selectedPath = await pickExeFile();
      if (selectedPath) {
        setAppPath(selectedPath);
        const cleanName = selectedPath.split(/[\\/]/).pop().replace(/\.exe$/i, '');
        if (!appName) {
          setAppName(cleanName.charAt(0).toUpperCase() + cleanName.slice(1));
        }
      }
    } catch (err) {
      setActionNotice({ type: 'error', text: `Ошибка диалога проводника: ${err.message || err}` });
    }
  };

  const handleAddApp = () => {
    if (!appPath.trim()) return;
    const cleanName = appName.trim() || appPath.split(/[\\/]/).pop().replace(/\.exe$/i, '');
    const newApp = {
      id: `app_${Date.now()}`,
      name: cleanName,
      path: appPath.trim(),
      args: appArgs.trim(),
      isRunning: false,
      isRouted: false,
    };
    dispatch({ type: 'ADD_ROUTED_APP', payload: newApp });
    setAppName('');
    setAppPath('');
    setAppArgs('');
    dispatch({
      type: 'ADD_LOG_ENTRY',
      payload: { category: 'PROC', level: 'info', msg: `Добавлено приложение: ${cleanName} (${newApp.path})` },
    });
  };

  // ── Launch process through proxy ───────────────────────────────────────────
  const handleLaunchRouted = async (app, isolatedProfile = true) => {
    setActionNotice(null);
    try {
      const pid = await launchAppWithProxy(app.path, app.args, localProxyUrl, isolatedProfile);
      dispatch({
        type: 'UPDATE_ROUTED_APP_STATUS',
        payload: { id: app.id, isRunning: true, isRouted: true, pid },
      });
      autoRoutedHistoryRef.current.add(app.path.toLowerCase());
      setActionNotice({
        type: 'success',
        text: `Запущено '${app.name}' через прокси (PID: ${pid}, порт: 8183)`,
      });
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: {
          category: 'PROC',
          level: 'info',
          msg: `Запущен '${app.name}' через локальный прокси :8183 (PID ${pid})`,
        },
      });
    } catch (err) {
      setActionNotice({ type: 'error', text: `Не удалось запустить '${app.name}': ${err}` });
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: { category: 'PROC', level: 'error', msg: `Ошибка запуска '${app.name}': ${err}` },
      });
    }
  };

  // ── Relaunch unrouted process through proxy ────────────────────────────────
  const handleRelaunchRouted = async (app) => {
    const exeName = app.path.split(/[\\/]/).pop();
    try {
      await killProcess(exeName);
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: { category: 'PROC', level: 'warn', msg: `Завершен существующий процесс: ${exeName}` },
      });
    } catch {}
    await handleLaunchRouted(app, false);
  };

  // ── Periodic Process Scanner (detects unrouted running instances) ───────────
  useEffect(() => {
    if (routedApps.length === 0) return;

    const interval = setInterval(async () => {
      try {
        const statuses = await checkRunningProcesses(routedApps.map(a => a.path));
        if (!Array.isArray(statuses)) return;

        statuses.forEach((st) => {
          const app = routedApps.find(a => a.path === st.query);
          if (!app) return;

          const wasRunning = app.isRunning;
          const isNowRunning = st.is_running;

          if (isNowRunning !== wasRunning) {
            const isRouted = autoRoutedHistoryRef.current.has(app.path.toLowerCase());
            dispatch({
              type: 'UPDATE_ROUTED_APP_STATUS',
              payload: { id: app.id, isRunning: isNowRunning, isRouted },
            });

            if (isNowRunning && !isRouted) {
              dispatch({
                type: 'ADD_LOG_ENTRY',
                payload: {
                  category: 'PROC',
                  level: 'warn',
                  msg: `Обнаружен прямой процесс без прокси: ${app.name} (${st.process_name})`,
                },
              });

              if (autoRouteDetected) {
                handleRelaunchRouted(app);
              }
            }
          }
        });
      } catch {}
    }, 3500);

    return () => clearInterval(interval);
  }, [routedApps, autoRouteDetected, checkRunningProcesses, dispatch]);

  // ── Global Windows User Environment Toggle ─────────────────────────────────
  const handleToggleTerminal = async () => {
    const next = !terminalProxyActive;
    try {
      await setTerminalEnvProxy(localProxyUrl, next);
      dispatch({ type: 'SET_TERMINAL_PROXY', payload: next });
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: {
          category: 'CLI',
          level: 'info',
          msg: next
            ? `Глобальные переменные окружения прокси активированы (${localProxyUrl})`
            : 'Глобальные переменные окружения прокси очищены',
        },
      });
      setActionNotice({
        type: 'success',
        text: next
          ? `Переменные HTTP_PROXY активированы в Windows Environment (${localProxyUrl})`
          : 'Переменные окружения Windows очищены',
      });
    } catch (err) {
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: { category: 'CLI', level: 'error', msg: `Ошибка переключения прокси: ${err}` },
      });
      setActionNotice({ type: 'error', text: `Ошибка изменения реестра: ${err}` });
    }
  };

  // ── Dedicated Interactive Proxied Terminal Launcher ─────────────────────────
  const handleLaunchProxiedTerminal = async () => {
    try {
      const pid = await launchProxiedTerminal();
      setActionNotice({
        type: 'success',
        text: `Запущен терминал PowerShell с прокси ${localProxyUrl} (PID: ${pid})`,
      });
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: { category: 'CLI', level: 'info', msg: `Открыт терминал PowerShell с прокси :8183 (PID ${pid})` },
      });
    } catch (err) {
      setActionNotice({ type: 'error', text: `Не удалось запустить терминал: ${err}` });
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('apps.title', 'Application Traffic Routing')}</h1>
        <p className={styles.subtitle}>
          {t(
            'apps.subtitle',
            'Selective interception and isolation of application network traffic via local tunnel :8183'
          )}
        </p>
      </header>

      {/* Local Engine Status Banner */}
      <div className={styles.configCard} style={{ background: 'rgba(255, 255, 255, 0.02)' }}>
        <div className={styles.cardInfo}>
          <div className={styles.cardIcon}>
            <Radio size={16} />
          </div>
          <div className={styles.cardText}>
            <span className={styles.cardTitle}>
              {t('apps.forwarderTitle', 'Local Proxy Forwarder (Port 8183)')}
            </span>
            <span className={styles.cardSub}>
              {t('apps.forwarderSub', 'Application traffic is forwarded to the upstream server')}{' '}
              <code className="mono">{proxyHost || getEffectiveProxyHost(state.serverConfig)}:{proxyPort || 3128}</code>
            </span>
          </div>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={handleLaunchProxiedTerminal}
          style={{ height: '32px', fontSize: '12px' }}
          title={t('apps.openTerminal', 'Launch Proxied PowerShell Terminal')}
        >
          <Terminal size={13} />
          {t('apps.openTerminal', 'Proxied PowerShell')}
        </button>
      </div>

      {/* Terminal & Developer Global Proxy */}
      <div className={styles.configCard}>
        <div className={styles.cardInfo}>
          <div className={styles.cardIcon}>
            <Terminal size={17} />
          </div>
          <div className={styles.cardText}>
            <span className={styles.cardTitle}>
              {t('apps.terminalEnv', 'Global CLI & Terminal Proxy')}
            </span>
            <span className={styles.cardSub}>
              {t(
                'apps.terminalEnvDesc',
                'Sets HTTP_PROXY in Windows Environment for Git, Node, Python, Curl and terminals.'
              )}
            </span>
          </div>
        </div>
        <div
          className={`${styles.toggle} ${terminalProxyActive ? styles.toggleOn : ''}`}
          role="switch"
          aria-checked={terminalProxyActive}
          tabIndex={0}
          onClick={handleToggleTerminal}
          onKeyDown={(e) => e.key === ' ' && handleToggleTerminal()}
        >
          <span className={styles.toggleThumb} />
        </div>
      </div>

      {/* Auto-Route Running Executables Toggle */}
      <div className={styles.configCard}>
        <div className={styles.cardInfo}>
          <div className={styles.cardIcon}>
            <RotateCw size={17} />
          </div>
          <div className={styles.cardText}>
            <span className={styles.cardTitle}>
              {t('apps.autoRouteTitle', 'Auto-Relaunch Unrouted Processes')}
            </span>
            <span className={styles.cardSub}>
              {t(
                'apps.autoRouteDesc',
                'Automatically relaunches monitored apps through proxy if opened directly.'
              )}
            </span>
          </div>
        </div>
        <div
          className={`${styles.toggle} ${autoRouteDetected ? styles.toggleOn : ''}`}
          role="switch"
          aria-checked={autoRouteDetected}
          tabIndex={0}
          onClick={() => dispatch({ type: 'SET_AUTO_ROUTE_DETECTED', payload: !autoRouteDetected })}
          onKeyDown={(e) =>
            e.key === ' ' && dispatch({ type: 'SET_AUTO_ROUTE_DETECTED', payload: !autoRouteDetected })
          }
        >
          <span className={styles.toggleThumb} />
        </div>
      </div>

      {actionNotice && (
        <div className={`${styles.notice} ${styles[actionNotice.type]}`}>
          {actionNotice.text}
        </div>
      )}

      {/* Add Executable via Windows Explorer */}
      <div className={styles.addCard}>
        <span className={styles.sectionTitle}>
          {t('apps.addApp', 'Add Executable (.exe)')}
        </span>

        <div className={styles.formGrid}>
          <input
            type="text"
            className="input"
            placeholder={t('apps.appNamePlaceholder', 'Program Name (e.g. Cursor or Telegram)')}
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
          />

          <div className={styles.pathRow}>
            <input
              type="text"
              className={`input ${styles.pathInput}`}
              placeholder={t('apps.appPathPlaceholder', 'Full path to .exe (e.g. C:\\Program Files\\...)')}
              value={appPath}
              onChange={(e) => setAppPath(e.target.value)}
            />
            <button
              type="button"
              className="btn-secondary"
              onClick={handleBrowseExe}
              title="Open Windows File Explorer"
            >
              <FolderOpen size={14} />
              {t('apps.browse', 'Browse...')}
            </button>
          </div>

          <button
            type="button"
            className="btn-primary"
            onClick={handleAddApp}
            disabled={!appPath.trim()}
          >
            <Plus size={14} />
            {t('apps.btnAdd', 'Add Application')}
          </button>
        </div>
      </div>

      {/* Applications List */}
      <div className={styles.listHeader}>
        <span className={styles.countLabel}>
          {t('apps.trackedApps', 'Monitored Applications')}
        </span>
        <span className="badge">{routedApps.length}</span>
      </div>

      {routedApps.length === 0 ? (
        <div className={styles.empty}>
          {t('apps.noAppsDesc', 'No applications added. Click "Browse..." above to select an executable file.')}
        </div>
      ) : (
        <div className={styles.list}>
          {routedApps.map((app) => {
            const isDirect = app.isRunning && !app.isRouted;
            const isProxied = app.isRunning && app.isRouted;

            return (
              <div key={app.id} className={styles.appRow}>
                <div className={styles.appInfo}>
                  <div className={styles.appNameRow}>
                    <span className={styles.appName}>{app.name}</span>
                    {isProxied && (
                      <span className="badge active">
                        <CheckCircle2 size={10} style={{ marginRight: 4 }} />
                        {t('apps.appStatusRunning', 'Running (via Proxy)')}
                      </span>
                    )}
                    {isDirect && (
                      <span className={`${styles.warnBadge}`}>
                        <AlertTriangle size={10} style={{ marginRight: 4 }} />
                        {t('apps.appStatusDirect', 'Running (Direct)')}
                      </span>
                    )}
                    {!app.isRunning && (
                      <span className="badge">
                        {t('apps.appStatusStopped', 'Not Running')}
                      </span>
                    )}
                  </div>
                  <span className={`mono ${styles.appPath}`}>{app.path}</span>
                </div>

                <div className={styles.actions}>
                  {isDirect ? (
                    <button
                      type="button"
                      className="btn-primary"
                      style={{ height: '32px', fontSize: '12px' }}
                      onClick={() => handleRelaunchRouted(app)}
                      title="Kill existing instance and restart with proxy"
                    >
                      <RotateCw size={12} />
                      {t('apps.relaunchProxied', 'Relaunch with Proxy')}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn-primary"
                        style={{ height: '32px', fontSize: '12px' }}
                        onClick={() => handleLaunchRouted(app, true)}
                        title="Launch in isolated profile"
                      >
                        <Play size={11} fill="currentColor" />
                        {t('apps.launchBtn', 'Launch')}
                      </button>

                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ height: '32px', fontSize: '12px' }}
                        onClick={() => handleRelaunchRouted(app)}
                        title="Force restart process with proxy flags"
                      >
                        <RotateCw size={12} />
                        {t('apps.restartBtn', 'Restart')}
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => dispatch({ type: 'REMOVE_ROUTED_APP', payload: app.id })}
                    title={t('apps.removeBtn', 'Remove')}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
