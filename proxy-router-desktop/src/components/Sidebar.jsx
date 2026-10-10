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
import { useAppStore } from '../store/useAppStore';
import logoUrl from '../assets/logo.svg';
import styles from './Sidebar.module.css';

const TOP_NAV = [
  { to: '/',          icon: Home,        key: 'nav.dashboard', defaultLabel: 'Dashboard' },
  { to: '/sites',     icon: Sparkles,    key: 'nav.sites',     defaultLabel: 'AI Services' },
  { to: '/apps',      icon: Layers,      key: 'nav.apps',      defaultLabel: 'Applications' },
  { to: '/whitelist', icon: ShieldCheck, key: 'nav.whitelist', defaultLabel: 'Whitelist' },
  { to: '/log',       icon: ScrollText,  key: 'nav.log',       defaultLabel: 'Activity Log' },
];

export default function Sidebar() {
  const { t } = useAppStore();
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
        {TOP_NAV.map(({ to, icon: Icon, key, defaultLabel }) => {
          const label = t(key, defaultLabel);
          return (
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
          );
        })}
      </nav>

      {/* Bottom Pinned Settings Button */}
      <div className={styles.bottomSection}>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `${styles.railItem} ${isActive ? styles.railItemActive : ''}`
          }
          title={t('nav.settings', 'Settings')}
          aria-label={t('nav.settings', 'Settings')}
        >
          <Settings size={18} strokeWidth={1.75} />
          <span className={styles.tooltip}>{t('nav.settings', 'Settings')}</span>
        </NavLink>
      </div>
    </aside>
  );
}
