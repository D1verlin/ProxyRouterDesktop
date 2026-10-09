/**
 * Sidebar.jsx — Minimalist Icon-only Rail Sidebar.
 * Displays logo.svg, top navigation items, and Settings pinned cleanly at the bottom.
 */

import { NavLink } from 'react-router-dom';
import {
  Home,
  Sparkles,
  Layers,
  ShieldCheck,
  ScrollText,
  Settings,
} from 'lucide-react';
import logoUrl from '../assets/logo.svg';
import styles from './Sidebar.module.css';

const TOP_NAV = [
  { to: '/',          icon: Home,        label: 'Dashboard' },
  { to: '/sites',     icon: Sparkles,    label: 'AI Services' },
  { to: '/apps',      icon: Layers,      label: 'Applications' },
  { to: '/whitelist', icon: ShieldCheck, label: 'Whitelist' },
  { to: '/log',       icon: ScrollText,  label: 'Activity Log' },
];

export default function Sidebar() {
  return (
    <aside className={styles.rail}>
      {/* Top Logo */}
      <div className={styles.topSymbol} title="Proxy Router">
        <img
          src={logoUrl}
          alt="Proxy Router"
          className={styles.symbolLogo}
          draggable={false}
        />
      </div>

      {/* Main Navigation Items */}
      <nav className={styles.nav}>
        {TOP_NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `${styles.railItem} ${isActive ? styles.railItemActive : ''}`
            }
            title={label}
            aria-label={label}
          >
            <Icon size={18} strokeWidth={1.75} />
            <span className={styles.tooltip}>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Bottom Pinned Settings Button (No PR icon) */}
      <div className={styles.bottomSection}>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `${styles.railItem} ${isActive ? styles.railItemActive : ''}`
          }
          title="Settings"
          aria-label="Settings"
        >
          <Settings size={18} strokeWidth={1.75} />
          <span className={styles.tooltip}>Settings</span>
        </NavLink>
      </div>
    </aside>
  );
}
