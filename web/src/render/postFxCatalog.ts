// web/src/render/postFxCatalog.ts
// Pure data shared by the control graph (UI) and the renderer registry.
// MUST NOT import three — the control graph stays three-free.

export type FxDomain = 'linear' | 'display';
export type FxCompose = 'replace' | 'blend' | 'additive' | 'feedback' | 'transform';

export type FxParamSpec = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  structural?: boolean;
};

export type FxSelectOption = { value: string; label: string };
export type FxSelectSpec = {
  key: string;
  label: string;
  options: readonly FxSelectOption[];
  def: string;
};

export type FxKind =
  | 'pixelate'
  | 'posterize'
  | 'filmGrain'
  | 'rgbShift'
  | 'sobel'
  | 'afterImage'
  | 'bloom'
  | 'toneMap'
  | 'dotScreen'
  | 'chromaticAberration'
  | 'sepia'
  | 'bleach'
  | 'blur'
  | 'anamorphic'
  | 'feedback'
  | 'aa'
  | 'contours';

export type FxDescriptor = {
  kind: FxKind;
  label: string;
  icon: string; // lucide-react icon name
  domain: FxDomain;
  compose: FxCompose;
  params: readonly FxParamSpec[];
  selects?: readonly FxSelectSpec[];
};

const P = (key: string, label: string, min: number, max: number, step: number, def: number): FxParamSpec =>
  ({ key, label, min, max, step, def });

export const EFFECT_CATALOG: readonly FxDescriptor[] = [
  { kind: 'pixelate', label: 'Pixelate', icon: 'Grid2x2', domain: 'display', compose: 'replace',
    params: [P('size', 'Size', 1, 64, 1, 1)] },
  { kind: 'posterize', label: 'Posterize', icon: 'Layers', domain: 'display', compose: 'replace',
    params: [P('steps', 'Steps', 2, 256, 1, 256)] },
  { kind: 'filmGrain', label: 'Film grain', icon: 'Film', domain: 'display', compose: 'replace',
    params: [P('amount', 'Amount', 0, 1, 0.01, 0)] },
  { kind: 'rgbShift', label: 'RGB shift', icon: 'Columns3', domain: 'display', compose: 'replace',
    params: [P('amount', 'Amount', 0, 0.1, 0.001, 0), P('angle', 'Angle (rad)', 0, 6.2832, 0.01, 0)] },
  { kind: 'sobel', label: 'Sobel', icon: 'PenLine', domain: 'display', compose: 'blend',
    params: [P('mix', 'Edge mix', 0, 1, 0.01, 0)] },
  { kind: 'afterImage', label: 'Afterimage', icon: 'History', domain: 'display', compose: 'feedback',
    params: [P('trail', 'Trail', 0, 1, 0.01, 0)] },
  { kind: 'bloom', label: 'Bloom', icon: 'Sparkles', domain: 'linear', compose: 'additive',
    params: [P('strength', 'Strength', 0, 4, 0.01, 0.5), P('radius', 'Radius', 0, 1, 0.01, 0.4), P('threshold', 'Threshold', 0, 1, 0.01, 0.8)] },
  { kind: 'toneMap', label: 'Tone map', icon: 'Contrast', domain: 'linear', compose: 'transform',
    params: [] },
  { kind: 'dotScreen', label: 'Dot screen', icon: 'CircleDot', domain: 'display', compose: 'replace',
    // Scale is a normalized 0..1 slider; the builder maps it scale = 8*v^2 so the
    // coarse/useful range gets most of the travel and the ultra-fine degenerate
    // bottom (raw scale 0..0.10) is compressed into the first ~11% of the slider.
    params: [P('angle', 'Angle (rad)', 0, 6.2832, 0.01, 1.5708), P('scale', 'Scale', 0, 1, 0.01, 0.35)] },
  { kind: 'chromaticAberration', label: 'Chromatic', icon: 'Aperture', domain: 'display', compose: 'replace',
    params: [P('strength', 'Strength', 0, 8, 0.05, 0), P('scale', 'Scale', 1, 1.5, 0.01, 1.1)] },
  { kind: 'sepia', label: 'Sepia', icon: 'Coffee', domain: 'display', compose: 'blend',
    params: [P('mix', 'Mix', 0, 1, 0.01, 0)] },
  { kind: 'bleach', label: 'Bleach', icon: 'Sun', domain: 'display', compose: 'blend',
    params: [P('opacity', 'Opacity', 0, 1, 0.01, 0)] },
  { kind: 'blur', label: 'Blur', icon: 'Haze', domain: 'linear', compose: 'replace',
    params: [P('amount', 'Amount', 0, 1, 0.01, 0)] },
  { kind: 'anamorphic', label: 'Anamorphic', icon: 'Zap', domain: 'linear', compose: 'additive',
    params: [P('threshold', 'Threshold', 0, 1, 0.01, 0.9), P('scale', 'Scale', 0, 20, 0.1, 3)],
    selects: [{ key: 'samples', label: 'Quality', def: '32', options: [
      { value: '16', label: 'Low' }, { value: '32', label: 'Med' }, { value: '64', label: 'High' }] }] },
  { kind: 'feedback', label: 'Feedback', icon: 'Repeat', domain: 'display', compose: 'feedback',
    params: [P('trail', 'Persistence', 0, 1, 0.01, 0), P('zoom', 'Zoom', -0.1, 0.1, 0.001, 0),
             P('rotate', 'Rotate', -0.2, 0.2, 0.001, 0), P('hue', 'Hue', -0.5, 0.5, 0.001, 0)],
    selects: [
      { key: 'mode', label: 'Mode', def: 'trails', options: [
        { value: 'afterimage', label: 'Afterimage' }, { value: 'trails', label: 'Trails' }, { value: 'both', label: 'Both' }] },
      { key: 'mask', label: 'Mask', def: 'none', options: [
        { value: 'none', label: 'None' }, { value: 'surface', label: 'Surface' }, { value: 'inverse', label: 'Inverse' }] },
    ] },
  { kind: 'aa', label: 'Anti-alias', icon: 'Spline', domain: 'display', compose: 'replace',
    params: [],
    selects: [{ key: 'mode', label: 'Mode', def: 'off', options: [
      { value: 'off', label: 'Off' }, { value: 'fxaa', label: 'FXAA' }, { value: 'smaa', label: 'SMAA' }] }] },
  { kind: 'contours', label: 'Contours', icon: 'Map', domain: 'display', compose: 'blend',
    params: [P('spacing', 'Spacing', 1, 64, 0.5, 12), P('width', 'Width', 0.02, 0.49, 0.01, 0.12),
             P('mix', 'Mix', 0, 1, 0.01, 0), P('phase', 'Phase', 0, 1, 0.001, 0),
             P('r', 'Line R', 0, 1, 0.01, 0), P('g', 'Line G', 0, 1, 0.01, 0), P('b', 'Line B', 0, 1, 0.01, 0)] },
];

const BY_KIND = new Map<string, FxDescriptor>(EFFECT_CATALOG.map(d => [d.kind, d]));

export function fxDescriptor(kind: string): FxDescriptor | null {
  return BY_KIND.get(kind) ?? null;
}

export function isFxKind(kind: string): kind is FxKind {
  return BY_KIND.has(kind);
}

export function fxParamDefaults(kind: string): Record<string, number> {
  const descriptor = BY_KIND.get(kind);
  const out: Record<string, number> = {};
  if (!descriptor) return out;
  for (const param of descriptor.params) out[param.key] = param.def;
  return out;
}

export function fxSelectDefaults(kind: string): Record<string, string> {
  const descriptor = BY_KIND.get(kind);
  const out: Record<string, string> = {};
  if (!descriptor?.selects) return out;
  for (const select of descriptor.selects) out[select.key] = select.def;
  return out;
}

export function fxStructuralSignature(kind: string, params: Record<string, number>, selects: Record<string, string>): string {
  const descriptor = BY_KIND.get(kind);
  if (!descriptor) return '';
  const parts: string[] = [];
  for (const p of descriptor.params) if (p.structural) parts.push(`${p.key}=${params[p.key] ?? p.def}`);
  for (const s of descriptor.selects ?? []) parts.push(`${s.key}=${selects[s.key] ?? s.def}`);
  return parts.join(',');
}
