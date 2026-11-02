import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Resvg } from '@resvg/resvg-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const ASSETS_DIR = path.resolve(ROOT_DIR, 'src/assets/app-icons');
const TAURI_VARIANTS_DIR = path.resolve(ROOT_DIR, 'src-tauri/icons/variants');

fs.mkdirSync(ASSETS_DIR, { recursive: true });
fs.mkdirSync(TAURI_VARIANTS_DIR, { recursive: true });

const KNOT_PATH = `M200.125 108.282C184.938 92.2504 158.063 98.6254 151.75 119.813H104.25C103.688 117.907 102.938 116.094 102 114.375L114.344 102.032C123.125 106.782 133.719 106.625 142.344 101.657C161.469 90.6254 161.469 63.0004 142.375 51.9379C123.219 40.8441 99.3129 54.6566 99.3129 76.7504C99.3129 81.5316 100.5 86.2191 102.782 90.4066L90.4379 102.75C84.2191 99.4066 77.0004 98.4379 70.1254 100.094C48.5941 105.188 40.6879 131.688 55.9066 147.719C71.0629 163.782 97.9691 157.375 104.25 136.219H151.75C152.313 138.125 153.063 139.938 154 141.657L141.625 154.032C128.219 146.782 111.5 151.25 103.532 164.25C91.9691 183.063 105.094 207.375 127.188 208C149.282 208.625 163.75 185.094 153.25 165.657L165.594 153.313C171.813 156.657 179.032 157.625 185.907 155.969C207.407 150.813 215.282 124.344 200.125 108.282ZM128 64.4691C132.407 64.4691 136.469 66.8129 138.657 70.6254C143.407 78.8129 137.469 89.0629 128 89.0629C123.594 89.0629 119.532 86.7191 117.344 82.9066C112.625 74.7191 118.532 64.4691 128 64.4691ZM76.7504 140.313C72.3441 140.313 68.2816 137.969 66.0941 134.157C61.3441 125.969 67.2816 115.719 76.7504 115.719C81.1566 115.719 85.2191 118.063 87.4066 121.875C92.1254 130.063 86.2191 140.313 76.7504 140.313ZM121.844 189.938C118.032 187.75 115.688 183.688 115.688 179.282C115.688 169.813 125.938 163.875 134.125 168.625C137.938 170.813 140.282 174.875 140.282 179.282C140.313 188.75 130.063 194.657 121.844 189.938ZM173.094 138.688C169.282 136.5 166.938 132.438 166.938 128.032C166.938 118.563 177.188 112.625 185.375 117.375C189.188 119.563 191.532 123.625 191.532 128.032C191.563 137.5 181.313 143.407 173.094 138.688Z`;

const VARIANTS = [
  {
    id: 'monolith',
    name: 'Dark Monolith',
    desc: 'Signature graphite squircle with cyan-indigo gradient knot',
    svg: `
<svg width="256" height="256" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="128" y1="0" x2="128" y2="256" gradientUnits="userSpaceOnUse">
      <stop stop-color="#262626"/>
      <stop offset="1" stop-color="#121212"/>
    </linearGradient>
    <linearGradient id="knot" x1="128" y1="48" x2="128" y2="208" gradientUnits="userSpaceOnUse">
      <stop stop-color="#709EA8"/>
      <stop offset="0.5" stop-color="#A3BED7"/>
      <stop offset="1" stop-color="#565574"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="60" fill="url(#bg)"/>
  <rect x="7.5" y="7.5" width="241" height="241" rx="52.5" stroke="white" stroke-opacity="0.06" stroke-width="15"/>
  <path d="${KNOT_PATH}" fill="url(#knot)"/>
</svg>`
  },
  {
    id: 'vela-cream',
    name: 'Vela Clean Ink',
    desc: 'Warm cream ceramic squircle with crisp typographic ink knot',
    svg: `
<svg width="256" height="256" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="128" y1="0" x2="128" y2="256" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#F6F1EA"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="60" fill="url(#bg)"/>
  <rect x="2" y="2" width="252" height="252" rx="58" stroke="#0D0D0C" stroke-opacity="0.10" stroke-width="4"/>
  <path d="${KNOT_PATH}" fill="#0D0D0C"/>
</svg>`
  },
  {
    id: 'vela-amber',
    name: 'Vela Golden Sun',
    desc: 'Cream ceramic squircle with radiant amber gold clay knot',
    svg: `
<svg width="256" height="256" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="128" y1="0" x2="128" y2="256" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFFDF9"/>
      <stop offset="1" stop-color="#F7EEDD"/>
    </linearGradient>
    <linearGradient id="knot" x1="128" y1="48" x2="128" y2="208" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FCD34D"/>
      <stop offset="0.45" stop-color="#F59E0B"/>
      <stop offset="1" stop-color="#D97706"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="60" fill="url(#bg)"/>
  <rect x="2" y="2" width="252" height="252" rx="58" stroke="#D97706" stroke-opacity="0.18" stroke-width="4"/>
  <path d="${KNOT_PATH}" fill="url(#knot)"/>
</svg>`
  },
  {
    id: 'sunset-peach',
    name: 'Sunset Coral',
    desc: 'Soft blush squircle with vibrant peach coral knot',
    svg: `
<svg width="256" height="256" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="128" y1="0" x2="128" y2="256" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFF8F5"/>
      <stop offset="1" stop-color="#FAEDE5"/>
    </linearGradient>
    <linearGradient id="knot" x1="128" y1="48" x2="128" y2="208" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FB923C"/>
      <stop offset="0.5" stop-color="#F2772F"/>
      <stop offset="1" stop-color="#EA580C"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="60" fill="url(#bg)"/>
  <rect x="2" y="2" width="252" height="252" rx="58" stroke="#EA580C" stroke-opacity="0.18" stroke-width="4"/>
  <path d="${KNOT_PATH}" fill="url(#knot)"/>
</svg>`
  },
  {
    id: 'lilac-lavender',
    name: 'Lilac Velvet',
    desc: 'Powder lavender squircle with luminous violet orchid knot',
    svg: `
<svg width="256" height="256" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="128" y1="0" x2="128" y2="256" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FCF8FD"/>
      <stop offset="1" stop-color="#F4E8F4"/>
    </linearGradient>
    <linearGradient id="knot" x1="128" y1="48" x2="128" y2="208" gradientUnits="userSpaceOnUse">
      <stop stop-color="#E879F9"/>
      <stop offset="0.5" stop-color="#C564C4"/>
      <stop offset="1" stop-color="#9333EA"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="60" fill="url(#bg)"/>
  <rect x="2" y="2" width="252" height="252" rx="58" stroke="#9333EA" stroke-opacity="0.18" stroke-width="4"/>
  <path d="${KNOT_PATH}" fill="url(#knot)"/>
</svg>`
  },
  {
    id: 'cyber-emerald',
    name: 'Matrix Emerald',
    desc: 'Pitch-black obsidian squircle with glowing neon emerald knot',
    svg: `
<svg width="256" height="256" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="128" y1="0" x2="128" y2="256" gradientUnits="userSpaceOnUse">
      <stop stop-color="#141E18"/>
      <stop offset="1" stop-color="#080D0A"/>
    </linearGradient>
    <linearGradient id="knot" x1="128" y1="48" x2="128" y2="208" gradientUnits="userSpaceOnUse">
      <stop stop-color="#34D399"/>
      <stop offset="0.5" stop-color="#10B981"/>
      <stop offset="1" stop-color="#059669"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="60" fill="url(#bg)"/>
  <rect x="2" y="2" width="252" height="252" rx="58" stroke="#10B981" stroke-opacity="0.30" stroke-width="4"/>
  <path d="${KNOT_PATH}" fill="url(#knot)"/>
</svg>`
  },
  {
    id: 'midnight-white',
    name: 'Midnight Titanium',
    desc: 'Matte obsidian squircle with crisp minimalist stark white knot',
    svg: `
<svg width="256" height="256" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="128" y1="0" x2="128" y2="256" gradientUnits="userSpaceOnUse">
      <stop stop-color="#1A1A1A"/>
      <stop offset="1" stop-color="#0A0A0A"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="60" fill="url(#bg)"/>
  <rect x="2" y="2" width="252" height="252" rx="58" stroke="white" stroke-opacity="0.10" stroke-width="4"/>
  <path d="${KNOT_PATH}" fill="#FFFFFF"/>
</svg>`
  }
];

const SIZES = [256, 128, 64, 32];

console.log('Generating application icons across all required resolutions...');

const iconRegistry = [];

for (const v of VARIANTS) {
  const cleanSvg = v.svg.trim();
  const svgPath = path.join(ASSETS_DIR, `${v.id}.svg`);
  fs.writeFileSync(svgPath, cleanSvg, 'utf8');

  for (const size of SIZES) {
    const resvg = new Resvg(cleanSvg, {
      fitTo: {
        mode: 'width',
        value: size,
      },
      shapeRendering: 2, // geometricPrecision
      textRendering: 1, // optimizeLegibility
      imageRendering: 0, // optimizeQuality
    });
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();

    // Save in src/assets/app-icons
    const assetPngPath = path.join(ASSETS_DIR, `${v.id}-${size}.png`);
    fs.writeFileSync(assetPngPath, pngBuffer);

    // Also copy 256, 128, 32 to src-tauri/icons/variants
    const tauriPngPath = path.join(TAURI_VARIANTS_DIR, `${v.id}-${size}.png`);
    fs.writeFileSync(tauriPngPath, pngBuffer);
  }

  iconRegistry.push({
    id: v.id,
    name: v.name,
    desc: v.desc,
    svgPath: `/assets/app-icons/${v.id}.svg`,
    previewPath: `/assets/app-icons/${v.id}-128.png`,
  });

  console.log(`✓ Generated variant '${v.id}' at sizes [${SIZES.join(', ')}]`);
}

// Generate iconsRegistry.js for convenient frontend import
const registryCode = `/**
 * appIconsRegistry.js — Dynamic Icon Catalog
 * Telegram-style application icon variants.
 */

${VARIANTS.map(v => `import ${v.id.replace(/-/g, '_')}Preview from './app-icons/${v.id}-128.png';`).join('\n')}
${VARIANTS.map(v => `import ${v.id.replace(/-/g, '_')}Svg from './app-icons/${v.id}.svg';`).join('\n')}

export const APP_ICONS = [
${VARIANTS.map(v => `  {
    id: '${v.id}',
    nameKey: 'settings.icon_${v.id.replace(/-/g, '_')}_name',
    descKey: 'settings.icon_${v.id.replace(/-/g, '_')}_desc',
    defaultName: '${v.name}',
    defaultDesc: '${v.desc}',
    preview: ${v.id.replace(/-/g, '_')}Preview,
    svg: ${v.id.replace(/-/g, '_')}Svg,
  },`).join('\n')}
];
`;

fs.writeFileSync(path.join(ROOT_DIR, 'src/assets/appIconsRegistry.js'), registryCode, 'utf8');
console.log('✓ Successfully created appIconsRegistry.js');
