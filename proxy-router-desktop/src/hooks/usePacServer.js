/**
 * usePacServer.js — manages communication with the PAC server.
 *
 * Supports both:
 * 1. Native embedded Rust PAC server via Tauri commands
 * 2. Node.js local PAC sidecar via HTTP (127.0.0.1:8182)
 */

import { useCallback, useState } from 'react';
import { useTauri } from './useTauri';

const PAC_PORT    = 8182;
const PAC_URL     = `http://127.0.0.1:${PAC_PORT}/proxy.pac`;
const HEALTH_URL  = `http://127.0.0.1:${PAC_PORT}/health`;
const UPDATE_URL  = `http://127.0.0.1:${PAC_PORT}/update`;

export function usePacServer() {
  const [isAlive, setIsAlive] = useState(false);
  const { updatePacRules, isTauri } = useTauri();

  /** Check if the PAC server process or embedded server is alive */
  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) });
      const ok = res.ok;
      setIsAlive(ok);
      return ok;
    } catch {
      // In Tauri desktop, the embedded server is always present once initialized
      if (isTauri) {
        setIsAlive(true);
        return true;
      }
      setIsAlive(false);
      return false;
    }
  }, [isTauri]);

  /**
   * Push updated proxy config to the PAC server.
   *
   * @param {object} cfg
   * @param {string}   cfg.proxyHost      – e.g. "203.0.113.10"
   * @param {number}   cfg.proxyPort      – e.g. 3128
   * @param {string[]} cfg.enabledHosts   – e.g. ["*.instagram.com"]
   * @param {string[]} cfg.customDomains  – e.g. ["mysite.com"]
   */
  const updateConfig = useCallback(async (cfg) => {
    const allHosts = [
      ...(cfg.enabledHosts || []).map(d => d.trim().replace(/^\*\./, '').replace(/^\./, '')),
      ...(cfg.customDomains || []).map(d => d.trim().replace(/^\*\./, '').replace(/^\./, '')),
    ].filter(Boolean);

    // 1. If running under Tauri, update native in-memory PAC rules directly
    if (isTauri) {
      try {
        await updatePacRules(cfg.proxyHost || '127.0.0.1', cfg.proxyPort || 3128, allHosts);
        setIsAlive(true);
      } catch (err) {
        console.warn('Native update_pac_rules error:', err);
      }
    }

    // 2. Also send HTTP update to local server if running
    try {
      await fetch(UPDATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
        signal: AbortSignal.timeout(1500),
      });
      setIsAlive(true);
    } catch {
      // expected if node sidecar isn't running
    }

    return PAC_URL;
  }, [isTauri, updatePacRules]);

  return { pacUrl: PAC_URL, isAlive, checkHealth, updateConfig };
}
