/**
 * VelaHeroDashboard.jsx — Signature Landing Page Hero & Bottom Strip Dashboard
 *
 * Designed to strictly adhere to the official website aesthetic:
 * 1. 3D cycling ticker clock with mask overlay tint layer (mix-blend-mode: color).
 * 2. State-aware dynamic text:
 *    - Idle: Connect / Browse / Work / Route (Общайся / Сёрфи / Работай / Маршрутизируй)
 *    - Connecting: Connecting (Подключение) + authorizing gateway... (авторизация шлюза...)
 *    - Active: Protected / Streaming / Encrypted / Routing (Защищено / Стриминг / Зашифровано / Маршрутизируется)
 *    - Disconnecting: Disconnecting (Отключение) + closing tunnel... (закрытие туннеля...)
 * 3. Fully localized via useAppStore t(...) for seamless Russian and English support.
 * 4. High-contrast action button ("Connect Proxy" / "Disconnect Proxy").
 * 5. Compact, elegant "Not Configured →" pill if server settings are missing.
 * 6. Pinned-to-bottom telemetry strip without dark container boxes or borders.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Copy, Check, ShieldCheck, Power } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { clayIcons } from '../assets/clayIcons';
import ClayIcon from './ClayIcon';
import styles from './VelaHeroDashboard.module.css';

const IDLE_STATES = [
  { key: 'connect', icon: clayIcons.chat, tint: '#E9C22E', colorKey: 'yellow' },
  { key: 'browse',  icon: clayIcons.surf, tint: '#F2772F', colorKey: 'peach' },
  { key: 'work',    icon: clayIcons.work, tint: '#3FB874', colorKey: 'green' },
  { key: 'route',   icon: clayIcons.route, tint: '#C564C4', colorKey: 'purple' },
];

const ACTIVE_STATES = [
  { key: 'protected', icon: clayIcons.work,  tint: '#3FB874', colorKey: 'green' },
  { key: 'streaming', icon: clayIcons.surf,  tint: '#F2772F', colorKey: 'peach' },
  { key: 'encrypted', icon: clayIcons.chat,  tint: '#C564C4', colorKey: 'purple' },
  { key: 'routing',   icon: clayIcons.route, tint: '#E9C22E', colorKey: 'yellow' },
];

const SLOT_DURATION = 3000;
const LEAVE_DURATION = 420;

export default function VelaHeroDashboard({
  isActive,
  isConnecting,
  isDisconnecting,
  isUnconfiguredWarning,
  isConfigured,
  activeServices = [],
  onToggle,
  disabled,
  publicIp,
  onRefreshIp,
  onOpenSettings,
}) {
  const navigate = useNavigate();
  const { t } = useAppStore();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [animStage, setAnimStage] = useState('enter'); // 'enter' | 'leave'
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Pick active states array depending on proxy status
  const currentStates = useMemo(() => {
    return isActive ? ACTIVE_STATES : IDLE_STATES;
  }, [isActive]);

  // Reset index when switching between active and idle sets
  useEffect(() => {
    setCurrentIndex(0);
    setAnimStage('enter');
  }, [isActive]);

  // Cycling ticker clock
  useEffect(() => {
    if (isConnecting || isDisconnecting) return;

    let leaveTimer = null;
    let nextTimer = null;

    setAnimStage('enter');

    leaveTimer = setTimeout(() => {
      setAnimStage('leave');
      nextTimer = setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % currentStates.length);
      }, LEAVE_DURATION);
    }, SLOT_DURATION - LEAVE_DURATION);

    return () => {
      clearTimeout(leaveTimer);
      clearTimeout(nextTimer);
    };
  }, [currentIndex, currentStates.length, isConnecting, isDisconnecting]);

  const rawState = currentStates[currentIndex] || currentStates[0];

  // Resolve dynamic word, static row, and icon based on connection state
  const displayConfig = useMemo(() => {
    if (isConnecting) {
      return {
        word: t('vela.ticker.connecting', 'Connecting'),
        staticRow: t('vela.ticker.connectingSub', 'authorizing gateway...'),
        icon: clayIcons.route,
        tint: '#EAB308',
        colorKey: 'connecting',
      };
    }
    if (isDisconnecting) {
      return {
        word: t('vela.ticker.disconnecting', 'Disconnecting'),
        staticRow: t('vela.ticker.disconnectingSub', 'closing tunnel...'),
        icon: clayIcons.route,
        tint: '#99958F',
        colorKey: 'disconnecting',
      };
    }
    return {
      word: t(`vela.ticker.${rawState.key}`, rawState.key),
      staticRow: t('vela.ticker.staticRow', 'on your terms'),
      icon: rawState.icon,
      tint: rawState.tint,
      colorKey: rawState.colorKey,
    };
  }, [isConnecting, isDisconnecting, rawState, t]);

  // Notify ambient backdrop and sidebar rail of dynamic ticker color
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('vela:hero-color', {
        detail: {
          colorKey: displayConfig.colorKey,
          tint: displayConfig.tint,
        },
      })
    );
  }, [displayConfig.colorKey, displayConfig.tint]);

  const handleCopyIp = useCallback(() => {
    if (!publicIp) return;
    navigator.clipboard.writeText(publicIp);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [publicIp]);

  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await onRefreshIp();
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  }, [onRefreshIp]);

  return (
    <div className={styles.container}>
      {/* ─── 1. TOP HERO AREA ─────────────────────────────────────── */}
      <div className={styles.heroArea}>
        <div className={styles.headlineWrap}>
          <h1 className={styles.headline}>
            <span className={styles.headlineRowDynamic}>
              <span className={styles.wordSlot}>
                <span className={`${styles.iconWrapper} ${animStage === 'enter' ? styles.iconEnter : styles.iconLeave}`}>
                  <span className={styles.iconFloatWrapper}>
                    <ClayIcon
                      icon={displayConfig.icon}
                      tint={displayConfig.tint}
                      size="100%"
                      active={true}
                    />
                  </span>
                </span>
                <span className={`${styles.dynamicWord} ${animStage === 'enter' ? styles.wordEnter : styles.wordLeave}`}>
                  {displayConfig.word}
                </span>
              </span>
            </span>
            <span className={styles.headlineRowStatic}>
              {displayConfig.staticRow}
            </span>
          </h1>
        </div>

        {/* Action Row: Connect button + compact Not Configured badge */}
        <div className={styles.actionRow}>
          <button
            type="button"
            className={`${styles.actionBtn} ${isActive ? styles.actionBtnActive : ''} ${
              disabled ? styles.actionBtnDisabled : ''
            }`}
            onClick={onToggle}
            disabled={disabled}
          >
            {isConnecting || isDisconnecting ? (
              <RefreshCw size={19} className={styles.miniBtnSpin} />
            ) : isActive ? (
              <ShieldCheck size={19} className={styles.actionIcon} />
            ) : (
              <Power size={19} className={styles.actionIcon} />
            )}
            <span>
              {isConnecting
                ? t('vela.btnConnecting', 'Connecting...')
                : isDisconnecting
                ? t('vela.btnDisconnecting', 'Disconnecting...')
                : isActive
                ? t('vela.btnDisconnect', 'Disconnect Proxy')
                : t('vela.btnConnect', 'Connect Proxy')}
            </span>
          </button>

          {!isConfigured && (
            <button
              type="button"
              className={styles.compactUnconfigured}
              onClick={onOpenSettings}
              title={t('vela.configureSettings', 'Configure proxy in Settings')}
            >
              <span className={styles.warningDot} />
              <span>{t('vela.notConfigured', 'Not Configured →')}</span>
            </button>
          )}
        </div>
      </div>

      {/* ─── 2. PINNED-TO-BOTTOM TELEMETRY STRIP ───────────────────── */}
      <footer className={styles.bottomStrip} aria-label="Connection Telemetry">
        {/* Left: Status */}
        <div className={styles.statusPillGroup}>
          <span
            className={`${styles.statusIndicatorDot} ${
              isActive
                ? styles.dotActive
                : isConnecting || isDisconnecting
                ? styles.dotConnecting
                : ''
            }`}
          />
          <span className={styles.statusText}>
            {isActive
              ? `${t('vela.statusActive', 'Active')} (${activeServices.length} ${t('vela.servicesRouted', 'services routed')})`
              : isConnecting
              ? t('vela.ticker.connectingSub', 'authorizing gateway...')
              : isDisconnecting
              ? t('vela.ticker.disconnectingSub', 'closing tunnel...')
              : !isConfigured
              ? t('vela.statusUnconfigured', 'Server not configured')
              : t('vela.statusDirect', 'Direct connection')}
          </span>
        </div>

        {/* Center: Real Public IPv4 */}
        <div className={styles.ipCenterGroup}>
          <span className={styles.ipLabel}>{t('vela.yourIp', 'Your IP:')}</span>
          <span className={styles.ipValue}>
            {publicIp || t('vela.detecting', 'Detecting...')}
          </span>
          <button
            type="button"
            className={styles.miniBtn}
            onClick={handleManualRefresh}
            title={t('vela.refreshIp', 'Refresh public IP')}
          >
            <RefreshCw size={12} className={isRefreshing ? styles.miniBtnSpin : ''} />
          </button>
          <button
            type="button"
            className={styles.miniBtn}
            onClick={handleCopyIp}
            title={t('vela.copyIp', 'Copy IP to clipboard')}
          >
            {copied ? <Check size={12} color="#10B981" /> : <Copy size={12} />}
          </button>
        </div>

        {/* Right: Routed Services count + line-art planet */}
        <div className={styles.rightGroup}>
          <button
            type="button"
            className={styles.servicesLink}
            onClick={() => navigate('/sites')}
            title="View routed AI and custom services"
          >
            {activeServices.length} {t('vela.servicesRouted', 'services routed')}
          </button>

          <svg
            className={styles.statsPlanet}
            viewBox="0 0 48 48"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="24" cy="24" r="14" />
            <path d="M37.63 27.16c4.58 4.28 7.09 8 6.18 9.8-1.49 2.92-11.57-.52-22.51-7.68-10.94-7.16-18.61-15.33-17.12-18.25.93-1.82 5.85-.89 11.61 1.61" />
          </svg>
        </div>
      </footer>
    </div>
  );
}
