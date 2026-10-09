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
import { useAppStore } from './store/useAppStore';
import { usePacServer } from './hooks/usePacServer';
import styles from './App.module.css';

function PacSync() {
  const { state } = useAppStore();
  const { presetSites, customDomains, serverConfig } = state;
  const { updateConfig } = usePacServer();

  useEffect(() => {
    let proxyHost = '127.0.0.1';
    try {
      if (serverConfig?.apiUrl) {
        proxyHost = new URL(serverConfig.apiUrl).hostname;
      }
    } catch {}

    const enabledHosts = (presetSites || [])
      .filter(s => s.enabled)
      .flatMap(s => (s.hosts && s.hosts.length > 0 ? s.hosts : [s.host]));

    updateConfig({
      proxyHost,
      proxyPort: 3128,
      enabledHosts,
      customDomains: customDomains || [],
    }).catch(() => {});
  }, [presetSites, customDomains, serverConfig?.apiUrl, updateConfig]);

  return null;
}

function MainLayout() {
  useStorageHydrate();
  useStoragePersist();

  return (
    <HashRouter>
      <PacSync />
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
