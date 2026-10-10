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
      if (!raw) return;
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
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function useStoragePersist() {
  const { state } = useAppStore();

  useEffect(() => {
    try {
      const toSave = {
        serverConfig:        state.serverConfig,
        customDomains:       state.customDomains,
        presetSiteIds:       state.presetSites.filter(s => s.enabled).map(s => s.id),
        routedApps:          state.routedApps,
        terminalProxyActive: state.terminalProxyActive,
        language:            state.language || 'en',
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch {
      // quota exceeded
    }
  }, [state.serverConfig, state.customDomains, state.presetSites, state.routedApps, state.terminalProxyActive, state.language]);
}
