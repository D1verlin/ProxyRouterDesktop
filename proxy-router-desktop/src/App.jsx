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
import DnsSettings from './pages/DnsSettings';
import { useEffect } from 'react';
import ActivityLog from './pages/ActivityLog';
import Settings from './pages/Settings';
import {
  useAppStore,
  getEffectiveProxyHost,
  getEffectiveProxyPort,
  getEffectiveProxyProtocol,
  getEffectiveIgnoreTls,
} from './store/useAppStore';
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
      proxyPort: getEffectiveProxyPort(serverConfig),
      proxyProtocol: getEffectiveProxyProtocol(serverConfig),
      ignoreTls: getEffectiveIgnoreTls(serverConfig),
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
              await setSystemProxy('http://127.0.0.1:8183', state.terminalProxyActive);
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
  }, [state.isActive, state.terminalProxyActive, dispatch, setSystemProxy, clearSystemProxy, isTauri]);

  return null;
}

function CustomizationSync() {
  const { state } = useAppStore();
  const { customization } = state;
  const { setWindowEffect } = useTauri();

  useEffect(() => {
    const { bgMode = 'default', opacity = 75, blur = 16 } = customization || {};
    const root = document.documentElement;

    if (bgMode === 'acrylic') {
      const alpha = Math.max(0.15, Math.min(0.98, opacity / 100));
      const blurPx = Math.max(0, Math.min(50, blur));
      const alphaSurface2 = Math.min(0.95, alpha + 0.08).toFixed(2);
      const alphaSurface3 = Math.min(0.95, alpha + 0.04).toFixed(2);

      root.style.setProperty('--bg-app', `rgba(18, 18, 18, ${alpha.toFixed(2)})`);
      root.style.setProperty('--bg-surface', `rgba(18, 18, 18, ${alpha.toFixed(2)})`);
      root.style.setProperty('--bg-surface-2', `rgba(28, 28, 28, ${alphaSurface2})`);
      root.style.setProperty('--bg-surface-3', `rgba(22, 22, 22, ${alphaSurface3})`);
      if (blurPx === 0) {
        root.style.setProperty('--window-backdrop', 'none');
      } else {
        root.style.setProperty('--window-backdrop', `blur(${blurPx}px) saturate(140%)`);
      }
      root.style.setProperty(
        '--border',
        `rgba(255, 255, 255, ${Math.max(0.06, 0.12 - (1 - alpha) * 0.04).toFixed(2)})`
      );
      root.setAttribute('data-theme-mode', 'acrylic');

      const nativeAlpha = Math.round(alpha * 255);
      if (blurPx === 0) {
        setWindowEffect('none').catch(() => {});
      } else {
        setWindowEffect('acrylic', [18, 18, 18, nativeAlpha]).catch(() => {});
      }
    } else {
      root.style.removeProperty('--bg-app');
      root.style.removeProperty('--bg-surface');
      root.style.removeProperty('--bg-surface-2');
      root.style.removeProperty('--bg-surface-3');
      root.style.removeProperty('--window-backdrop');
      root.style.removeProperty('--border');
      root.setAttribute('data-theme-mode', 'default');

      setWindowEffect('none').catch(() => {});
    }
  }, [customization, setWindowEffect]);

  return null;
}

function MainLayout() {
  useStorageHydrate();
  useStoragePersist();

  return (
    <HashRouter>
      <PacSync />
      <TraySync />
      <CustomizationSync />
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
              <Route path="/dns"       element={<DnsSettings />} />
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
