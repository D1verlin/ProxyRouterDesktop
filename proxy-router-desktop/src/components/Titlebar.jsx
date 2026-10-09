/**
 * Titlebar.jsx — Authentic Windows Frameless Titlebar with Proxy Router logo
 * and functional window minimize, maximize, and close buttons.
 */

import { Minus, Square, X } from 'lucide-react';
import { useTauri } from '../hooks/useTauri';
import logoUrl from '../assets/logo.svg';
import styles from './Titlebar.module.css';

export default function Titlebar() {
  const { minimizeWindow, toggleMaximizeWindow, closeWindow } = useTauri();

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
          aria-label="Minimize"
          title="Minimize"
        >
          <Minus size={13} strokeWidth={1.75} />
        </button>

        <button
          type="button"
          className={styles.controlBtn}
          onClick={toggleMaximizeWindow}
          aria-label="Maximize"
          title="Maximize"
        >
          <Square size={10} strokeWidth={1.75} />
        </button>

        <button
          type="button"
          className={`${styles.controlBtn} ${styles.closeBtn}`}
          onClick={closeWindow}
          aria-label="Close"
          title="Close"
        >
          <X size={13} strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}
