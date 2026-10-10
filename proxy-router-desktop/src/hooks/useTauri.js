/**
 * useTauri.js — wrapper around Tauri native invoke() calls.
 * Works seamlessly in both Tauri native desktop environment and browser dev mode.
 */

import { useCallback } from 'react';

export const isTauri =
  typeof window !== 'undefined' &&
  Boolean(window.__TAURI__ || window.__TAURI_INTERNALS__);

async function invoke(cmd, args = {}) {
  if (isTauri) {
    try {
      const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
      return await tauriInvoke(cmd, args);
    } catch (err) {
      console.warn(`[useTauri] invoke('${cmd}') failed:`, err);
      throw err;
    }
  }

  // Graceful browser fallback (NO fake 192.168.1.100 mock)
  switch (cmd) {
    case 'get_proxy_status':
      return { pac_url: '', proxy_enable: '0', proxy_server: '' };
    case 'set_system_proxy':
      return `Browser mock: proxy set to ${args.pacUrl || args.pac_url}`;
    case 'clear_system_proxy':
      return 'Browser mock: proxy cleared';
    case 'update_pac_rules':
      return 'Browser mock: PAC rules updated';
    case 'update_upstream_proxy':
      return 'Browser mock: upstream proxy updated';
    case 'launch_app_with_proxy':
      return Math.floor(Math.random() * 9000) + 1000;
    case 'launch_proxied_terminal':
      return Math.floor(Math.random() * 9000) + 1000;
    case 'set_terminal_env_proxy':
      return `Browser mock: terminal proxy ${args.enabled}`;
    case 'pick_exe_file':
      return null;
    case 'check_running_processes':
      return (args.names || []).map(name => ({ query: name, is_running: false, process_name: name }));
    case 'kill_process':
      return null;
    case 'window_minimize':
    case 'window_toggle_maximize':
    case 'window_close':
      return null;
    default:
      return null;
  }
}

export function useTauri() {
  const setSystemProxy = useCallback(async (pacUrl) => {
    return invoke('set_system_proxy', { pacUrl, pac_url: pacUrl });
  }, []);

  const clearSystemProxy = useCallback(async () => {
    return invoke('clear_system_proxy');
  }, []);

  const getProxyStatus = useCallback(async () => {
    return invoke('get_proxy_status');
  }, []);

  /**
   * Retrieves the real external WAN IPv4 address.
   * Never returns local/mock IPs like 192.168.1.100.
   */
  const getNativeIp = useCallback(async () => {
    // 1. Try native Rust command first
    try {
      const ip = await invoke('get_public_ip');
      if (ip && /^(\d{1,3}\.){3}\d{1,3}$/.test(ip.trim())) {
        return ip.trim();
      }
    } catch {}

    // 2. Fetch directly from redundant IPv4 providers
    const providers = [
      'https://api4.ipify.org',
      'https://ipv4.icanhazip.com',
      'https://v4.ident.me',
      'https://ifconfig.me/ip',
    ];

    for (const url of providers) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
        if (res.ok) {
          const text = (await res.text()).trim();
          if (/^(\d{1,3}\.){3}\d{1,3}$/.test(text)) {
            return text;
          }
        }
      } catch {}
    }

    throw new Error('Could not detect public IPv4');
  }, []);

  const updatePacRules = useCallback(async (proxyHost, proxyPort, hosts) => {
    return invoke('update_pac_rules', {
      proxyHost,
      proxyPort,
      hosts,
    });
  }, []);

  const pickExeFile = useCallback(async () => {
    return invoke('pick_exe_file');
  }, []);

  const checkRunningProcesses = useCallback(async (names) => {
    return invoke('check_running_processes', { names });
  }, []);

  const killProcess = useCallback(async (exeName) => {
    return invoke('kill_process', { exeName });
  }, []);

  const launchAppWithProxy = useCallback(async (exePath, args, proxyUrl, isolatedProfile = true) => {
    return invoke('launch_app_with_proxy', {
      exePath,
      args: args || null,
      proxyUrl: proxyUrl || null,
      isolatedProfile: Boolean(isolatedProfile),
      isolated_profile: Boolean(isolatedProfile),
    });
  }, []);

  const launchProxiedTerminal = useCallback(async () => {
    return invoke('launch_proxied_terminal');
  }, []);

  const updateUpstreamProxy = useCallback(async (proxyHost, proxyPort) => {
    return invoke('update_upstream_proxy', { proxyHost, proxyPort });
  }, []);

  const setTerminalEnvProxy = useCallback(async (proxyUrl, enabled) => {
    return invoke('set_terminal_env_proxy', {
      proxyUrl: proxyUrl || null,
      enabled: Boolean(enabled),
    });
  }, []);

  const minimizeWindow = useCallback(async () => {
    return invoke('window_minimize');
  }, []);

  const toggleMaximizeWindow = useCallback(async () => {
    return invoke('window_toggle_maximize');
  }, []);

  const closeWindow = useCallback(async () => {
    return invoke('window_close');
  }, []);

  return {
    setSystemProxy,
    clearSystemProxy,
    getProxyStatus,
    getNativeIp,
    updatePacRules,
    updateUpstreamProxy,
    pickExeFile,
    checkRunningProcesses,
    killProcess,
    launchAppWithProxy,
    launchProxiedTerminal,
    setTerminalEnvProxy,
    minimizeWindow,
    toggleMaximizeWindow,
    closeWindow,
    isTauri,
  };
}
