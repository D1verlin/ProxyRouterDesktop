/**
 * ClayIcon.jsx — Authentic 3D Clay Candy Icon with Mask-based Tint Layer
 *
 * Implements the official design system:
 * - Base image filtered to luminous monochrome clay via grayscale
 * - Overlay tint layer with mix-blend-mode: color clipped by mask-image
 * - Avoids shorthand mask properties to ensure cross-browser & WebView2 compatibility
 */

import styles from './ClayIcon.module.css';

export default function ClayIcon({
  icon,
  tint,
  size = 42,
  className = '',
  active = true,
  grayscale = true,
  style = {},
}) {
  return (
    <span
      className={`${styles.wrapper} ${className}`}
      style={{
        width: typeof size === 'number' ? `${size}px` : size,
        height: typeof size === 'number' ? `${size}px` : size,
        ...style,
      }}
    >
      <img
        src={icon}
        alt=""
        className={styles.baseImg}
        style={{
          filter: grayscale
            ? 'grayscale(1) brightness(1.08) contrast(1.10) drop-shadow(0 4px 10px rgba(13, 13, 12, 0.12))'
            : 'drop-shadow(0 4px 10px rgba(13, 13, 12, 0.12))',
        }}
        draggable={false}
      />
      {tint && (
        <span
          className={styles.tintLayer}
          style={{
            backgroundColor: tint,
            opacity: active ? 1 : 0,
            WebkitMaskImage: `url("${icon}")`,
            maskImage: `url("${icon}")`,
            '--tint-mask': `url("${icon}")`,
          }}
        />
      )}
    </span>
  );
}
