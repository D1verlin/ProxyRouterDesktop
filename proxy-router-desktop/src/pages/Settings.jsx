/**
 * Settings page – server API URL, auth token, PAC server port,
 * and Profile Transfer (Export / Import via Drag & Drop or key).
 */

import { useState, useRef } from 'react';
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
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import styles from './Settings.module.css';

const CURRENT_VERSION = '1.0.2';
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
  const { state, dispatch } = useAppStore();
  const { serverConfig } = state;
  const [form, setForm] = useState({ ...serverConfig });
  const [showToken, setShowToken] = useState(false);
  const [saved, setSaved] = useState(false);

  // Profile import/export states
  const [importText, setImportText] = useState('');
  const [notice, setNotice] = useState(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Update checker states
  const [updateState, setUpdateState] = useState({
    status: 'idle', // 'idle' | 'checking' | 'latest' | 'available' | 'error'
    remoteVersion: null,
    releaseUrl: GITHUB_RELEASES_URL,
    releaseName: '',
    message: '',
    checkedAt: null,
  });

  const handleCheckUpdate = async () => {
    setUpdateState(prev => ({ ...prev, status: 'checking', message: '' }));
    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
        },
      });

      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      if (res.status === 404) {
        setUpdateState({
          status: 'latest',
          remoteVersion: null,
          releaseUrl: GITHUB_RELEASES_URL,
          releaseName: '',
          message: `Релизов на GitHub пока нет. Ваша версия v${CURRENT_VERSION} является актуальной.`,
          checkedAt: now,
        });
        return;
      }

      if (!res.ok) {
        throw new Error(`GitHub API вернул статус ${res.status}`);
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
          message: `Доступна новая версия: ${tag}`,
          checkedAt: now,
        });
      } else {
        setUpdateState({
          status: 'latest',
          remoteVersion: tag,
          releaseUrl: data.html_url || GITHUB_RELEASES_URL,
          releaseName: data.name || tag,
          message: `У вас установлена последняя версия (v${CURRENT_VERSION})`,
          checkedAt: now,
        });
      }
    } catch (err) {
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setUpdateState({
        status: 'error',
        remoteVersion: null,
        releaseUrl: GITHUB_RELEASES_URL,
        releaseName: '',
        message: err.message || 'Ошибка подключения к серверу обновлений',
        checkedAt: now,
      });
    }
  };

  const handleChange = (key, value) => setForm(f => ({ ...f, [key]: value }));

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
    // Derive proxy host/port from API url if possible, default to Squid standard
    let host = '127.0.0.1';
    let port = 3128;
    try {
      const u = new URL(form.apiUrl);
      host = u.hostname;
    } catch {}

    return {
      app: 'ProxyRouter',
      version: '1.0.2',
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
    setNotice({ type: 'success', text: 'Profile key copied to clipboard (pr://...)' });
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
    setNotice({ type: 'success', text: 'Profile file (.json) downloaded' });
  };

  // ── Profile Import Logic ─────────────────────────────────────────────────────
  const applyProfileData = (rawText) => {
    try {
      let jsonStr = rawText.trim();

      // Handle pr:// base64 tokens
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

  // Drag and Drop handlers
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
        <h1 className={styles.title}>Settings & Configuration</h1>
        <p className={styles.subtitle}>
          Manage proxy whitelist API connection, keys, and fast profile sharing.
        </p>
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
        {/* API URL */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="apiUrl">Whitelist API URL</label>
          <input
            id="apiUrl"
            type="text"
            className="input"
            placeholder="http://your-server-ip:1135"
            value={form.apiUrl}
            onChange={e => handleChange('apiUrl', e.target.value)}
          />
          <p className={styles.hint}>
            Endpoint receiving <span className="mono">POST /api/whitelist</span> requests.
          </p>
        </div>

        {/* Auth token */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="authToken">Authorization Token (Key)</label>
          <div className={styles.tokenRow}>
            <input
              id="authToken"
              type={showToken ? 'text' : 'password'}
              className="input"
              placeholder="Bearer authorization key"
              value={form.authToken}
              onChange={e => handleChange('authToken', e.target.value)}
            />
            <button
              type="button"
              className="btn-icon"
              onClick={() => setShowToken(v => !v)}
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
            <span className={styles.infoLabel}>Local PAC Port</span>
            <span className="mono" style={{ color: 'var(--text-primary)', fontSize: 12 }}>8182</span>
          </div>
        </div>

        {/* Save */}
        <div className={styles.actions}>
          <button type="button" className="btn-primary" onClick={handleSave}>
            <Save size={14} />
            {saved ? 'Saved' : 'Save Credentials'}
          </button>
        </div>

        <hr className={styles.separator} />

        {/* Profile Export & Import Section */}
        <div className={styles.profileSection}>
          <div className={styles.sectionHeader}>
            <Share2 size={16} />
            <h2 className={styles.sectionTitle}>Profile Transfer (Export & Import)</h2>
          </div>
          <p className={styles.subtitle}>
            Instantly share your proxy IP, port, and authentication key with another PC.
          </p>

          {/* Export Actions */}
          <div className={styles.exportCard}>
            <div className={styles.exportHeader}>
              <span className={styles.cardHeading}>Export Current Profile</span>
              <span className={styles.tag}>Ready</span>
            </div>
            <p className={styles.cardDesc}>
              Share as a compact key string or download a profile configuration file.
            </p>
            <div className={styles.buttonGroup}>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleExportCopy}
                title="Copy shareable pr:// token to clipboard"
              >
                {copiedKey ? <Check size={14} /> : <Copy size={14} />}
                {copiedKey ? 'Key Copied!' : 'Copy Share Key'}
              </button>

              <button
                type="button"
                className="btn-secondary"
                onClick={handleExportDownload}
                title="Download JSON configuration"
              >
                <Download size={14} />
                Download .json
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
              <strong>Drag & drop profile file (.json) here</strong>
              <span>or click to browse from disk</span>
            </div>
          </div>

          {/* Paste Key or JSON */}
          <div className={styles.pasteCard}>
            <label className={styles.label} htmlFor="importText">
              Or Paste Share Key / JSON
            </label>
            <div className={styles.inputRow}>
              <input
                id="importText"
                type="text"
                className="input"
                placeholder="pr://eyJhcH... or paste JSON profile"
                value={importText}
                onChange={e => setImportText(e.target.value)}
                onKeyDown={e => {
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
                Load
              </button>
            </div>
          </div>
        </div>

        <hr className={styles.separator} />

        {/* About & Updates Section */}
        <div className={styles.aboutSection}>
          <div className={styles.sectionHeader}>
            <Info size={16} />
            <h2 className={styles.sectionTitle}>О проекте и обновления</h2>
          </div>
          <p className={styles.subtitle}>
            Информация о сборке, репозитории и проверка обновлений.
          </p>

          <div className={styles.aboutCard}>
            <div className={styles.aboutGrid}>
              <div className={styles.aboutRow}>
                <span className={styles.aboutLabel}>Приложение</span>
                <span className={styles.aboutValue}>Proxy Router Desktop</span>
              </div>
              <div className={styles.aboutRow}>
                <span className={styles.aboutLabel}>Версия клиента</span>
                <div className={styles.versionBadgeGroup}>
                  <span className="mono" style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>
                    v{CURRENT_VERSION}
                  </span>
                  <span className={styles.tag}>STABLE</span>
                </div>
              </div>
              <div className={styles.aboutRow}>
                <span className={styles.aboutLabel}>Платформа</span>
                <span className="mono" style={{ color: 'var(--text-sec)', fontSize: 12 }}>
                  Windows x64 • Tauri 2 + Rust
                </span>
              </div>
              <div className={styles.aboutRow}>
                <span className={styles.aboutLabel}>Репозиторий</span>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => openExternalLink(GITHUB_REPO_URL)}
                  title="Открыть репозиторий на GitHub"
                >
                  <span className="mono" style={{ fontSize: 12 }}>github.com/{GITHUB_REPO}</span>
                  <ExternalLink size={12} />
                </button>
              </div>
            </div>

            {/* Update Checker Block */}
            <div className={styles.updateBlock}>
              <div className={styles.updateHeader}>
                <div className={styles.updateTitleGroup}>
                  <span className={styles.cardHeading}>Обновления программы</span>
                  {updateState.checkedAt && (
                    <span className={styles.checkedTime}>
                      Проверено: {updateState.checkedAt}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleCheckUpdate}
                  disabled={updateState.status === 'checking'}
                >
                  <RefreshCw size={13} className={updateState.status === 'checking' ? styles.spin : ''} />
                  {updateState.status === 'checking' ? 'Проверка...' : 'Проверить обновления'}
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
                    Скачать обновление
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
                    Перейти к релизам вручную
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
