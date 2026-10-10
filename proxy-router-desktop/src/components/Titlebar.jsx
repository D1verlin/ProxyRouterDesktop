/**
 * Titlebar.jsx — Authentic Windows Frameless Titlebar with Proxy Router logo
 * and functional window minimize, maximize, and close buttons.
 */

import { Minus, Square, X } from 'lucide-react';
import { useTauri } from '../hooks/useTauri';
import { useAppStore } from '../store/useAppStore';
import logoUrl from '../assets/logo.svg';
import styles from './Titlebar.module.css';

export default function Titlebar() {
  const { minimizeWindow, toggleMaximizeWindow, closeWindow } = useTauri();
  const { t } = useAppStore();

  return (
    <header className={styles.titlebar} data-tauri-drag-region>
      {/* Left: App Title */}
      <div className={styles.left} data-tauri-drag-region>
        <img src={logoUrl} alt="" className={styles.logo} draggable={false} data-tauri-drag-region />
        <span className={styles.title} data-tauri-drag-region>
          Proxy Router
        </span>
      </div>

      {/* Center Draggable Spacer */}
      <div className={styles.center} data-tauri-drag-region />

      {/* Right: Native Window Caption Buttons */}
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.controlBtn}
          onClick={minimizeWindow}
          aria-label={t('titlebar.minimize', 'Minimize to Tray')}
          title={t('titlebar.minimize', 'Minimize to Tray')}
        >
          <Minus size={13} strokeWidth={1.75} />
        </button>

        <button
          type="button"
          className={styles.controlBtn}
          onClick={toggleMaximizeWindow}
          aria-label={t('titlebar.maximize', 'Maximize / Restore')}
          title={t('titlebar.maximize', 'Maximize / Restore')}
        >
          <Square size={10} strokeWidth={1.75} />
        </button>

        <button
          type="button"
          className={`${styles.controlBtn} ${styles.closeBtn}`}
          onClick={closeWindow}
          aria-label={t('titlebar.close', 'Close to Tray')}
          title={t('titlebar.close', 'Close to Tray')}
        >
          <X size={13} strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}
