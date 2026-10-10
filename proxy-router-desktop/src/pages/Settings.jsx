/**
 * Settings page – server API URL, auth token, PAC server port,
 * Language selector (EN / RU), Windows Autostart toggle (Silent in Tray),
 * and Profile Transfer (Export / Import via Drag & Drop or key).
 */

import { useState, useRef, useEffect } from 'react';
import {
  Eye,
  EyeOff,
  Save,
  Share2,
  Download,
  Upload,
  Copy,
  Check,
  FileText,
  AlertCircle,
  CheckCircle2,
  Info,
  RefreshCw,
  ExternalLink,
  Sliders,
  Radio,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useTauri } from '../hooks/useTauri';
import styles from './Settings.module.css';

const CURRENT_VERSION = '1.0.7';
const GITHUB_REPO = 'D1verlin/ProxyRouterDesktop';
const GITHUB_REPO_URL = 'https://github.com/D1verlin/ProxyRouterDesktop';
const GITHUB_RELEASES_URL = 'https://github.com/D1verlin/ProxyRouterDesktop/releases';

function isNewerVersion(remote, current) {
  const cleanRemote = (remote || '').replace(/^v/, '').split('.').map(Number);
  const cleanCurrent = (current || '').replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const r = cleanRemote[i] || 0;
    const c = cleanCurrent[i] || 0;
    if (r > c) return true;
    if (r < c) return false;
  }
  return false;
}

const openExternalLink = async (url) => {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch {
    window.open(url, '_blank');
  }
};

export default function Settings() {
  const { state, dispatch, t } = useAppStore();
  const { serverConfig, language, autostart } = state;
  const { getAutostartStatus, setAutostart } = useTauri();

  const [form, setForm] = useState({ ...serverConfig });
  const [showToken, setShowToken] = useState(false);
  const [saved, setSaved] = useState(false);

  // Profile import/export states
  const [importText, setImportText] = useState('');
  const [notice, setNotice] = useState(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Sync autostart status from registry on mount
  useEffect(() => {
    getAutostartStatus()
      .then((status) => {
        dispatch({ type: 'SET_AUTOSTART', payload: Boolean(status) });
      })
      .catch(() => {});
  }, [getAutostartStatus, dispatch]);

  // Update checker states
  const [updateState, setUpdateState] = useState({
    status: 'idle', // 'idle' | 'checking' | 'latest' | 'available' | 'error'
    remoteVersion: null,
    releaseUrl: GITHUB_RELEASES_URL,
    releaseName: '',
    message: '',
    checkedAt: null,
  });

  const handleToggleAutostart = async () => {
    const nextVal = !autostart;
    try {
      await setAutostart(nextVal);
      dispatch({ type: 'SET_AUTOSTART', payload: nextVal });
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: {
          category: 'SYS',
          level: 'info',
          msg: nextVal
            ? 'Windows autostart enabled (runs silently in tray)'
            : 'Windows autostart disabled',
        },
      });
      setNotice({
        type: 'success',
        text: nextVal
          ? 'Autostart on boot enabled (silent in tray)'
          : 'Autostart on boot disabled',
      });
      setTimeout(() => setNotice(null), 3000);
    } catch (err) {
      setNotice({
        type: 'error',
        text: `Failed to configure autostart: ${err}`,
      });
    }
  };

  const handleCheckUpdate = async () => {
    setUpdateState((prev) => ({ ...prev, status: 'checking', message: '' }));
    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
        },
      });

      const now = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      if (res.status === 404) {
        setUpdateState({
          status: 'latest',
          remoteVersion: null,
          releaseUrl: GITHUB_RELEASES_URL,
          releaseName: '',
          message: `${t('settings.latestVersion', 'You are using the latest version')} (v${CURRENT_VERSION})`,
          checkedAt: now,
        });
        return;
      }

      if (!res.ok) {
        throw new Error(`GitHub API error: HTTP ${res.status}`);
      }

      const data = await res.json();
      const tag = data.tag_name || '';
      const isNewer = isNewerVersion(tag, CURRENT_VERSION);

      if (isNewer) {
        setUpdateState({
          status: 'available',
          remoteVersion: tag,
          releaseUrl: data.html_url || GITHUB_RELEASES_URL,
          releaseName: data.name || tag,
          message: `${t('settings.updateAvailable', 'Update available')}: ${tag}`,
          checkedAt: now,
        });
      } else {
        setUpdateState({
          status: 'latest',
          remoteVersion: tag,
          releaseUrl: data.html_url || GITHUB_RELEASES_URL,
          releaseName: data.name || tag,
          message: `${t('settings.latestVersion', 'You are using the latest version')} (v${CURRENT_VERSION})`,
          checkedAt: now,
        });
      }
    } catch (err) {
      const now = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      setUpdateState({
        status: 'error',
        remoteVersion: null,
        releaseUrl: GITHUB_RELEASES_URL,
        releaseName: '',
        message: err.message || t('settings.errorUpdates', 'Failed to check updates'),
        checkedAt: now,
      });
    }
  };

  const handleChange = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = () => {
    dispatch({ type: 'UPDATE_SERVER_CONFIG', payload: form });
    dispatch({
      type: 'ADD_LOG_ENTRY',
      payload: { category: 'SYS', level: 'info', msg: 'Server configuration updated' },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // ── Profile Export ───────────────────────────────────────────────────────────
  const getProfileData = () => {
    let host = '127.0.0.1';
    let port = 3128;
    try {
      const u = new URL(form.apiUrl);
      host = u.hostname;
    } catch {}

    return {
      app: 'ProxyRouter',
      version: '1.0.8',
      apiUrl: form.apiUrl,
      authToken: form.authToken,
      proxyHost: host,
      proxyPort: port,
      exportedAt: new Date().toISOString(),
    };
  };

  const handleExportCopy = () => {
    const data = getProfileData();
    const encoded = 'pr://' + btoa(unescape(encodeURIComponent(JSON.stringify(data))));
    navigator.clipboard.writeText(encoded);
    setCopiedKey(true);
    setNotice({ type: 'success', text: t('common.copied', 'Copied to clipboard') });
    setTimeout(() => setCopiedKey(false), 2500);
  };

  const handleExportDownload = () => {
    const data = getProfileData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `proxy-router-profile-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setNotice({ type: 'success', text: 'Profile configuration (.json) downloaded' });
  };

  // ── Profile Import Logic ─────────────────────────────────────────────────────
  const applyProfileData = (rawText) => {
    try {
      let jsonStr = rawText.trim();

      if (jsonStr.startsWith('pr://')) {
        const b64 = jsonStr.slice(5);
        jsonStr = decodeURIComponent(escape(atob(b64)));
      }

      const parsed = JSON.parse(jsonStr);

      if (!parsed.apiUrl && !parsed.authToken) {
        throw new Error('Profile must contain at least an apiUrl or authToken');
      }

      const updated = {
        apiUrl: parsed.apiUrl || form.apiUrl,
        authToken: parsed.authToken || form.authToken,
      };

      setForm(updated);
      dispatch({ type: 'UPDATE_SERVER_CONFIG', payload: updated });
      dispatch({
        type: 'ADD_LOG_ENTRY',
        payload: {
          category: 'AUTH',
          level: 'info',
          msg: `Imported profile configuration (${updated.apiUrl})`,
        },
      });

      setNotice({
        type: 'success',
        text: `Profile loaded successfully! API URL: ${updated.apiUrl}`,
      });
      setImportText('');
    } catch (err) {
      setNotice({
        type: 'error',
        text: `Failed to parse profile: ${err.message || 'Invalid format'}`,
      });
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      try {
        const text = await file.text();
        applyProfileData(text);
      } catch (err) {
        setNotice({ type: 'error', text: `Could not read dropped file: ${err.message}` });
      }
    }
  };

  const handleFileInputChange = async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const text = await file.text();
        applyProfileData(text);
      } catch (err) {
        setNotice({ type: 'error', text: `Could not read file: ${err.message}` });
      }
      e.target.value = '';
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('settings.title', 'Settings & Preferences')}</h1>
        <p className={styles.subtitle}>{t('settings.subtitle', 'Configure proxy credentials, system startup, language, and profile sharing.')}</p>
      </header>

      {notice && (
        <div
          className={`${styles.noticeBanner} ${
            notice.type === 'error' ? styles.noticeError : styles.noticeSuccess
          }`}
        >
          {notice.type === 'error' ? (
            <AlertCircle size={14} className={styles.noticeIcon} />
          ) : (
            <CheckCircle2 size={14} className={styles.noticeIcon} />
          )}
          <span>{notice.text}</span>
          <button
            type="button"
            className={styles.noticeClose}
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      )}

      <div className={styles.form}>
        {/* ── Section 1: General Preferences & Windows Integration ─────────── */}
        <div className={styles.sectionHeader}>
          <Sliders size={16} />
          <h2 className={styles.sectionTitle}>{t('settings.sectionGeneral', 'General & System Integration')}</h2>
        </div>

        {/* Interface Language */}
        <div className={styles.field}>
          <label className={styles.label}>{t('settings.languageLabel', 'Interface Language')}</label>
          <div className={styles.segmentedControl}>
            <button
              type="button"
              className={`${styles.segmentBtn} ${language === 'en' ? styles.segmentBtnActive : ''}`}
              onClick={() => dispatch({ type: 'SET_LANGUAGE', payload: 'en' })}
            >
              English
            </button>
            <button
              type="button"
              className={`${styles.segmentBtn} ${language === 'ru' ? styles.segmentBtnActive : ''}`}
              onClick={() => dispatch({ type: 'SET_LANGUAGE', payload: 'ru' })}
            >
              Русский
            </button>
          </div>
          <p className={styles.hint}>{t('settings.languageDesc', 'Choose your preferred language for the application.')}</p>
        </div>

        {/* Windows Autostart Toggle */}
        <div className={styles.toggleCard}>
          <div className={styles.toggleInfo}>
            <span className={styles.toggleTitle}>{t('settings.autostartLabel', 'Launch on Windows Startup')}</span>
            <span className={styles.toggleDesc}>
              {t(
                'settings.autostartDesc',
                'Automatically start Proxy Router in the system tray when computer boots (runs silently without window).'
              )}
            </span>
          </div>
          <label className={styles.switch}>
            <input
              type="checkbox"
              checked={Boolean(autostart)}
              onChange={handleToggleAutostart}
            />
            <span className={styles.slider} />
          </label>
        </div>

        <hr className={styles.separator} />

        {/* ── Section 2: Server & Authentication ────────────────────────────── */}
        <div className={styles.sectionHeader}>
          <Radio size={16} />
          <h2 className={styles.sectionTitle}>{t('settings.sectionServer', 'Server & Authentication')}</h2>
        </div>

        {/* API URL */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="apiUrl">
            {t('settings.apiUrlLabel', 'Whitelist API URL')}
          </label>
          <input
            id="apiUrl"
            type="text"
            className="input"
            placeholder={t('settings.apiUrlPlaceholder', 'http://your-server-ip:1135')}
            value={form.apiUrl}
            onChange={(e) => handleChange('apiUrl', e.target.value)}
          />
          <p className={styles.hint}>
            {t('settings.apiUrlHint', 'Endpoint receiving POST /api/whitelist requests.')}
          </p>
        </div>

        {/* Auth token */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="authToken">
            {t('settings.tokenLabel', 'Authorization Token (Bearer Key)')}
          </label>
          <div className={styles.tokenRow}>
            <input
              id="authToken"
              type={showToken ? 'text' : 'password'}
              className="input"
              placeholder={t('settings.tokenPlaceholder', 'Bearer authorization key')}
              value={form.authToken}
              onChange={(e) => handleChange('authToken', e.target.value)}
            />
            <button
              type="button"
              className="btn-icon"
              onClick={() => setShowToken((v) => !v)}
              aria-label={showToken ? 'Hide token' : 'Show token'}
              title={showToken ? 'Hide token' : 'Show token'}
            >
              {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        {/* PAC server port info */}
        <div className={styles.infoCard}>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>PAC Auto-Config URL</span>
            <span className="mono" style={{ color: 'var(--text-primary)', fontSize: 12 }}>
              http://127.0.0.1:8182/proxy.pac
            </span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>Local Forwarder Port</span>
            <span className="mono" style={{ color: 'var(--text-primary)', fontSize: 12 }}>
              127.0.0.1:8183 (CONNECT Tunnel)
            </span>
          </div>
        </div>

        {/* Save */}
        <div className={styles.actions}>
          <button type="button" className="btn-primary" onClick={handleSave}>
            <Save size={14} />
            {saved ? t('common.saved', 'Saved') : t('settings.btnSave', 'Save Credentials')}
          </button>
        </div>

        <hr className={styles.separator} />

        {/* ── Section 3: Profile Export & Import Section ────────────────────── */}
        <div className={styles.profileSection}>
          <div className={styles.sectionHeader}>
            <Share2 size={16} />
            <h2 className={styles.sectionTitle}>
              {t('settings.sectionTransfer', 'Profile Transfer (Export & Import)')}
            </h2>
          </div>
          <p className={styles.subtitle}>
            {t(
              'settings.transferDesc',
              'Instantly share your proxy credentials and settings with another PC.'
            )}
          </p>

          {/* Export Actions */}
          <div className={styles.exportCard}>
            <div className={styles.exportHeader}>
              <span className={styles.cardHeading}>
                {t('settings.exportTitle', 'Export Current Profile')}
              </span>
              <span className={styles.tag}>{t('common.ready', 'Ready')}</span>
            </div>
            <p className={styles.cardDesc}>
              {t(
                'settings.exportDesc',
                'Copy shareable compact key or download JSON configuration file.'
              )}
            </p>
            <div className={styles.buttonGroup}>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleExportCopy}
                title="Copy shareable pr:// token to clipboard"
              >
                {copiedKey ? <Check size={14} /> : <Copy size={14} />}
                {copiedKey ? t('common.copied', 'Copied') : t('settings.btnCopyKey', 'Copy Share Key')}
              </button>

              <button
                type="button"
                className="btn-secondary"
                onClick={handleExportDownload}
                title="Download JSON configuration"
              >
                <Download size={14} />
                {t('settings.btnDownloadJson', 'Download .json')}
              </button>
            </div>
          </div>

          {/* Import Drag & Drop Zone */}
          <div
            className={`${styles.dropZone} ${isDragOver ? styles.dropZoneActive : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.txt"
              style={{ display: 'none' }}
              onChange={handleFileInputChange}
            />
            <Upload size={22} className={styles.dropIcon} />
            <div className={styles.dropText}>
              <strong>{t('settings.dropZoneTitle', 'Drag & drop profile file (.json) here')}</strong>
              <span>{t('settings.dropZoneDesc', 'or click to browse from disk')}</span>
            </div>
          </div>

          {/* Paste Key or JSON */}
          <div className={styles.pasteCard}>
            <label className={styles.label} htmlFor="importText">
              {t('settings.pasteLabel', 'Or Paste Share Key / JSON')}
            </label>
            <div className={styles.inputRow}>
              <input
                id="importText"
                type="text"
                className="input"
                placeholder={t('settings.pastePlaceholder', 'pr://eyJhcH... or paste JSON profile')}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyProfileData(importText);
                }}
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={!importText.trim()}
                onClick={() => applyProfileData(importText)}
              >
                <FileText size={14} />
                {t('settings.btnLoad', 'Load Profile')}
              </button>
            </div>
          </div>
        </div>

        <hr className={styles.separator} />

        {/* ── Section 4: About & Updates Section ────────────────────────────── */}
        <div className={styles.aboutSection}>
          <div className={styles.sectionHeader}>
            <Info size={16} />
            <h2 className={styles.sectionTitle}>{t('settings.sectionAbout', 'About & Updates')}</h2>
          </div>
          <p className={styles.subtitle}>
            {t('settings.aboutDesc', 'Client build details, GitHub repository, and update checker.')}
          </p>

          <div className={styles.aboutCard}>
            <div className={styles.aboutGrid}>
              <div className={styles.aboutRow}>
                <span className={styles.aboutLabel}>{t('settings.appLabel', 'Application')}</span>
                <span className={styles.aboutValue}>Proxy Router Desktop</span>
              </div>
              <div className={styles.aboutRow}>
                <span className={styles.aboutLabel}>{t('settings.versionLabel', 'Client Version')}</span>
                <div className={styles.versionBadgeGroup}>
                  <span
                    className="mono"
                    style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}
                  >
                    v{CURRENT_VERSION}
                  </span>
                  <span className={styles.tag}>STABLE</span>
                </div>
              </div>
              <div className={styles.aboutRow}>
                <span className={styles.aboutLabel}>{t('settings.platformLabel', 'Platform')}</span>
                <span className="mono" style={{ color: 'var(--text-sec)', fontSize: 12 }}>
                  Windows x64 • Tauri 2 + Rust
                </span>
              </div>
              <div className={styles.aboutRow}>
                <span className={styles.aboutLabel}>{t('settings.repoLabel', 'Repository')}</span>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => openExternalLink(GITHUB_REPO_URL)}
                  title="Open GitHub repository"
                >
                  <span className="mono" style={{ fontSize: 12 }}>
                    github.com/{GITHUB_REPO}
                  </span>
                  <ExternalLink size={12} />
                </button>
              </div>
            </div>

            {/* Update Checker Block */}
            <div className={styles.updateBlock}>
              <div className={styles.updateHeader}>
                <div className={styles.updateTitleGroup}>
                  <span className={styles.cardHeading}>
                    {t('settings.updatesTitle', 'Software Updates')}
                  </span>
                  {updateState.checkedAt && (
                    <span className={styles.checkedTime}>
                      {t('settings.lastChecked', 'Checked:')} {updateState.checkedAt}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleCheckUpdate}
                  disabled={updateState.status === 'checking'}
                >
                  <RefreshCw
                    size={13}
                    className={updateState.status === 'checking' ? styles.spin : ''}
                  />
                  {updateState.status === 'checking'
                    ? t('settings.btnChecking', 'Checking...')
                    : t('settings.btnCheckUpdates', 'Check for Updates')}
                </button>
              </div>

              {/* Status Messages */}
              {updateState.status === 'latest' && (
                <div className={styles.updateStatusLatest}>
                  <CheckCircle2 size={15} className={styles.statusSuccessIcon} />
                  <span>{updateState.message}</span>
                </div>
              )}

              {updateState.status === 'available' && (
                <div className={styles.updateStatusAvailable}>
                  <div className={styles.availableInfo}>
                    <span className={styles.availableTag}>NEW RELEASE</span>
                    <span className={styles.availableText}>{updateState.message}</span>
                  </div>
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ padding: '6px 12px', fontSize: 12 }}
                    onClick={() => openExternalLink(updateState.releaseUrl)}
                  >
                    <Download size={13} />
                    {t('settings.btnDownloadUpdate', 'Download Update')}
                  </button>
                </div>
              )}

              {updateState.status === 'error' && (
                <div className={styles.updateStatusError}>
                  <AlertCircle size={15} />
                  <span>{updateState.message}</span>
                  <button
                    type="button"
                    className={styles.errorLink}
                    onClick={() => openExternalLink(GITHUB_RELEASES_URL)}
                  >
                    {t('settings.manualReleases', 'Open GitHub Releases')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
