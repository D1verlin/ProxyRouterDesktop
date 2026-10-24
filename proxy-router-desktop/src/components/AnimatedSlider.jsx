import React, { useRef, useState } from 'react';
import styles from './AnimatedSlider.module.css';

/**
 * AnimatedSlider — Dark Monolith Minimalist slider with smooth animated thumb,
 * dynamic progress fill bar, live mono value pill, and animated preset chips.
 */
export default function AnimatedSlider({
  value,
  min = 0,
  max = 100,
  step = 1,
  unit = '',
  label,
  description,
  icon: Icon,
  presets = [],
  onChange,
  disabled = false,
}) {
  const [isInteracting, setIsInteracting] = useState(false);
  const inputRef = useRef(null);

  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

  const handlePresetClick = (targetVal) => {
    if (disabled) return;
    onChange(targetVal);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  return (
    <div className={`${styles.sliderGroup} ${disabled ? styles.disabled : ''}`}>
      <div className={styles.header}>
        <div className={styles.labelCol}>
          <div className={styles.labelRow}>
            {Icon && <Icon size={14} className={styles.fieldIcon} />}
            <span className={styles.label}>{label}</span>
          </div>
          {description && <span className={styles.desc}>{description}</span>}
        </div>
        <div className={`${styles.valueBadge} ${isInteracting ? styles.valueBadgeActive : ''}`}>
          <span className={styles.monoValue}>
            {value}
            <span className={styles.unit}>{unit}</span>
          </span>
        </div>
      </div>

      <div className={styles.trackWrapper}>
        <input
          ref={inputRef}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerDown={() => setIsInteracting(true)}
          onPointerUp={() => setIsInteracting(false)}
          onKeyDown={() => setIsInteracting(true)}
          onKeyUp={() => setIsInteracting(false)}
          className={styles.rangeInput}
          style={{ '--fill-pct': `${pct}%` }}
          aria-label={label}
        />
      </div>

      {presets && presets.length > 0 && (
        <div className={styles.presetsRow}>
          {presets.map((preset) => {
            const presetVal = typeof preset === 'object' ? preset.value : preset;
            const presetLabel = typeof preset === 'object' ? preset.label : `${presetVal}${unit}`;
            const isActive = value === presetVal;

            return (
              <button
                key={presetVal}
                type="button"
                disabled={disabled}
                className={`${styles.presetBtn} ${isActive ? styles.presetBtnActive : ''}`}
                onClick={() => handlePresetClick(presetVal)}
              >
                {presetLabel}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
