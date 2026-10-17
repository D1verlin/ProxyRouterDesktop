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
    case 'test_upstream_proxy':
      return { ok: true, latency_ms: 45, protocol: args.proxyProtocol || 'http', target: '2.27.25.190:3128' };
    case 'launch_app_with_proxy':
      return Math.floor(Math.random() * 9000) + 1000;
    case 'launch_proxied_terminal':
      return Math.floor(Math.random() * 9000) + 1000;
    case 'set_terminal_env_proxy':
      return `Browser mock: terminal proxy ${args.enabled}`;
    case 'get_network_adapters':
      return [
        {
          name: 'Ethernet',
          index: 1,
          description: 'Intel(R) Ethernet Connection',
          status: 'Up',
          ipv4_dns: ['1.1.1.1', '1.0.0.1'],
          ipv6_dns: [],
          is_dhcp: true,
        },
      ];
    case 'set_active_dns':
      return `Browser mock: active DNS set to ${args.providerId || args.provider_id}`;
    case 'apply_adapter_dns':
      return `Browser mock: applied DNS to adapter ${args.adapterIndex || args.adapter_index}`;
    case 'reset_adapter_dns':
      return `Browser mock: reset adapter ${args.adapterIndex || args.adapter_index}`;
    case 'test_dns_latency':
      return (args.servers || []).map(s => ({ server: s, latency_ms: Math.floor(Math.random() * 25) + 8, error: null }));
    case 'restore_network_defaults':
      return 'Browser mock: network defaults restored';
    case 'pick_exe_file':
      return null;
    case 'check_running_processes':
      return (args.names || []).map(name => ({ query: name, is_running: false, process_name: name }));
    case 'kill_process':
      return null;
    case 'get_autostart_status':
      return false;
    case 'set_autostart':
      return null;
    case 'update_tray_icon':
      return null;
    case 'app_quit':
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
  const setSystemProxy = useCallback(async (pacUrl, setEnv = true) => {
    return invoke('set_system_proxy', {
      pacUrl,
      pac_url: pacUrl,
      setEnv,
      set_env: setEnv,
    });
  }, []);

  const clearSystemProxy = useCallback(async () => {
    return invoke('clear_system_proxy');
  }, []);

  const apiWhitelistRequest = useCallback(async (url, method = 'GET', token = '', ip = null) => {
    if (isTauri) {
      const res = await invoke('api_whitelist_request', {
        url,
        method: method.toUpperCase(),
        token: token || null,
        ip: ip || null,
      });
      if (res && typeof res === 'object' && res.error) {
        throw new Error(res.error);
      }
      return res;
    }

    // Fallback for browser mode
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token.replace(/^Bearer\s+/i, '')}`;
    if (ip && method !== 'GET') headers['Content-Type'] = 'application/json';
    const opts = { method, headers, signal: AbortSignal.timeout(8000) };
    if (ip && method !== 'GET') opts.body = JSON.stringify({ ip });
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
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

  const updatePacRules = useCallback(async (proxyHost, proxyPort, hosts, proxyProtocol = 'http', ignoreTls = true) => {
    return invoke('update_pac_rules', {
      proxyHost,
      proxyPort,
      hosts,
      proxyProtocol,
      proxy_protocol: proxyProtocol,
      ignoreTls: Boolean(ignoreTls),
      ignore_tls: Boolean(ignoreTls),
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

  const updateUpstreamProxy = useCallback(async (proxyHost, proxyPort, proxyProtocol = 'http', ignoreTls = true) => {
    return invoke('update_upstream_proxy', {
      proxyHost,
      proxyPort,
      proxyProtocol,
      proxy_protocol: proxyProtocol,
      ignoreTls: Boolean(ignoreTls),
      ignore_tls: Boolean(ignoreTls),
    });
  }, []);

  const setTerminalEnvProxy = useCallback(async (proxyUrl, enabled) => {
    return invoke('set_terminal_env_proxy', {
      proxyUrl: proxyUrl || null,
      enabled: Boolean(enabled),
    });
  }, []);

  const getAutostartStatus = useCallback(async () => {
    return invoke('get_autostart_status');
  }, []);

  const setAutostart = useCallback(async (enabled) => {
    return invoke('set_autostart', { enabled: Boolean(enabled) });
  }, []);

  const updateTrayIcon = useCallback(async (active) => {
    return invoke('update_tray_icon', { active: Boolean(active) });
  }, []);

  const appQuit = useCallback(async () => {
    return invoke('app_quit');
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

  const getNetworkAdapters = useCallback(async () => {
    return invoke('get_network_adapters');
  }, []);

  const setActiveDns = useCallback(async (providerId, serversV4, serversV6 = []) => {
    return invoke('set_active_dns', {
      providerId,
      provider_id: providerId,
      serversV4: serversV4 || [],
      servers_v4: serversV4 || [],
      serversV6: serversV6 || [],
      servers_v6: serversV6 || [],
    });
  }, []);

  const applyAdapterDns = useCallback(async (adapterIndex, serversV4, serversV6 = []) => {
    return invoke('apply_adapter_dns', {
      adapterIndex: Number(adapterIndex),
      adapter_index: Number(adapterIndex),
      serversV4: serversV4 || [],
      servers_v4: serversV4 || [],
      serversV6: serversV6 || [],
      servers_v6: serversV6 || [],
    });
  }, []);

  const resetAdapterDns = useCallback(async (adapterIndex) => {
    return invoke('reset_adapter_dns', {
      adapterIndex: Number(adapterIndex),
      adapter_index: Number(adapterIndex),
    });
  }, []);

  const testDnsLatency = useCallback(async (servers) => {
    return invoke('test_dns_latency', { servers });
  }, []);

  const testUpstreamProxy = useCallback(async (proxyHost, proxyPort, proxyProtocol = 'http') => {
    return invoke('test_upstream_proxy', {
      proxyHost,
      proxy_host: proxyHost,
      proxyPort: Number(proxyPort),
      proxy_port: Number(proxyPort),
      proxyProtocol,
      proxy_protocol: proxyProtocol,
    });
  }, []);

  const restoreNetworkDefaults = useCallback(async () => {
    return invoke('restore_network_defaults');
  }, []);

  return {
    setSystemProxy,
    clearSystemProxy,
    getProxyStatus,
    apiWhitelistRequest,
    getNativeIp,
    updatePacRules,
    updateUpstreamProxy,
    testUpstreamProxy,
    pickExeFile,
    checkRunningProcesses,
    killProcess,
    launchAppWithProxy,
    launchProxiedTerminal,
    setTerminalEnvProxy,
    getAutostartStatus,
    setAutostart,
    updateTrayIcon,
    appQuit,
    minimizeWindow,
    toggleMaximizeWindow,
    closeWindow,
    getNetworkAdapters,
    setActiveDns,
    applyAdapterDns,
    resetAdapterDns,
    testDnsLatency,
    restoreNetworkDefaults,
    isTauri,
  };
}
