/**
 * appIconsRegistry.js — Dynamic Icon Catalog
 * Telegram-style application icon variants.
 */

import monolithPreview from './app-icons/monolith-128.png';
import vela_creamPreview from './app-icons/vela-cream-128.png';
import vela_amberPreview from './app-icons/vela-amber-128.png';
import sunset_peachPreview from './app-icons/sunset-peach-128.png';
import lilac_lavenderPreview from './app-icons/lilac-lavender-128.png';
import cyber_emeraldPreview from './app-icons/cyber-emerald-128.png';
import midnight_whitePreview from './app-icons/midnight-white-128.png';
import monolithSvg from './app-icons/monolith.svg';
import vela_creamSvg from './app-icons/vela-cream.svg';
import vela_amberSvg from './app-icons/vela-amber.svg';
import sunset_peachSvg from './app-icons/sunset-peach.svg';
import lilac_lavenderSvg from './app-icons/lilac-lavender.svg';
import cyber_emeraldSvg from './app-icons/cyber-emerald.svg';
import midnight_whiteSvg from './app-icons/midnight-white.svg';

export const APP_ICONS = [
  {
    id: 'monolith',
    nameKey: 'settings.icon_monolith_name',
    descKey: 'settings.icon_monolith_desc',
    defaultName: 'Dark Monolith',
    defaultDesc: 'Signature graphite squircle with cyan-indigo gradient knot',
    preview: monolithPreview,
    svg: monolithSvg,
  },
  {
    id: 'vela-cream',
    nameKey: 'settings.icon_vela_cream_name',
    descKey: 'settings.icon_vela_cream_desc',
    defaultName: 'Vela Clean Ink',
    defaultDesc: 'Warm cream ceramic squircle with crisp typographic ink knot',
    preview: vela_creamPreview,
    svg: vela_creamSvg,
  },
  {
    id: 'vela-amber',
    nameKey: 'settings.icon_vela_amber_name',
    descKey: 'settings.icon_vela_amber_desc',
    defaultName: 'Vela Golden Sun',
    defaultDesc: 'Cream ceramic squircle with radiant amber gold clay knot',
    preview: vela_amberPreview,
    svg: vela_amberSvg,
  },
  {
    id: 'sunset-peach',
    nameKey: 'settings.icon_sunset_peach_name',
    descKey: 'settings.icon_sunset_peach_desc',
    defaultName: 'Sunset Coral',
    defaultDesc: 'Soft blush squircle with vibrant peach coral knot',
    preview: sunset_peachPreview,
    svg: sunset_peachSvg,
  },
  {
    id: 'lilac-lavender',
    nameKey: 'settings.icon_lilac_lavender_name',
    descKey: 'settings.icon_lilac_lavender_desc',
    defaultName: 'Lilac Velvet',
    defaultDesc: 'Powder lavender squircle with luminous violet orchid knot',
    preview: lilac_lavenderPreview,
    svg: lilac_lavenderSvg,
  },
  {
    id: 'cyber-emerald',
    nameKey: 'settings.icon_cyber_emerald_name',
    descKey: 'settings.icon_cyber_emerald_desc',
    defaultName: 'Matrix Emerald',
    defaultDesc: 'Pitch-black obsidian squircle with glowing neon emerald knot',
    preview: cyber_emeraldPreview,
    svg: cyber_emeraldSvg,
  },
  {
    id: 'midnight-white',
    nameKey: 'settings.icon_midnight_white_name',
    descKey: 'settings.icon_midnight_white_desc',
    defaultName: 'Midnight Titanium',
    defaultDesc: 'Matte obsidian squircle with crisp minimalist stark white knot',
    preview: midnight_whitePreview,
    svg: midnight_whiteSvg,
  },
];
