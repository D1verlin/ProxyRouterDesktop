/**
 * Sidebar.jsx — Minimalist Icon-only Rail Sidebar.
 * Displays logo.svg, top navigation items, and Settings pinned cleanly at the bottom.
 * Supports Lucide stroke icons (Dark Monolith) and authentic 3D Clay Candy icons with mask tinting (Vela theme).
 */

import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Home,
  Sparkles,
  Layers,
  ShieldCheck,
  Globe,
  ScrollText,
  Settings,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { clayIcons } from '../assets/clayIcons';
import ClayIcon from './ClayIcon';
import { APP_ICONS } from '../assets/appIconsRegistry';
import logoUrl from '../assets/logo.svg';
import styles from './Sidebar.module.css';

const TOP_NAV = [
  { to: '/',          icon: Home,        key: 'nav.dashboard', defaultLabel: 'Dashboard',    tint: '#E9C22E' },
  { to: '/sites',     icon: Sparkles,    key: 'nav.sites',     defaultLabel: 'AI Services',  tint: '#F2772F' },
  { to: '/apps',      icon: Layers,      key: 'nav.apps',      defaultLabel: 'Applications', tint: '#3FB874' },
  { to: '/whitelist', icon: ShieldCheck, key: 'nav.whitelist', defaultLabel: 'Whitelist',    tint: '#10B981' },
  { to: '/dns',       icon: Globe,       key: 'nav.dns',       defaultLabel: 'DNS',          tint: '#C564C4' },
  { to: '/log',       icon: ScrollText,  key: 'nav.log',       defaultLabel: 'Activity Log', tint: '#F43F5E' },
];

export default function Sidebar() {
  const { state, t } = useAppStore();
  const isVela = state.customization?.theme === 'vela';
  const appIconId = state.customization?.appIcon || (isVela ? 'vela-cream' : 'monolith');
  const activeIcon = APP_ICONS.find((i) => i.id === appIconId) || APP_ICONS[0];
  const [dashboardTint, setDashboardTint] = useState('#E9C22E');

  useEffect(() => {
    const handleHeroColor = (e) => {
      if (e.detail?.tint) {
        setDashboardTint(e.detail.tint);
      }
    };
    window.addEventListener('vela:hero-color', handleHeroColor);
    return () => window.removeEventListener('vela:hero-color', handleHeroColor);
  }, []);

  return (
    <aside className={styles.rail}>
      {/* Top Logo - Synchronized with user selected application icon */}
      <div className={styles.topSymbol} title="Proxy Router">
        <img
          src={activeIcon.svg || activeIcon.preview || logoUrl}
          alt="Proxy Router"
          className={styles.symbolLogo}
          draggable={false}
        />
      </div>

      {/* Main Navigation Items */}
      <nav className={styles.nav}>
        {TOP_NAV.map(({ to, icon: Icon, key, defaultLabel, tint }) => {
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
              {({ isActive }) => (
                <>
                  {isVela && clayIcons[to] ? (
                    <span className={styles.clayRailWrapper}>
                      <ClayIcon
                        icon={clayIcons[to]}
                        tint={to === '/' && isVela ? dashboardTint : tint}
                        size={26}
                        active={isActive}
                      />
                    </span>
                  ) : (
                    <Icon size={18} strokeWidth={1.75} />
                  )}
                  <span className={styles.tooltip}>{label}</span>
                </>
              )}
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
          {({ isActive }) => (
            <>
              {isVela && clayIcons['/settings'] ? (
                <span className={styles.clayRailWrapper}>
                  <ClayIcon
                    icon={clayIcons['/settings']}
                    tint="#D97706"
                    size={26}
                    active={isActive}
                  />
                </span>
              ) : (
                <Settings size={18} strokeWidth={1.75} />
              )}
              <span className={styles.tooltip}>{t('nav.settings', 'Settings')}</span>
            </>
          )}
        </NavLink>
      </div>
    </aside>
  );
}
