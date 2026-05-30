// Small shared UI helpers for the graph node components: the audio-meter outlet
// row, a mm:ss time formatter, and the slider-handler factory that routes a
// setting through live-preview (onPreviewSetting + commit) or a direct commit
// depending on whether the setting supports live preview.
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
    <div className="meter-row port-meter-row">
      <span>{label}</span>
      <div className="meter-track">
        <i style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
      </div>
      <Handle className="meter-outlet-handle" id={id} type="source" position={Position.Right} />
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

export function drawWheel(canvas: HTMLCanvasElement | null, selected: Oklch) {
  if (!canvas || !selected) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const size = canvas.width;
  const image = ctx.createImageData(size, size);
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
  ctx.putImageData(image, 0, 0);
  const markerRadius = selected[1] / 0.37 * size * 0.5;
  const markerAngle = selected[2] * Math.PI / 180;
  ctx.beginPath();
  ctx.arc(
    size * 0.5 + Math.cos(markerAngle) * markerRadius,
    size * 0.5 + Math.sin(markerAngle) * markerRadius,
    6,
    0,
    Math.PI * 2,
  );
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
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
