// Small shared UI helpers for the graph node components: the audio-meter outlet
// row, a mm:ss time formatter, and the slider-handler factory that routes a
// setting through live-preview (onPreviewSetting + commit) or a direct commit
// depending on whether the setting supports live preview.
import type { ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { SettingKey, Settings } from '../settings/androidSettings';
import { oklchToLinearSrgb, type Oklch } from '../color/palette';
import {
  BORDER_SETTING_KEYS,
  LIGHT_SETTING_KEYS,
  MATERIAL_SETTING_KEYS,
  RIPPLE_TARGET_SETTING_KEYS,
} from './settingKeys';
import type { SettingsNodeData } from './graphNodeData';

export function MeterOutlet({ id, label, value }: { id: string; label: string; value: number }) {
  return (
    <MeterRow label={label} port value={value}>
      <Handle className="meter-outlet-handle" id={id} type="source" position={Position.Right} />
    </MeterRow>
  );
}

export function MeterRow({ children, label, port = false, value }: { children?: ReactNode; label: string; port?: boolean; value: number }) {
  return (
    <div className={`meter-row${port ? ' port-meter-row' : ''}`}>
      <span>{label}</span>
      <div className="meter-track">
        <i style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
      </div>
      {children}
    </div>
  );
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

function settingHasLivePreview(key: SettingKey): boolean {
  return MATERIAL_SETTING_KEYS.some(item => item === key)
    || LIGHT_SETTING_KEYS.some(item => item === key)
    || RIPPLE_TARGET_SETTING_KEYS.some(item => item === key)
    || BORDER_SETTING_KEYS.some(item => item === key)
    || key === 'hyp_scale'
    || key === 'hyp_boost_x'
    || key === 'hyp_boost_y'
    || key === 'clock_rate';
}

export function settingRangeHandlers(data: SettingsNodeData, key: SettingKey): {
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
} {
  if (!settingHasLivePreview(key)) {
    return { onChange: value => data.onSetting(key, value) };
  }
  return {
    onChange: value => data.onPreviewSetting(key, value),
    onCommit: value => data.onSetting(key, value),
  };
}

// Merges live (uncommitted) boost-drag values over the saved settings so the
// projection node's sliders track the drag in real time.
export function settingWithLiveBoost(settings: Settings, liveBoost: { x: number; y: number } | null | undefined): Settings {
  if (!liveBoost) return settings;
  return {
    ...settings,
    hyp_boost_x: liveBoost.x,
    hyp_boost_y: liveBoost.y,
  };
}

type WheelCache = {
  bitmap: HTMLCanvasElement;
  luminance: number;
  size: number;
};

const wheelCache = new WeakMap<HTMLCanvasElement, WheelCache>();

export function drawWheel(canvas: HTMLCanvasElement | null, selected: Oklch) {
  if (!canvas || !selected) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const size = canvas.width;
  const cached = wheelCache.get(canvas);
  let bitmap: HTMLCanvasElement;
  if (cached && cached.size === size && Math.abs(cached.luminance - selected[0]) <= 1e-5) {
    bitmap = cached.bitmap;
  } else {
    bitmap = document.createElement('canvas');
    bitmap.width = size;
    bitmap.height = size;
    const bitmapCtx = bitmap.getContext('2d');
    if (!bitmapCtx) return;
    const image = bitmapCtx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = x / (size - 1) * 2 - 1;
        const ny = y / (size - 1) * 2 - 1;
        const radius = Math.hypot(nx, ny);
        const idx = (y * size + x) * 4;
        if (radius > 1) {
          image.data[idx + 3] = 0;
          continue;
        }
        const hue = (Math.atan2(ny, nx) * 180 / Math.PI + 360) % 360;
        const rgb = oklchToRgbBytes([selected[0], radius * 0.37, hue]);
        image.data[idx] = rgb[0];
        image.data[idx + 1] = rgb[1];
        image.data[idx + 2] = rgb[2];
        image.data[idx + 3] = 255;
      }
    }
    bitmapCtx.putImageData(image, 0, 0);
    wheelCache.set(canvas, { bitmap, luminance: selected[0], size });
  }
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(bitmap, 0, 0);
}

export function positionWheelMarker(marker: HTMLElement | null, selected: Oklch): void {
  if (!marker || !selected) return;
  const markerRadius = Math.max(0, Math.min(1, selected[1] / 0.37)) * 50;
  const markerAngle = selected[2] * Math.PI / 180;
  marker.style.setProperty('--wheel-marker-x', `${50 + Math.cos(markerAngle) * markerRadius}%`);
  marker.style.setProperty('--wheel-marker-y', `${50 + Math.sin(markerAngle) * markerRadius}%`);
}

function encodeSrgbByte(channel: number): number {
    const v = Math.max(0, Math.min(1, channel));
    const encoded = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
}

function oklchToRgbBytes(color: Oklch): [number, number, number] {
  const rgb = oklchToLinearSrgb(color);
  return [encodeSrgbByte(rgb[0]), encodeSrgbByte(rgb[1]), encodeSrgbByte(rgb[2])];
}
