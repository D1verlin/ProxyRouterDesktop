/**
 * App.jsx – Root layout: Custom Titlebar, rounded window shell,
 * icon-only rail sidebar, and routed viewports.
 */

import { HashRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './store/useAppStore';
import { useStorageHydrate, useStoragePersist } from './hooks/useStorage';
import Titlebar from './components/Titlebar';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Sites from './pages/Sites';
import Apps from './pages/Apps';
import Whitelist from './pages/Whitelist';
import { useEffect } from 'react';
import ActivityLog from './pages/ActivityLog';
import Settings from './pages/Settings';
import { useAppStore, getEffectiveProxyHost } from './store/useAppStore';
import { usePacServer } from './hooks/usePacServer';
import { useTauri } from './hooks/useTauri';
import styles from './App.module.css';

function PacSync() {
  const { state } = useAppStore();
  const { presetSites, customDomains, serverConfig } = state;
  const { updateConfig } = usePacServer();

  useEffect(() => {
    const proxyHost = getEffectiveProxyHost(serverConfig);

    const enabledHosts = (presetSites || [])
      .filter(s => s.enabled)
      .flatMap(s => (s.hosts && s.hosts.length > 0 ? s.hosts : [s.host]));

    updateConfig({
      proxyHost,
      proxyPort: 3128,
      enabledHosts,
      customDomains: customDomains || [],
    }).catch(() => {});
  }, [presetSites, customDomains, serverConfig, updateConfig]);

  return null;
}

function TraySync() {
  const { state, dispatch } = useAppStore();
  const { updateTrayIcon, setSystemProxy, clearSystemProxy, isTauri } = useTauri();

  useEffect(() => {
    updateTrayIcon(state.isActive).catch(() => {});
  }, [state.isActive, updateTrayIcon]);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten = null;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen('tray-toggle-proxy', async () => {
          const nextActive = !state.isActive;
          try {
            if (nextActive) {
              await setSystemProxy('http://127.0.0.1:8182/proxy.pac');
            } else {
              await clearSystemProxy();
            }
            dispatch({ type: 'SET_ACTIVE', payload: nextActive });
            dispatch({
              type: 'ADD_LOG_ENTRY',
              payload: {
                category: 'ROUTE',
                level: 'info',
                msg: nextActive ? 'Proxy activated via system tray' : 'Proxy deactivated via system tray',
              },
            });
          } catch (err) {
            console.error('[TraySync] Failed to toggle proxy from tray:', err);
          }
        });
      } catch {}
    })();

    return () => {
      if (typeof unlisten === 'function') unlisten();
    };
  }, [state.isActive, dispatch, setSystemProxy, clearSystemProxy, isTauri]);

  return null;
}

function MainLayout() {
  useStorageHydrate();
  useStoragePersist();

  return (
    <HashRouter>
      <PacSync />
      <TraySync />
      <div className={styles.windowShell}>
        {/* Custom Window Titlebar & Native Window Controls */}
        <Titlebar />

        {/* Application Body: Rail Sidebar + Content */}
        <div className={styles.bodyLayout}>
          <Sidebar />
          <main className={styles.content}>
            <Routes>
              <Route path="/"          element={<Dashboard />} />
              <Route path="/sites"     element={<Sites />} />
              <Route path="/apps"      element={<Apps />} />
              <Route path="/whitelist" element={<Whitelist />} />
              <Route path="/log"       element={<ActivityLog />} />
              <Route path="/settings"  element={<Settings />} />
            </Routes>
          </main>
        </div>
      </div>
    </HashRouter>
  );
}

export default function App() {
  return (
    <AppProvider>
      <MainLayout />
    </AppProvider>
  );
}
