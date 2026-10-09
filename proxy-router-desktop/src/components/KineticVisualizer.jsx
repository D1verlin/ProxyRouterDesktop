/**
 * KineticVisualizer.jsx — Interactive Geometric Core Reactor Visualizer.
 * Conforms strictly to Dark Monolith design system:
 * - NO emojis, NO neon glows, NO pulsing status dots.
 * - Interactive canvas vector particles & kinetic rings responding to mouse coordinates.
 * - Smooth state transitions between Idle, Connecting, Active, and Disconnecting.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Power } from 'lucide-react';
import styles from './KineticVisualizer.module.css';

export default function KineticVisualizer({ isActive, isConnecting, onToggle, disabled }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0, hover: false });

  const handleMouseMove = useCallback((e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setMousePos({ x, y, hover: true });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setMousePos({ x: 0, y: 0, hover: false });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animId;

    // Device Pixel Ratio for crisp retina rendering
    const dpr = window.devicePixelRatio || 1;
    const size = 320;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const center = size / 2;
    let angle1 = 0;
    let angle2 = 0;
    let scanAngle = 0;

    // Orbital particles for active state
    const particleCount = 28;
    const particles = Array.from({ length: particleCount }, (_, i) => ({
      orbitRadius: 75 + (i % 3) * 35,
      angle: (i / particleCount) * Math.PI * 2,
      speed: (0.012 + (i % 4) * 0.006) * ((i % 2 === 0) ? 1 : -1),
      size: 1.5 + (i % 3) * 0.5,
      alpha: 0.2 + (i % 5) * 0.15,
    }));

    const render = () => {
      ctx.clearRect(0, 0, size, size);

      // Mouse tilt offset
      const tiltX = mousePos.x * 12;
      const tiltY = mousePos.y * 12;

      ctx.save();
      ctx.translate(center + tiltX, center + tiltY);

      // Determine state speeds
      const speedMultiplier = isConnecting ? 3.0 : isActive ? 1.4 : 0.4;
      angle1 += 0.008 * speedMultiplier;
      angle2 -= 0.005 * speedMultiplier;
      scanAngle += 0.03 * speedMultiplier;

      // ── Outer Geometric Segmented Ring (Radius ~120) ───────────────────────
      ctx.save();
      ctx.rotate(angle1);
      ctx.lineWidth = 1;
      ctx.strokeStyle = isActive
        ? 'rgba(255, 255, 255, 0.35)'
        : 'rgba(255, 255, 255, 0.08)';

      const segments = 4;
      const segArc = (Math.PI * 2) / segments;
      for (let i = 0; i < segments; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, 120, i * segArc + 0.15, (i + 1) * segArc - 0.15);
        ctx.stroke();

        // Tick marks at segment borders
        const a = i * segArc;
        const x1 = Math.cos(a) * 115;
        const y1 = Math.sin(a) * 115;
        const x2 = Math.cos(a) * 125;
        const y2 = Math.sin(a) * 125;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.restore();

      // ── Middle Concentric Orbit Track (Radius ~90) ─────────────────────────
      ctx.save();
      ctx.rotate(angle2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = isActive
        ? 'rgba(255, 255, 255, 0.2)'
        : 'rgba(255, 255, 255, 0.05)';
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, 90, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // ── Inner Ring (Radius ~65) ────────────────────────────────────────────
      ctx.lineWidth = 1;
      ctx.strokeStyle = isActive
        ? 'rgba(255, 255, 255, 0.4)'
        : 'rgba(255, 255, 255, 0.09)';
      ctx.beginPath();
      ctx.arc(0, 0, 65, 0, Math.PI * 2);
      ctx.stroke();

      // ── Connecting Scanning Radar Arc ──────────────────────────────────────
      if (isConnecting) {
        ctx.save();
        ctx.rotate(scanAngle);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.beginPath();
        ctx.arc(0, 0, 65, 0, Math.PI * 0.4);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.beginPath();
        ctx.arc(0, 0, 120, 0, Math.PI * 0.25);
        ctx.stroke();
        ctx.restore();
      }

      // ── Active Orbital Data Particles ──────────────────────────────────────
      if (isActive || isConnecting) {
        particles.forEach((p) => {
          p.angle += p.speed * (isConnecting ? 2.5 : 1.0);
          const px = Math.cos(p.angle) * p.orbitRadius;
          const py = Math.sin(p.angle) * p.orbitRadius;

          ctx.fillStyle = isActive
            ? `rgba(255, 255, 255, ${p.alpha})`
            : `rgba(255, 255, 255, ${p.alpha * 0.4})`;

          ctx.beginPath();
          ctx.arc(px, py, p.size, 0, Math.PI * 2);
          ctx.fill();

          // Subtle trace segment behind particle
          ctx.strokeStyle = `rgba(255, 255, 255, ${p.alpha * 0.25})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(0, 0, p.orbitRadius, p.angle - 0.15, p.angle);
          ctx.stroke();
        });
      }

      // ── 4 Alignment Reticles (Corners) ────────────────────────────────────
      const reticleDist = 135;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      const reticleAngles = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
      reticleAngles.forEach((a) => {
        const rx = Math.cos(a) * reticleDist;
        const ry = Math.sin(a) * reticleDist;
        ctx.beginPath();
        ctx.moveTo(rx - 3, ry);
        ctx.lineTo(rx + 3, ry);
        ctx.moveTo(rx, ry - 3);
        ctx.lineTo(rx, ry + 3);
        ctx.stroke();
      });

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [isActive, isConnecting, mousePos]);

  return (
    <div
      ref={containerRef}
      className={styles.visualizerContainer}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <canvas ref={canvasRef} className={styles.canvas} style={{ width: 320, height: 320 }} />

      {/* Central Monolith Trigger Button */}
      <button
        type="button"
        className={`${styles.coreButton} ${isActive ? styles.coreActive : ''}`}
        onClick={onToggle}
        disabled={disabled}
        aria-label={isActive ? 'Deactivate Proxy Router' : 'Activate Proxy Router'}
      >
        <Power size={32} strokeWidth={1.5} />
      </button>

      {/* Status Overlay */}
      <div className={styles.statusInfo}>
        <span className={styles.statusPrimary}>
          {isConnecting ? 'ESTABLISHING GATEWAY' : isActive ? 'SYSTEM ROUTED' : 'STANDBY'}
        </span>
        <span className={styles.statusSecondary}>
          {isConnecting
            ? 'Whitelisting IP & setting PAC'
            : isActive
            ? 'Split Tunneling Active'
            : 'Click core to activate'}
        </span>
      </div>
    </div>
  );
}
