/**
 * App.jsx – Root layout: Custom Titlebar, rounded window shell,
 * icon-only rail sidebar, and routed viewports.
 */

import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AppProvider } from './store/useAppStore';
import { useStorageHydrate, useStoragePersist } from './hooks/useStorage';
import Titlebar from './components/Titlebar';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Sites from './pages/Sites';
import Apps from './pages/Apps';
import Whitelist from './pages/Whitelist';
import DnsSettings from './pages/DnsSettings';
import { useEffect, useState } from 'react';
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
  const { customization, isHydrated } = state;
  const { setWindowEffect, setAppIcon } = useTauri();

  useEffect(() => {
    // Strictly wait until storage is hydrated so we do not prematurely reset effects to 'none'
    if (!isHydrated) return;

    const { theme = 'dark-monolith', appIcon = 'monolith', bgMode = 'default', opacity = 75, blur = 16 } = customization || {};
    const root = document.documentElement;

    root.setAttribute('data-app-icon', appIcon);
    setAppIcon(appIcon).catch(() => {});

    const applyCurrentEffect = () => {
      if (theme === 'vela') {
        root.setAttribute('data-theme', 'vela');
        root.style.removeProperty('--bg-app');
        root.style.removeProperty('--bg-surface');
        root.style.removeProperty('--bg-surface-2');
        root.style.removeProperty('--bg-surface-3');
        root.style.removeProperty('--window-backdrop');
        root.style.removeProperty('--border');
        root.setAttribute('data-theme-mode', 'default');
        setWindowEffect('none').catch(() => {});
        return;
      }

      root.removeAttribute('data-theme');

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
      } else if (bgMode === 'mica') {
        root.style.setProperty('--bg-app', 'rgba(18, 18, 18, 0.45)');
        root.style.setProperty('--bg-surface', 'rgba(18, 18, 18, 0.45)');
        root.style.setProperty('--bg-surface-2', 'rgba(28, 28, 28, 0.6)');
        root.style.setProperty('--bg-surface-3', 'rgba(22, 22, 22, 0.55)');
        root.style.setProperty('--window-backdrop', 'none');
        root.style.setProperty('--border', 'rgba(255, 255, 255, 0.08)');
        root.setAttribute('data-theme-mode', 'mica');

        setWindowEffect('mica').catch(() => {});
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
    };

    // 1. Initial application
    applyCurrentEffect();

    // 2. Multi-stage re-application to survive WebView2 DirectComposition initialization
    const t1 = setTimeout(applyCurrentEffect, 150);
    const t2 = setTimeout(applyCurrentEffect, 600);

    // 3. Re-apply on window focus to ensure blur is active when user unminimizes or returns
    const handleFocus = () => applyCurrentEffect();
    window.addEventListener('focus', handleFocus);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('focus', handleFocus);
    };
  }, [customization, isHydrated, setWindowEffect]);

  return null;
}

function VelaAmbientBackdrop() {
  const { state } = useAppStore();
  const location = useLocation();
  const [heroColorKey, setHeroColorKey] = useState('yellow');
  const isVela = state.customization?.theme === 'vela';

  useEffect(() => {
    const handleHeroColor = (e) => {
      if (e.detail?.colorKey) {
        setHeroColorKey(e.detail.colorKey);
      }
    };
    window.addEventListener('vela:hero-color', handleHeroColor);
    return () => window.removeEventListener('vela:hero-color', handleHeroColor);
  }, []);

  if (!isVela) return null;

  const path = location.pathname;
  const isDashboard = path === '/';

  return (
    <div className={styles.velaBackdropContainer} aria-hidden="true">
      {/* ── Dashboard Dynamic Ticker Ambient Gradients (Smooth Cross-fade) ── */}
      <div className={`${styles.velaGradientLayer} ${styles.gradHeroYellow} ${isDashboard && heroColorKey === 'yellow' ? styles.gradActive : ''}`} />
      <div className={`${styles.velaGradientLayer} ${styles.gradHeroPeach} ${isDashboard && heroColorKey === 'peach' ? styles.gradActive : ''}`} />
      <div className={`${styles.velaGradientLayer} ${styles.gradHeroGreen} ${isDashboard && heroColorKey === 'green' ? styles.gradActive : ''}`} />
      <div className={`${styles.velaGradientLayer} ${styles.gradHeroPurple} ${isDashboard && heroColorKey === 'purple' ? styles.gradActive : ''}`} />
      <div className={`${styles.velaGradientLayer} ${styles.gradHeroConnecting} ${isDashboard && heroColorKey === 'connecting' ? styles.gradActive : ''}`} />
      <div className={`${styles.velaGradientLayer} ${styles.gradHeroDisconnecting} ${isDashboard && heroColorKey === 'disconnecting' ? styles.gradActive : ''}`} />

      {/* ── Page-specific Ambient Gradients ── */}
      <div className={`${styles.velaGradientLayer} ${styles.gradSites} ${path === '/sites' ? styles.gradActive : ''}`} />
      <div className={`${styles.velaGradientLayer} ${styles.gradApps} ${path === '/apps' ? styles.gradActive : ''}`} />
      <div className={`${styles.velaGradientLayer} ${styles.gradWhitelist} ${path === '/whitelist' ? styles.gradActive : ''}`} />
      <div className={`${styles.velaGradientLayer} ${styles.gradDns} ${path === '/dns' ? styles.gradActive : ''}`} />
      <div className={`${styles.velaGradientLayer} ${styles.gradLogs} ${path === '/log' ? styles.gradActive : ''}`} />
      <div className={`${styles.velaGradientLayer} ${styles.gradSettings} ${path === '/settings' ? styles.gradActive : ''}`} />

      {/* ── Tactile Paper Grain Overlay ── */}
      <div className={styles.velaPaperGrain} />
    </div>
  );
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
        <VelaAmbientBackdrop />
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
