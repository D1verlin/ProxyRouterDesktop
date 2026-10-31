/**
 * useStorage.js — persists app state to localStorage automatically.
 */

import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';

const STORAGE_KEY = 'proxy-router-settings-v2';

export function useStorageHydrate() {
  const { dispatch } = useAppStore();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);

        if (saved.serverConfig) {
          dispatch({ type: 'UPDATE_SERVER_CONFIG', payload: saved.serverConfig });
        }
        if (Array.isArray(saved.customDomains)) {
          saved.customDomains.forEach(d =>
            dispatch({ type: 'ADD_CUSTOM_DOMAIN', payload: d })
          );
        }
        if (Array.isArray(saved.presetSiteIds)) {
          saved.presetSiteIds.forEach(id =>
            dispatch({ type: 'RESTORE_PRESET_SITE', payload: id })
          );
        }
        if (Array.isArray(saved.routedApps)) {
          saved.routedApps.forEach(app => {
            dispatch({ type: 'ADD_ROUTED_APP', payload: app });
          });
        }
        if (typeof saved.terminalProxyActive === 'boolean') {
          dispatch({ type: 'SET_TERMINAL_PROXY', payload: saved.terminalProxyActive });
        }
        if (saved.language === 'en' || saved.language === 'ru') {
          dispatch({ type: 'SET_LANGUAGE', payload: saved.language });
        }
        if (saved.customization && typeof saved.customization === 'object') {
          dispatch({ type: 'SET_CUSTOMIZATION', payload: saved.customization });
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      dispatch({ type: 'SET_HYDRATED', payload: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function useStoragePersist() {
  const { state } = useAppStore();

  useEffect(() => {
    // Strictly wait until persisted storage is hydrated to prevent wiping settings
    if (!state.isHydrated) return;

    try {
      const toSave = {
        serverConfig:        state.serverConfig,
        customDomains:       state.customDomains,
        presetSiteIds:       state.presetSites.filter(s => s.enabled).map(s => s.id),
        routedApps:          state.routedApps,
        terminalProxyActive: state.terminalProxyActive,
        language:            state.language || 'en',
        customization:       state.customization,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch {
      // quota exceeded
    }
  }, [state.isHydrated, state.serverConfig, state.customDomains, state.presetSites, state.routedApps, state.terminalProxyActive, state.language, state.customization]);
}
