export const MAX_COLORS = 16;

export type Oklch = [number, number, number];
export type Palette = {
  name: string;
  bg: Oklch;
  colors: Oklch[];
};

type PalettePreset = {
  name: string;
  bg: Oklch;
  colors: (colorCount: number) => Oklch[];
};

const PRESETS: PalettePreset[] = [
  { name: 'BW', bg: [0, 0, 0], colors: () => Array.from({ length: MAX_COLORS }, (_, i): Oklch => [i & 1 ? 1 : 0, 0, 0]) },
  { name: 'Greys', bg: [0, 0, 0], colors: k => k <= 2 ? pad([[0.32, 0, 0], [0.78, 0, 0]]) : even([0.12, 0, 0], [0.92, 0, 0], k) },
  { name: 'Prism', bg: [0, 0, 0], colors: k => {
    if (k <= 2) return pad([[0.65, 0.27, 0], [0.92, 0.18, 95]]);
    const out: Oklch[] = [[0, 0, 0]];
    const inner = k - 2;
    for (let i = 0; i < inner; i++) out.push([0.65, 0.18, (i * 360 / inner + 30) % 360]);
    out.push([1, 0, 0]);
    return pad(out);
  } },
  { name: 'Paper', bg: [0.96, 0.005, 80], colors: k => even([0.86, 0.02, 80], [0.16, 0.02, 280], k) },
  { name: 'Gold', bg: [0.04, 0.005, 280], colors: k => even([0.18, 0.02, 280], [0.78, 0.13, 80], k) },
  { name: 'Rust', bg: [0.08, 0.04, 30], colors: k => even([0.20, 0.06, 30], [0.72, 0.18, 35], k) },
  { name: 'Plum', bg: [0.06, 0.02, 320], colors: k => even([0.22, 0.08, 320], [0.72, 0.16, 350], k) },
  { name: 'Cobalt', bg: [0.06, 0.02, 260], colors: k => even([0.18, 0.06, 260], [0.72, 0.16, 240], k) },
  { name: 'Sage', bg: [0.08, 0.012, 150], colors: k => even([0.32, 0.04, 150], [0.78, 0.10, 140], k) },
  { name: 'Spectra', bg: [0.04, 0.005, 280], colors: k => pad(Array.from({ length: k }, (_, i): Oklch => [0.70, 0.16, (i * 360 / Math.max(k, 1) + 30) % 360])) },
  { name: 'Girih', bg: [0.12, 0.018, 250], colors: () => pad([[0.92, 0.04, 85], [0.42, 0.10, 220], [0.66, 0.12, 200], [0.62, 0.14, 60], [0.30, 0.06, 20], [0.78, 0.15, 90]]) },
  { name: 'Custom', bg: [0.04, 0.005, 280], colors: k => even([0.18, 0.02, 280], [0.78, 0.13, 80], k) },
];

function lerp(a: Oklch, b: Oklch, t: number): Oklch {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function even(a: Oklch, b: Oklch, k: number): Oklch[] {
  if (k <= 1) return pad([a]);
  return pad(Array.from({ length: k }, (_, i) => lerp(a, b, i / (k - 1))));
}

function pad(colors: Oklch[]): Oklch[] {
  const out = colors.slice(0, MAX_COLORS);
  while (out.length < MAX_COLORS) out.push([0.65, 0.14, (out.length * 36 + 20) % 360]);
  return out;
}

export function buildPalette(presetIndex: number, colorCount: number, customColors: Oklch[] | null = null): Palette {
  const k = Math.max(1, Math.min(MAX_COLORS, colorCount | 0));
  if (presetIndex === 11 && customColors) {
    return {
      name: 'Custom',
      bg: customColors[0] ?? PRESETS[11]!.bg,
      colors: pad(customColors),
    };
  }
  const preset = PRESETS[Math.max(0, Math.min(PRESETS.length - 1, presetIndex | 0))] ?? PRESETS[4]!;
  return {
    name: preset.name,
    bg: preset.bg,
    colors: preset.colors(k),
  };
}

export function oklchToLinearSrgb([L, C, H]: Oklch): Oklch {
  const hRad = H * Math.PI / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);
  const l = L + 0.3963377774 * a + 0.2158037573 * b;
  const m = L - 0.1055613458 * a - 0.0638541728 * b;
  const s = L - 0.0894841775 * a - 1.2914855480 * b;
  const l3 = l * l * l;
  const m3 = m * m * m;
  const s3 = s * s * s;
  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3,
  ];
}

export function linearSrgbToLinearP3([r, g, b]: Oklch): Oklch {
  return [
    0.8224621 * r + 0.1775379 * g,
    0.0331941 * r + 0.9668059 * g,
    0.0170827 * r + 0.0723974 * g + 0.9105199 * b,
  ];
}

export function oklchCss([L, C, H]: Oklch, alpha = 1): string {
  const body = `${(L * 100).toFixed(3)}% ${C.toFixed(4)} ${H.toFixed(2)}`;
  return alpha < 1 ? `oklch(${body} / ${alpha})` : `oklch(${body})`;
}

export function displayGamutLabel(): string {
  const rec2020 = matchMedia('(color-gamut: rec2020)').matches;
  const p3 = matchMedia('(color-gamut: p3)').matches;
  if (rec2020) return 'Screen: Rec.2020 class; WebGPU canvas: sRGB managed.';
  if (p3) return 'Screen: Display-P3 class; WebGPU canvas: sRGB managed.';
  return 'Screen: sRGB class; WebGPU canvas: sRGB managed.';
}
