/**
 * PlanetVisualizer.jsx — Cyber Dot-Matrix 3D Earth with Borderless Company Logos
 *
 * Design Architecture:
 * 1. Dot-Matrix Earth Sphere: Mathematical lattice of ~1,200 continental micro-dots
 *    projected in true 3D spherical depth. Clean, artifact-free, beautiful, and authentic.
 * 2. Borderless Company Vector Logos:
 *    - Monitor (Мой ПК) & Server (Прокси)
 *    - Google Gemini (4-pointed curved star)
 *    - OpenAI (Hexagonal spiral mark)
 *    - Anthropic Claude (Geometric sunburst mark)
 *    - Custom/Other (Minimal globe glyph)
 *    Strictly NO enclosing circles, borders, or badges around the icons.
 * 3. Clear Telemetry Hierarchy:
 *    - Main prominent optical beam: Мой ПК -> Прокси-сервер.
 *    - Fine secondary threads: Прокси -> Company datacenters across North America & Europe.
 * 4. Zero Text Collisions:
 *    - Only 'Мой ПК' and 'Прокси' have persistent clear labels.
 *    - Company logos float cleanly over their geographic regions.
 *    - Hovering any node displays a floating interactive tooltip.
 * 5. Distinct Connecting (Handshake) & Disconnecting (Teardown) pipelines.
 * 6. Instant unconfigured red alert mode with micro-vibration and no popup notices.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { RefreshCw, Copy, Check } from 'lucide-react';
import { drawOfficialBrandLogo } from '../assets/brandLogos.js';
import { EARTH_DOTS, EARTH_RINGS } from '../assets/earthData.js';
import styles from './PlanetVisualizer.module.css';

function toRad(deg) { return (deg * Math.PI) / 180; }

// Precompute 3D unit sphere coordinates for instant projection without trig inside the render loop
const PRECOMPUTED_DOTS = EARTH_DOTS.map(([lat, lon]) => ({
  nx: Math.cos(lat) * Math.sin(lon),
  ny: Math.sin(lat),
  nz: Math.cos(lat) * Math.cos(lon),
}));

const PRECOMPUTED_RINGS = EARTH_RINGS.map((ring) => {
  const points = [];
  for (let i = 0; i < ring.length; i += 2) {
    const [lat, lon] = ring[i];
    points.push({
      nx: Math.cos(lat) * Math.sin(lon),
      ny: Math.sin(lat),
      nz: Math.cos(lat) * Math.cos(lon),
    });
  }
  return points;
});

// ── Node & Badge Renderers ───────────────────────────────────────────────────

// Circular outline badge with dark disc background for "Мой ПК" and "Прокси"
function drawBadge(ctx, x, y, radius, borderColor, bgColor = 'rgba(12, 12, 12, 0.94)') {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = bgColor;
  ctx.fill();
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// 1. My PC: Clean Monitor Logo
function drawMonitorLogo(ctx, x, y, size, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const w = size * 0.8;
  const h = size * 0.52;
  ctx.strokeRect(x - w / 2, y - h / 2 - 2, w, h);

  ctx.beginPath();
  ctx.moveTo(x, y + h / 2 - 2);
  ctx.lineTo(x, y + h / 2 + 3);
  ctx.moveTo(x - 4, y + h / 2 + 3);
  ctx.lineTo(x + 4, y + h / 2 + 3);
  ctx.stroke();
}

// 2. Proxy: Clean Server Rack Logo
function drawServerLogo(ctx, x, y, size, color) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const w = size * 0.8;
  const h = size * 0.28;
  ctx.strokeRect(x - w / 2, y - h - 1.5, w, h);
  ctx.strokeRect(x - w / 2, y + 1.5, w, h);
  ctx.fillRect(x - w / 2 + 2.5, y - h + 0.5, 2, 2);
  ctx.fillRect(x - w / 2 + 2.5, y + 3.5, 2, 2);
}

// 3. Custom / Generic Fallback: Minimalist telemetry globe glyph
function drawCustomLogo(ctx, x, y, size, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.3;

  const r = size * 0.44;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.moveTo(x - r, y);
  ctx.lineTo(x + r, y);
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.45, r, 0, 0, Math.PI * 2);
  ctx.stroke();
}

export default function PlanetVisualizer({
  isActive,
  isConnecting,
  isDisconnecting,
  isUnconfiguredWarning,
  isConfigured = true,
  activeServices = [],
  onToggle,
  disabled,
  publicIp,
  onRefreshIp,
  onOpenSettings,
}) {
  const canvasRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const isHoveringRef = useRef(false);
  const hoverProgRef = useRef(0);
  const mousePosRef = useRef({ x: -1, y: -1 });

  // Drag rotation
  const isDraggingRef = useRef(false);
  const mouseDownPosRef = useRef({ x: 0, y: 0 });
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const rotRef = useRef({ y: 0.9, x: 0.32 });

  // ── Build Geographically Distinct Telemetry Network ─────────────────────────
  const { clientNode, proxyNode, companyNodes, arcs } = useMemo(() => {
    // 1. Origin: User PC in Eastern Europe / Eurasia (55.7°N, 37.6°E)
    const client = {
      id: 'client',
      name: 'Мой ПК',
      subtext: publicIp || '178.120.53.202',
      lat: toRad(55.7),
      lon: toRad(37.6),
      type: 'client',
    };

    // 2. Gateway: Squid Proxy Server in Western Europe / Paris (48.8°N, 2.3°E)
    const proxy = {
      id: 'proxy',
      name: 'Прокси',
      subtext: 'Squid Relay :3128',
      lat: toRad(48.8),
      lon: toRad(2.3),
      type: 'proxy',
    };

    // 3. Group enabled services by destination ecosystem to prevent duplicate / colliding icons
    const groups = new Map();

    activeServices.forEach((svc, idx) => {
      const id = (svc.id || '').toLowerCase();
      const label = (svc.label || svc.name || svc.host || '').toLowerCase();
      const cat = (svc.category || '').toLowerCase();

      let groupKey = svc.id || `custom_${idx}`;
      let name = svc.label || svc.name || svc.host || 'Сервис';
      let logoType = 'custom';
      let latDeg = 35.7;
      let lonDeg = 139.7; // Default hub: Tokyo

      if (
        cat.includes('google') ||
        id.includes('gemini') ||
        label.includes('gemini') ||
        id === 'aistudio' ||
        id === 'antigravity' ||
        id === 'stitch'
      ) {
        groupKey = 'google_ai';
        name = 'Google Gemini';
        logoType = 'gemini';
        latDeg = 38.9;
        lonDeg = -77.0; // N. Virginia (Google Cloud US-East)
      } else if (
        cat.includes('openai') ||
        id.includes('chatgpt') ||
        id.includes('openai') ||
        label.includes('openai')
      ) {
        groupKey = 'openai';
        name = 'OpenAI';
        logoType = 'openai';
        latDeg = 37.7;
        lonDeg = -122.4; // San Francisco (Silicon Valley)
      } else if (
        cat.includes('anthropic') ||
        id.includes('claude') ||
        label.includes('claude') ||
        id.includes('anthropic')
      ) {
        groupKey = 'anthropic';
        name = 'Claude';
        logoType = 'claude';
        latDeg = 32.8;
        lonDeg = -96.8; // US Central (Dallas / Texas Tech Hub)
      } else if (id.includes('perplexity') || label.includes('perplexity')) {
        groupKey = 'perplexity';
        name = 'Perplexity';
        logoType = 'perplexity';
        latDeg = 35.7;
        lonDeg = 139.7; // Tokyo
      } else if (id.includes('huggingface') || label.includes('hugging')) {
        groupKey = 'huggingface';
        name = 'Hugging Face';
        logoType = 'huggingface';
        latDeg = 40.7;
        lonDeg = -74.0; // New York
      } else if (id.includes('mistral') || label.includes('mistral')) {
        groupKey = 'mistral';
        name = 'Mistral';
        logoType = 'mistral';
        latDeg = 43.7;
        lonDeg = 7.2; // Southern Europe
      } else if (id.includes('openrouter') || label.includes('openrouter')) {
        groupKey = 'openrouter';
        name = 'OpenRouter';
        logoType = 'openrouter';
        latDeg = 1.3;
        lonDeg = 103.8; // Singapore
      } else if (id.includes('deepl') || label.includes('deepl')) {
        groupKey = 'deepl';
        name = 'DeepL';
        logoType = 'deepl';
        latDeg = 52.5;
        lonDeg = 13.4; // Berlin
      } else {
        // User custom domains distributed across distinct global datacenter hubs
        const hubs = [
          { lat: 35.7, lon: 139.7 },  // Tokyo
          { lat: 1.3, lon: 103.8 },   // Singapore
          { lat: -33.9, lon: 151.2 }, // Sydney
          { lat: -23.5, lon: -46.6 }, // São Paulo
          { lat: 59.3, lon: 18.0 },   // Stockholm
        ];
        const h = hubs[idx % hubs.length];
        latDeg = h.lat;
        lonDeg = h.lon;
      }

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          id: groupKey,
          name,
          lat: toRad(latDeg),
          lon: toRad(lonDeg),
          logoType,
          type: 'company',
          count: 1,
        });
      } else {
        groups.get(groupKey).count += 1;
      }
    });

    const companies = Array.from(groups.values());

    // Primary Arc: PC -> Proxy. Secondary Arcs: Proxy -> Company destinations
    const arcsList = [
      { from: client, to: proxy, primary: true },
      ...companies.map((c) => ({ from: proxy, to: c, primary: false })),
    ];

    return {
      clientNode: client,
      proxyNode: proxy,
      companyNodes: companies,
      arcs: arcsList,
    };
  }, [activeServices, publicIp]);

  const handleMouseDown = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const dist = Math.hypot(mx - 340, my - 232);

    // Only start dragging if mouse is actually ON or near the planet (radius 180 + margin)
    if (dist <= 195) {
      isDraggingRef.current = true;
      mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = 'grabbing';
    }
  }, []);

  const handleMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const dist = Math.hypot(mx - 340, my - 232);

    // STRICT circular hit-test for planet hover!
    const isOverPlanet = dist <= 190;
    isHoveringRef.current = isOverPlanet;

    if (!isDraggingRef.current) {
      canvas.style.cursor = isOverPlanet ? 'pointer' : 'default';
    } else {
      const dx = e.clientX - lastMouseRef.current.x;
      const dy = e.clientY - lastMouseRef.current.y;
      rotRef.current.y += dx * 0.007;
      rotRef.current.x = Math.max(-0.85, Math.min(0.85, rotRef.current.x + dy * 0.007));
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const handleMouseUp = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wasDragging = isDraggingRef.current;
    isDraggingRef.current = false;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const dist = Math.hypot(mx - 340, my - 232);

    canvas.style.cursor = dist <= 190 ? 'pointer' : 'default';

    if (wasDragging) {
      const dx = e.clientX - mouseDownPosRef.current.x;
      const dy = e.clientY - mouseDownPosRef.current.y;
      const moveDistance = Math.hypot(dx, dy);

      // Only toggle if clicked directly on the planet and was not a drag gesture
      if (dist <= 190 && moveDistance < 6 && !disabled && onToggle) {
        onToggle();
      }
    }
  }, [disabled, onToggle]);

  const handleMouseLeave = useCallback(() => {
    isHoveringRef.current = false;
    isDraggingRef.current = false;
    if (canvasRef.current) {
      canvasRef.current.style.cursor = 'default';
    }
  }, []);

  const handleCopyIp = () => {
    if (!publicIp) return;
    navigator.clipboard.writeText(publicIp);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animId;

    const dpr = window.devicePixelRatio || 1;
    const width = 680;
    const height = 480;
    const targetW = width * dpr;
    const targetH = height * dpr;

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const radius = 180;
    const centerX = width / 2;
    const centerY = height / 2 - 8;

    // Active arc telemetry packets
    const arcPackets = arcs.map((arc, i) => ({
      arc,
      progress: (i * 0.22) % 1,
      speed: arc.primary ? 0.008 : 0.005,
      pulseSize: arc.primary ? 3.5 : 2.5,
    }));

    // Connecting handshake stream (PC -> Proxy)
    const handshakePackets = [
      { progress: 0.0, speed: 0.012 },
      { progress: 0.35, speed: 0.012 },
      { progress: 0.70, speed: 0.012 },
    ];

    // Disconnecting teardown stream (Proxy -> PC in reverse)
    const teardownPackets = [
      { progress: 1.0, speed: 0.014 },
      { progress: 0.65, speed: 0.014 },
      { progress: 0.30, speed: 0.014 },
    ];

    // 3D coordinate projection
    function project(lat, lon, r, rotX, rotY) {
      const x = r * Math.cos(lat) * Math.sin(lon + rotY);
      const y = r * Math.sin(lat);
      const z = r * Math.cos(lat) * Math.cos(lon + rotY);

      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);
      const y2 = y * cosX - z * sinX;
      const z2 = y * sinX + z * cosX;

      return {
        x: centerX + x,
        y: centerY - y2,
        z: z2,
        visible: z2 > 0,
      };
    }

    let pulsePhase = 0;
    let handshakeTimer = 0;
    let teardownTimer = 0;
    let lastRenderTime = 0;
    const TARGET_FPS_INTERVAL = 1000 / 30; // 30 FPS cap to reduce CPU/GPU load to near zero

    const render = (currentTime = performance.now()) => {
      animId = requestAnimationFrame(render);

      // Pause rendering completely when app is minimized or hidden
      if (typeof document !== 'undefined' && document.hidden) return;

      const elapsed = currentTime - lastRenderTime;
      if (elapsed < TARGET_FPS_INTERVAL) return;
      lastRenderTime = currentTime - (elapsed % TARGET_FPS_INTERVAL);

      ctx.clearRect(0, 0, width, height);
      pulsePhase += 0.05;

      // ────────────────────────────────────────────────────────────────────────
      // PHASE 1: CONNECTING HANDSHAKE PIPELINE (PC -> PROXY PACKETS)
      // ────────────────────────────────────────────────────────────────────────
      if (isConnecting) {
        handshakeTimer += 0.016;

        const pcX = 120;
        const pcY = centerY;
        const proxyX = 560;
        const proxyY = centerY;

        // Transmission Optical Line
        ctx.beginPath();
        ctx.moveTo(pcX, pcY);
        ctx.lineTo(proxyX, proxyY);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // High-speed Packets
        handshakePackets.forEach((pkt) => {
          pkt.progress += pkt.speed;
          if (pkt.progress >= 1) pkt.progress = 0;

          const px = pcX + (proxyX - pcX) * pkt.progress;
          const py = pcY;

          ctx.beginPath();
          ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();

          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(Math.max(pcX, px - 30), py);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
          ctx.lineWidth = 2;
          ctx.stroke();
        });

        // Left: Мой ПК with bordered badge
        drawBadge(ctx, pcX, pcY, 26, 'rgba(255, 255, 255, 0.9)');
        drawMonitorLogo(ctx, pcX, pcY, 26, '#ffffff');
        ctx.font = '500 15px "Inter", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText('Мой ПК', pcX, pcY + 44);

        ctx.font = '12px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.fillText(clientNode.subtext, pcX, pcY + 62);

        // Right: Прокси-сервер with bordered badge
        drawBadge(ctx, proxyX, proxyY, 26, 'rgba(255, 255, 255, 0.85)');
        drawServerLogo(ctx, proxyX, proxyY, 26, '#ffffff');
        ctx.font = '500 15px "Inter", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('Прокси-сервер', proxyX, proxyY + 44);

        ctx.font = '12px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.fillText(proxyNode.subtext, proxyX, proxyY + 62);

        // Center Step Indicator
        let stepText = '1/2: ПЕРЕДАЧА ПАКЕТОВ НА ПРОКСИ-СЕРВЕР...';
        if (handshakeTimer > 1.3 && handshakeTimer <= 2.4) {
          stepText = '2/2: АВТОРИЗАЦИЯ IP В БЕЛОМ СПИСКЕ SQUID...';
        } else if (handshakeTimer > 2.4) {
          stepText = '✓ АВТОРИЗАЦИЯ ПОДТВЕРЖДЕНА. ЗАПУСК ТУННЕЛЯ...';
        }

        ctx.font = '13px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fillText(stepText, centerX, centerY - 36);
        ctx.textAlign = 'left';
        return;
      }

      // ────────────────────────────────────────────────────────────────────────
      // PHASE 2: DISCONNECTING TEARDOWN PIPELINE (PROXY -> PC IN REVERSE)
      // ────────────────────────────────────────────────────────────────────────
      if (isDisconnecting) {
        teardownTimer += 0.016;

        const pcX = 120;
        const pcY = centerY;
        const proxyX = 560;
        const proxyY = centerY;

        // Severing Dashed Line
        ctx.beginPath();
        ctx.setLineDash([8, 8]);
        ctx.moveTo(pcX, pcY);
        ctx.lineTo(proxyX, proxyY);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.setLineDash([]);

        // Reverse Teardown Packets
        teardownPackets.forEach((pkt) => {
          pkt.progress -= pkt.speed;
          if (pkt.progress <= 0) pkt.progress = 1;

          const px = pcX + (proxyX - pcX) * pkt.progress;
          const py = pcY;

          ctx.beginPath();
          ctx.arc(px, py, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.fill();

          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(Math.min(proxyX, px + 26), py);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
          ctx.lineWidth = 1.8;
          ctx.stroke();
        });

        // Left: Мой ПК with bordered badge
        drawBadge(ctx, pcX, pcY, 26, 'rgba(255, 255, 255, 0.85)');
        drawMonitorLogo(ctx, pcX, pcY, 26, '#ffffff');
        ctx.font = '500 15px "Inter", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText('Мой ПК', pcX, pcY + 44);
        ctx.font = '12px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.fillText('Прямой доступ', pcX, pcY + 62);

        // Right: Прокси-сервер with bordered badge
        drawBadge(ctx, proxyX, proxyY, 26, 'rgba(255, 255, 255, 0.7)');
        drawServerLogo(ctx, proxyX, proxyY, 26, 'rgba(255, 255, 255, 0.7)');
        ctx.font = '500 15px "Inter", sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fillText('Прокси-сервер', proxyX, proxyY + 44);
        ctx.font = '12px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.fillText('Сессия закрыта', proxyX, proxyY + 62);

        // Center Step Indicator
        let stepText = '1/2: РАЗРЫВ ОПТИЧЕСКОГО ТУННЕЛЯ И СБРОС СИСТЕМНОГО ПРОКСИ...';
        if (teardownTimer > 1.0 && teardownTimer <= 2.0) {
          stepText = '2/2: ЗАКРЫТИЕ СЕССИИ И ОЧИСТКА РЕЕСТРА WINDOWS...';
        } else if (teardownTimer > 2.0) {
          stepText = '✓ ТУННЕЛЬ ОТКЛЮЧЕН. ПРЯМОЙ ДОСТУП ВОССТАНОВЛЕН';
        }

        ctx.font = '13px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fillText(stepText, centerX, centerY - 36);
        ctx.textAlign = 'left';
        return;
      }

      // ────────────────────────────────────────────────────────────────────────
      // PHASE 3: 3D CYBER DOT-MATRIX EARTH SPHERE
      // ────────────────────────────────────────────────────────────────────────

      if (!isDraggingRef.current) {
        rotRef.current.y += isActive ? 0.0016 : 0.0011;
      }

      const rotY = rotRef.current.y;
      const rotX = rotRef.current.x;
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);
      const isRedAlert = Boolean(isUnconfiguredWarning);

      // Smooth hover interpolation for organic illumination (0 -> 1)
      const targetHover = isHoveringRef.current ? 1.0 : 0.0;
      hoverProgRef.current += (targetHover - hoverProgRef.current) * 0.1;
      const hoverVal = hoverProgRef.current;

      // 1. Atmosphere Horizon Ring (Illuminates upon hovering)
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius + 14, 0, Math.PI * 2);
      ctx.strokeStyle = isRedAlert
        ? 'rgba(239, 68, 68, 0.65)'
        : isActive
        ? `rgba(255, 255, 255, ${0.12 + hoverVal * 0.18})`
        : `rgba(255, 255, 255, ${0.03 + hoverVal * 0.25})`;
      ctx.lineWidth = isRedAlert ? 1.5 : (1.0 + hoverVal * 0.6);
      ctx.stroke();

      // Core planet rim (Illuminates upon hovering)
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.strokeStyle = isRedAlert
        ? 'rgba(239, 68, 68, 0.9)'
        : isActive
        ? `rgba(255, 255, 255, ${0.35 + hoverVal * 0.25})`
        : `rgba(255, 255, 255, ${0.12 + hoverVal * 0.45})`;
      ctx.lineWidth = isRedAlert ? 1.75 : (1.2 + hoverVal * 0.6);
      ctx.stroke();

      // Atmospheric radial gradient depth (Glows softly upon hovering)
      const glowGrad = ctx.createRadialGradient(
        centerX, centerY, radius * 0.55,
        centerX, centerY, radius
      );
      const glowColor = isRedAlert
        ? 'rgba(239, 68, 68, 0.25)'
        : isActive
        ? `rgba(255, 255, 255, ${0.05 + hoverVal * 0.05})`
        : `rgba(255, 255, 255, ${0.015 + hoverVal * 0.08})`;
      glowGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      glowGrad.addColorStop(1, glowColor);
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fill();

      // Subtle Latitude Rings (Parallels)
      [-40, 0, 40].forEach((latDeg) => {
        ctx.beginPath();
        let started = false;
        const latRad = toRad(latDeg);
        for (let l = -180; l <= 180; l += 8) {
          const pt = project(latRad, toRad(l), radius, rotX, rotY);
          if (pt.z > 0) {
            if (!started) { ctx.moveTo(pt.x, pt.y); started = true; }
            else { ctx.lineTo(pt.x, pt.y); }
          } else {
            started = false;
          }
        }
        ctx.strokeStyle = isRedAlert
          ? 'rgba(239, 68, 68, 0.15)'
          : `rgba(255, 255, 255, ${latDeg === 0 ? (0.08 + hoverVal * 0.06) : (0.035 + hoverVal * 0.04)})`;
        ctx.lineWidth = latDeg === 0 ? 1 : 0.75;
        ctx.stroke();
      });

      // 2. RENDER AUTHENTIC CONTINENT COASTLINES (Batch rendered in a single draw call)
      ctx.beginPath();
      for (let r = 0; r < PRECOMPUTED_RINGS.length; r++) {
        const ring = PRECOMPUTED_RINGS[r];
        let drawing = false;
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i];
          const rx = p.nx * cosY + p.nz * sinY;
          const rz = p.nz * cosY - p.nx * sinY;
          const px = rx * radius;
          const py = p.ny * radius;
          const pz = rz * radius;
          const py2 = py * cosX - pz * sinX;
          const pz2 = py * sinX + pz * cosX;

          if (pz2 > -2) {
            const sx = centerX + px;
            const sy = centerY - py2;
            if (!drawing) {
              ctx.moveTo(sx, sy);
              drawing = true;
            } else {
              ctx.lineTo(sx, sy);
            }
          } else {
            drawing = false;
          }
        }
      }
      ctx.strokeStyle = isRedAlert
        ? 'rgba(239, 68, 68, 0.45)'
        : isActive
        ? `rgba(255, 255, 255, ${0.22 + hoverVal * 0.18})`
        : `rgba(255, 255, 255, ${0.11 + hoverVal * 0.22})`;
      ctx.lineWidth = 1.0;
      ctx.stroke();

      // 3. RENDER 3D DOT-MATRIX CONTINENTS (Precomputed coordinates batched into 2 depth tiers)
      const fgDots = [];
      const bgDots = [];

      for (let i = 0; i < PRECOMPUTED_DOTS.length; i++) {
        const p = PRECOMPUTED_DOTS[i];
        const rx = p.nx * cosY + p.nz * sinY;
        const rz = p.nz * cosY - p.nx * sinY;
        const px = rx * radius;
        const py = p.ny * radius;
        const pz = rz * radius;
        const py2 = py * cosX - pz * sinX;
        const pz2 = py * sinX + pz * cosX;

        if (pz2 > 0) {
          const sx = centerX + px;
          const sy = centerY - py2;
          const depth = pz2 / radius;
          if (depth > 0.4) {
            fgDots.push(sx, sy);
          } else {
            bgDots.push(sx, sy);
          }
        }
      }

      // Draw midground / limb dots batch
      if (bgDots.length > 0) {
        ctx.beginPath();
        const dSize = 1.1 + hoverVal * 0.25;
        const half = dSize / 2;
        for (let i = 0; i < bgDots.length; i += 2) {
          ctx.rect(bgDots[i] - half, bgDots[i + 1] - half, dSize, dSize);
        }
        ctx.fillStyle = isRedAlert
          ? 'rgba(239, 68, 68, 0.35)'
          : isActive
          ? `rgba(255, 255, 255, ${0.22 + hoverVal * 0.2})`
          : `rgba(255, 255, 255, ${0.1 + hoverVal * 0.25})`;
        ctx.fill();
      }

      // Draw foreground dots batch
      if (fgDots.length > 0) {
        ctx.beginPath();
        const dSize = 1.8 + hoverVal * 0.3;
        const half = dSize / 2;
        for (let i = 0; i < fgDots.length; i += 2) {
          ctx.rect(fgDots[i] - half, fgDots[i + 1] - half, dSize, dSize);
        }
        ctx.fillStyle = isRedAlert
          ? 'rgba(239, 68, 68, 0.75)'
          : isActive
          ? `rgba(255, 255, 255, ${0.65 + hoverVal * 0.2})`
          : `rgba(255, 255, 255, ${0.32 + hoverVal * 0.35})`;
        ctx.fill();
      }

      // 4. PARABOLIC ROUTE BEAMS (Main highway + elegant branch lines)
      arcs.forEach((arc) => {
        const fromPt = project(arc.from.lat, arc.from.lon, radius, rotX, rotY);
        const toPt = project(arc.to.lat, arc.to.lon, radius, rotX, rotY);

        const segments = 16;
        const curvePoints = [];
        let anyVisible = false;

        for (let i = 0; i <= segments; i++) {
          const t = i / segments;
          const lat = arc.from.lat + (arc.to.lat - arc.from.lat) * t;
          let lonDiff = arc.to.lon - arc.from.lon;
          if (lonDiff > Math.PI) lonDiff -= Math.PI * 2;
          if (lonDiff < -Math.PI) lonDiff += Math.PI * 2;
          const lon = arc.from.lon + lonDiff * t;

          // Grand parabolic arch above Earth
          const altitude = Math.sin(t * Math.PI) * (arc.primary ? 38 : 26);
          const pt = project(lat, lon, radius + altitude, rotX, rotY);
          curvePoints.push(pt);
          if (pt.z > -15) anyVisible = true;
        }

        if (anyVisible) {
          ctx.beginPath();
          curvePoints.forEach((pt, idx) => {
            if (idx === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          });

          if (isRedAlert) {
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
            ctx.lineWidth = 1;
          } else if (isActive) {
            ctx.strokeStyle = arc.primary
              ? `rgba(255, 255, 255, ${0.65 + hoverVal * 0.25})`
              : `rgba(255, 255, 255, ${0.22 + hoverVal * 0.1})`;
            ctx.lineWidth = arc.primary ? 2.0 : 1.0;
          } else {
            ctx.strokeStyle = arc.primary
              ? `rgba(255, 255, 255, ${0.12 + hoverVal * 0.35})`
              : 'rgba(255, 255, 255, 0.03)';
            ctx.lineWidth = arc.primary ? (1.2 + hoverVal * 0.5) : 0.8;
          }
          ctx.stroke();

          // Active Telemetry Packets streaming along beams
          if (isActive && !isRedAlert) {
            const pkt = arcPackets.find((p) => p.arc === arc);
            if (pkt) {
              pkt.progress += pkt.speed;
              if (pkt.progress >= 1) pkt.progress = 0;

              const idx = Math.min(segments - 1, Math.floor(pkt.progress * segments));
              const pPt = curvePoints[idx];

              if (pPt && pPt.z > -10) {
                // Packet head
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(pPt.x, pPt.y, pkt.pulseSize, 0, Math.PI * 2);
                ctx.fill();

                // Trailing streak
                const prevPt = curvePoints[Math.max(0, idx - 2)];
                if (prevPt) {
                  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
                  ctx.lineWidth = arc.primary ? 1.5 : 1.0;
                  ctx.beginPath();
                  ctx.moveTo(pPt.x, pPt.y);
                  ctx.lineTo(prevPt.x, prevPt.y);
                  ctx.stroke();
                }
              }
            }
          }
        }
      });

      // 5. RENDER BORDERLESS AUTHENTIC COMPANY LOGOS FROM INTERNET
      companyNodes.forEach((node) => {
        const pt = project(node.lat, node.lon, radius, rotX, rotY);
        if (pt.z > 0) {
          const depth = pt.z / radius;
          const alpha = 0.25 + depth * 0.75;
          const logoColor = isRedAlert
            ? `rgba(239, 68, 68, ${alpha})`
            : isActive
            ? `rgba(255, 255, 255, ${alpha * 0.95})`
            : `rgba(255, 255, 255, ${Math.min(1, alpha * 0.55 + hoverVal * 0.35)})`;

          // Draw authentic official brand vector logo (borderless, zero enclosing boxes)
          const drawn = drawOfficialBrandLogo(ctx, node.logoType, pt.x, pt.y, 20, logoColor);
          if (!drawn) {
            drawCustomLogo(ctx, pt.x, pt.y, 18, logoColor);
          }
        }
      });

      // 6. RENDER ORIGIN & GATEWAY STATIONS (Мой ПК & Прокси — strictly with circular border outline)
      const clientPt = project(clientNode.lat, clientNode.lon, radius, rotX, rotY);
      const proxyPt = project(proxyNode.lat, proxyNode.lon, radius, rotX, rotY);

      // Render Proxy Gateway with circular border badge
      if (proxyPt.z > -10) {
        const alpha = Math.max(0.2, (proxyPt.z + 10) / (radius + 10));
        const color = isRedAlert
          ? `rgba(239, 68, 68, ${alpha})`
          : isActive
          ? `rgba(255, 255, 255, ${alpha * 0.95})`
          : `rgba(255, 255, 255, ${Math.min(1, alpha * 0.6 + hoverVal * 0.35)})`;

        const badgeR = 15;
        const borderColor = isRedAlert
          ? `rgba(239, 68, 68, ${alpha * 0.9})`
          : isActive
          ? `rgba(255, 255, 255, ${alpha * 0.9})`
          : `rgba(255, 255, 255, ${Math.min(1, alpha * 0.55 + hoverVal * 0.4)})`;

        drawBadge(ctx, proxyPt.x, proxyPt.y, badgeR, borderColor);
        drawServerLogo(ctx, proxyPt.x, proxyPt.y, 16, color);

        // Clean label positioned to the left of the badge
        if (proxyPt.z > 15) {
          ctx.font = '500 12px "Inter", sans-serif';
          ctx.fillStyle = color;
          ctx.textAlign = 'right';
          ctx.fillText(proxyNode.name, proxyPt.x - (badgeR + 6), proxyPt.y + 4);
        }
      }

      // Render Client Station with circular border badge
      if (clientPt.z > -10) {
        const alpha = Math.max(0.2, (clientPt.z + 10) / (radius + 10));
        const color = isRedAlert
          ? `rgba(239, 68, 68, ${alpha})`
          : isActive
          ? `rgba(255, 255, 255, ${alpha * 0.95})`
          : `rgba(255, 255, 255, ${Math.min(1, alpha * 0.6 + hoverVal * 0.35)})`;

        const badgeR = 15;
        const borderColor = isRedAlert
          ? `rgba(239, 68, 68, ${alpha * 0.9})`
          : isActive
          ? `rgba(255, 255, 255, ${alpha * 0.9})`
          : `rgba(255, 255, 255, ${Math.min(1, alpha * 0.55 + hoverVal * 0.4)})`;

        drawBadge(ctx, clientPt.x, clientPt.y, badgeR, borderColor);
        drawMonitorLogo(ctx, clientPt.x, clientPt.y, 16, color);

        // Clean label positioned to the right of the badge
        if (clientPt.z > 15) {
          ctx.font = '500 12px "Inter", sans-serif';
          ctx.fillStyle = color;
          ctx.textAlign = 'left';
          ctx.fillText(clientNode.name, clientPt.x + (badgeR + 6), clientPt.y + 4);
        }
      }
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [isActive, isConnecting, isDisconnecting, isUnconfiguredWarning, clientNode, proxyNode, companyNodes, arcs]);

  return (
    <div className={styles.wrapper}>
      {/* 3D Clickable & Draggable Globe Canvas */}
      <div
        className={`${styles.canvasContainer} ${isUnconfiguredWarning ? styles.warningShake : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          style={{ width: 680, height: 480 }}
        />
      </div>

      {/* Standalone Status & Clean Real IP Text */}
      <div className={styles.footerSection}>
        <div className={styles.statusLine}>
          <span
            className={styles.statusDot}
            data-warning={isUnconfiguredWarning}
            data-active={isActive}
            data-unconfigured={!isConfigured}
          />
          <span className={styles.statusLabel}>
            {isUnconfiguredWarning ? (
              <span className={styles.statusLabelWarning}>
                Прокси не настроен — укажите данные в настройках
              </span>
            ) : isConnecting ? (
              'Авторизация на прокси-сервере...'
            ) : isDisconnecting ? (
              'Отключение прокси-туннеля...'
            ) : isActive ? (
              `Прокси включен (маршрутизируется сервисов: ${activeServices.length})`
            ) : !isConfigured ? (
              <span
                style={{ cursor: 'pointer', textDecoration: 'underline' }}
                onClick={onOpenSettings}
                title="Перейти в настройки для ввода данных прокси"
              >
                Прокси не настроен — нажмите для перехода в настройки
              </span>
            ) : (
              'Прокси выключен (прямое подключение)'
            )}
          </span>
        </div>

        {/* Clean Standalone Real IPv4 */}
        <div className={styles.ipContainer}>
          <span className={styles.ipLabel}>Ваш IP:</span>
          <span className={`mono ${styles.ipValue}`}>{publicIp || 'Определение...'}</span>

          <button
            type="button"
            className="btn-icon"
            onClick={onRefreshIp}
            title="Обновить публичный IP"
            style={{ width: '30px', height: '30px', marginLeft: '6px' }}
          >
            <RefreshCw size={13} />
          </button>

          <button
            type="button"
            className="btn-icon"
            onClick={handleCopyIp}
            title="Скопировать IP в буфер обмена"
            style={{ width: '30px', height: '30px' }}
          >
            {copied ? <Check size={13} color="#ffffff" /> : <Copy size={13} />}
          </button>
        </div>
      </div>
    </div>
  );
}
