/**
 * Apps page — Executable Router (.exe) & Process Monitoring.
 * Allows adding applications via native Windows Explorer and auto-detecting
 * unrouted process launches.
 */

import { useState, useEffect, useRef } from 'react';
import {
  FolderOpen,
  Plus,
  Trash2,
  Play,
  RotateCw,
  Terminal,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useTauri } from '../hooks/useTauri';
import styles from './Apps.module.css';

export default function Apps() {
  const { state, dispatch } = useAppStore();
  const { routedApps, terminalProxyActive, autoRouteDetected } = state;
  const {
    pickExeFile,
    launchAppWithProxy,
    checkRunningProcesses,
    killProcess,
    setTerminalEnvProxy,
  } = useTauri();

  const [appName, setAppName] = useState('');
  const [appPath, setAppPath] = useState('');
  const [appArgs, setAppArgs] = useState('');
  const [actionNotice, setActionNotice] = useState(null);

  const proxyUrl = 'http://127.0.0.1:8182';
  const autoRoutedHistoryRef = useRef(new Set());

  // ── Browse .exe using native Windows Explorer ──────────────────────────────
  const handleBrowseExe = async () => {
    try {
      const selectedPath = await pickExeFile();
      if (selectedPath) {
        setAppPath(selectedPath);
        // Automatically extract friendly application name
        const cleanName = selectedPath.split(/[\\/]/).pop().replace(/\.exe$/i, '');
        if (!appName) {
          setAppName(cleanName.charAt(0).toUpperCase() + cleanName.slice(1));
        }
      }
    } catch (err) {
      setActionNotice({ type: 'error', text: `Explorer dialog error: ${err.message || err}` });
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
      payload: { category: 'PROC', level: 'info', msg: `Added application: ${cleanName} (${newApp.path})` },
    });
  };

  // ── Launch process through proxy ───────────────────────────────────────────
  const handleLaunchRouted = async (app) => {
    setActionNotice(null);
    try {
      const pid = await launchAppWithProxy(app.path, app.args, proxyUrl);
      dispatch({
        type: 'UPDATE_ROUTED_APP_STATUS',
        payload: { id: app.id, isRunning: true, isRouted: true, pid },
      });
      autoRoutedHistoryRef.current.add(app.path.toLowerCase());
      setActionNotice({ type: 'success', text: `Launched '${app.name}' via proxy (PID: ${pid})` });
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: { category: 'PROC', level: 'info', msg: `Launched '${app.name}' with isolated proxy flags (PID ${pid})` },
      });
    } catch (err) {
      setActionNotice({ type: 'error', text: `Failed to launch '${app.name}': ${err}` });
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: { category: 'PROC', level: 'error', msg: `Launch failed for '${app.name}': ${err}` },
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
        payload: { category: 'PROC', level: 'warn', msg: `Terminated unrouted process: ${exeName}` },
      });
    } catch {}
    await handleLaunchRouted(app);
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
                  msg: `Detected unrouted process running: ${app.name} (${st.process_name})`,
                },
              });

              // Auto-route on detection if enabled
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

  const handleToggleTerminal = async () => {
    const next = !terminalProxyActive;
    try {
      await setTerminalEnvProxy(proxyUrl, next);
      dispatch({ type: 'SET_TERMINAL_PROXY', payload: next });
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: {
          category: 'CLI',
          level: 'info',
          msg: next ? `Terminal environment proxy enabled (${proxyUrl})` : 'Terminal environment proxy cleared',
        },
      });
    } catch (err) {
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: { category: 'CLI', level: 'error', msg: `Failed toggling terminal proxy: ${err}` },
      });
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Application Routing</h1>
        <p className={styles.subtitle}>Select executables to route through proxy and monitor process status.</p>
      </header>

      {/* Terminal & Developer Global Proxy */}
      <div className={styles.configCard}>
        <div className={styles.cardInfo}>
          <div className={styles.cardIcon}>
            <Terminal size={17} />
          </div>
          <div className={styles.cardText}>
            <span className={styles.cardTitle}>CLI &amp; Terminal Proxy</span>
            <span className={styles.cardSub}>
              Sets <code className="mono">HTTP_PROXY</code> in Windows Environment for PowerShell, Git, Node, Python, and Curl.
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
            <span className={styles.cardTitle}>Auto-Relaunch Unrouted Processes</span>
            <span className={styles.cardSub}>
              Automatically terminates and restarts target applications with proxy when started outside this manager.
            </span>
          </div>
        </div>
        <div
          className={`${styles.toggle} ${autoRouteDetected ? styles.toggleOn : ''}`}
          role="switch"
          aria-checked={autoRouteDetected}
          tabIndex={0}
          onClick={() => dispatch({ type: 'SET_AUTO_ROUTE_DETECTED', payload: !autoRouteDetected })}
          onKeyDown={(e) => e.key === ' ' && dispatch({ type: 'SET_AUTO_ROUTE_DETECTED', payload: !autoRouteDetected })}
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
        <span className={styles.sectionTitle}>Add Application Executable</span>

        <div className={styles.formGrid}>
          <input
            type="text"
            className="input"
            placeholder="Application Name (e.g. Cursor)"
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
          />

          <div className={styles.pathRow}>
            <input
              type="text"
              className={`input ${styles.pathInput}`}
              placeholder="Full path to .exe (e.g. C:\Program Files\...)"
              value={appPath}
              onChange={(e) => setAppPath(e.target.value)}
            />
            <button
              type="button"
              className="btn-secondary"
              onClick={handleBrowseExe}
              title="Open Windows Explorer"
            >
              <FolderOpen size={14} />
              Browse...
            </button>
          </div>

          <button
            type="button"
            className="btn-primary"
            onClick={handleAddApp}
            disabled={!appPath.trim()}
          >
            <Plus size={14} />
            Add Application
          </button>
        </div>
      </div>

      {/* Applications List */}
      <div className={styles.listHeader}>
        <span className={styles.countLabel}>Monitored Executables</span>
        <span className="badge">{routedApps.length}</span>
      </div>

      {routedApps.length === 0 ? (
        <div className={styles.empty}>
          No applications added yet. Click &quot;Browse...&quot; above to select an .exe from your computer.
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
                        Running (Routed)
                      </span>
                    )}
                    {isDirect && (
                      <span className={`${styles.warnBadge}`}>
                        <AlertTriangle size={10} style={{ marginRight: 4 }} />
                        Running (Direct / Not routed)
                      </span>
                    )}
                    {!app.isRunning && (
                      <span className="badge">Offline</span>
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
                      title="Relaunch process via Proxy"
                    >
                      <RotateCw size={12} />
                      Relaunch Routed
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-primary"
                      style={{ height: '32px', fontSize: '12px' }}
                      onClick={() => handleLaunchRouted(app)}
                      title="Launch with proxy environment"
                    >
                      <Play size={11} fill="currentColor" />
                      Launch
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => dispatch({ type: 'REMOVE_ROUTED_APP', payload: app.id })}
                    title="Remove from list"
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
