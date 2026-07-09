// Three-free by design: this module is statically imported by App.tsx, so any
// `three/webgpu` import here would drag ~670 KB of three into the entry chunk.
// The BufferGeometry wrapper lives in orderFiveIfsGeometry.ts (lazy-loaded).
import type { Settings } from '../settings/androidSettings';
import { buildPalette, MAX_COLORS, MAX_PALETTE_PRESET, oklchToLinearSrgb, paletteColorAt, type Oklch } from '../color/palette';

export const ORDER_FIVE_IFS_FAMILY = 19;
export const ORDER_FIVE_IFS_LEVEL_COUNTS = [3000, 10000, 30000, 100000, 300000] as const;

type Affine2 = readonly [number, number, number, number, number, number];
type OrderFiveIfsSpec = {
  id: number;
  maps: readonly [Affine2, Affine2, Affine2, Affine2, Affine2];
  weights?: readonly [number, number, number, number, number];
};

// Extracted from Demonstration-Rep-tiles-and-Fractals-of-Order-Five-1-0-0-definition.nb.
// Each map is [a, b, tx, c, d, ty] for {a*x + b*y + tx, c*x + d*y + ty}.
const ORDER_FIVE_IFS: readonly OrderFiveIfsSpec[] = [
  {
    id: 1,
    maps: [
      [0.4, -0.2, 0, 0.2, 0.4, 0],
      [0.2, 0.4, 1, -0.4, 0.2, 0],
      [-0.4, 0.2, 1, -0.2, -0.4, -0],
      [-0.2, -0.4, 1, 0.4, -0.2, 0],
      [0.4, -0.2, 1, 0.2, 0.4, 0],
    ],
  },
  {
    id: 2,
    maps: [
      [0.4, 0.2, 0, 0.2, -0.4, 0],
      [-0.2, 0.4, 1, 0.4, 0.2, 0],
      [0.4, 0.2, 1, 0.2, -0.4, 0],
      [0.2, -0.4, 1, -0.4, -0.2, -0],
      [-0.4, -0.2, 1, -0.2, 0.4, 0],
    ],
  },
  {
    id: 3,
    maps: [
      [0.2, 0.4, 0, -0.4, 0.2, 0],
      [0.4, -0.2, 1, 0.2, 0.4, 0],
      [0.2, 0.4, 1, -0.4, 0.2, 0],
      [-0.4, 0.2, 1, -0.2, -0.4, -0],
      [-0.2, -0.4, 1, 0.4, -0.2, 0],
    ],
  },
  {
    id: 4,
    maps: [
      [0.2, -0.4, 0, -0.4, -0.2, -0],
      [0.4, 0.2, 1, 0.2, -0.4, 0],
      [0.2, -0.4, 1, -0.4, -0.2, -0],
      [-0.4, -0.2, 1, -0.2, 0.4, 0],
      [-0.2, 0.4, 1, 0.4, 0.2, 0],
    ],
  },
  {
    id: 5,
    maps: [
      [0.4, -0.2, 0, 0.2, 0.4, 0],
      [0.2, 0.4, 1, -0.4, 0.2, 0],
      [-0.4, 0.2, 1, -0.2, -0.4, -0],
      [-0.2, -0.4, -1, 0.4, -0.2, 0],
      [0.4, -0.2, -1, 0.2, 0.4, 0],
    ],
  },
  {
    id: 6,
    maps: [
      [0.4, 0.2, 0, 0.2, -0.4, 0],
      [-0.2, 0.4, 1, 0.4, 0.2, 0],
      [0.4, 0.2, 1, 0.2, -0.4, 0],
      [0.2, -0.4, -1, -0.4, -0.2, -0],
      [-0.4, -0.2, -1, -0.2, 0.4, 0],
    ],
  },
  {
    id: 7,
    maps: [
      [0.2, 0.4, 0, -0.4, 0.2, 0],
      [-0.4, 0.2, 1, -0.2, -0.4, -0],
      [-0.2, -0.4, 1, 0.4, -0.2, 0],
      [0.4, -0.2, -1, 0.2, 0.4, 0],
      [0.2, 0.4, -1, -0.4, 0.2, 0],
    ],
  },
  {
    id: 8,
    maps: [
      [0.2, -0.4, 0, -0.4, -0.2, -0],
      [0.4, 0.2, 1, 0.2, -0.4, 0],
      [0.2, -0.4, 1, -0.4, -0.2, -0],
      [-0.4, -0.2, -1, -0.2, 0.4, 0],
      [-0.2, 0.4, -1, 0.4, 0.2, 0],
    ],
  },
  {
    id: 9,
    maps: [
      [0.2, -0.4, 0, 0.4, 0.2, 0],
      [0.4, 0.2, 0.2, -0.2, 0.4, 0.4],
      [-0.2, 0.4, 0.6, -0.4, -0.2, 0.2],
      [0.4, 0.2, 0.4, -0.2, 0.4, -0.2],
      [0.2, -0.4, 0.8, 0.4, 0.2, -0.4],
    ],
  },
  {
    id: 10,
    maps: [
      [-0.2, -0.4, 0.2, -0.4, 0.2, 0.4],
      [-0.4, 0.2, 0.6, 0.2, 0.4, 0.2],
      [0.2, 0.4, 0.4, 0.4, -0.2, -0.2],
      [-0.4, 0.2, 0.8, 0.2, 0.4, -0.4],
      [-0.2, -0.4, 1, -0.4, 0.2, 0],
    ],
  },
  {
    id: 11,
    maps: [
      [-0.2, 0.4, 0.2, -0.4, -0.2, 0.4],
      [0.2, -0.4, 0.2, 0.4, 0.2, 0.4],
      [0.4, 0.2, 0.4, -0.2, 0.4, 0.8],
      [0.2, -0.4, 0.6, 0.4, 0.2, 0.2],
      [0.4, 0.2, 0.6, -0.2, 0.4, 0.2],
    ],
  },
  {
    id: 12,
    maps: [
      [0.2, 0.4, 0, 0.4, -0.2, 0],
      [-0.2, -0.4, 0.4, -0.4, 0.2, 0.8],
      [-0.4, 0.2, 0.8, 0.2, 0.4, 0.6],
      [-0.2, -0.4, 0.8, -0.4, 0.2, 0.6],
      [-0.4, 0.2, 1, 0.2, 0.4, 0],
    ],
  },
  {
    id: 13,
    maps: [
      [0.2, 0.4, 0, 0.4, -0.2, 0],
      [0.4, 0.2, 0.2, -0.2, 0.4, 0.4],
      [-0.2, 0.4, 0.8, -0.4, -0.2, 0.6],
      [-0.4, 0.2, 1.2, 0.2, 0.4, 0.4],
      [0.2, -0.4, 1, 0.4, 0.2, 0],
    ],
  },
  {
    id: 14,
    maps: [
      [0.2, 0.4, 0, 0.4, -0.2, 0],
      [0.4, 0.2, 0.2, -0.2, 0.4, 0.4],
      [0.2, 0.4, 0.6, 0.4, -0.2, 0.2],
      [-0.4, 0.2, 1.2, 0.2, 0.4, 0.4],
      [-0.2, -0.4, 1.2, -0.4, 0.2, 0.4],
    ],
  },
  {
    id: 15,
    maps: [
      [0.2, 0.4, 0, 0.4, -0.2, 0],
      [-0.4, 0.2, 0.6, 0.2, 0.4, 0.2],
      [0.2, 0.4, 0.6, 0.4, -0.2, 0.2],
      [-0.4, 0.2, 1.2, 0.2, 0.4, 0.4],
      [-0.2, -0.4, 1.2, -0.4, 0.2, 0.4],
    ],
  },
  {
    id: 16,
    maps: [
      [-0.2, 0.4, 0.2, -0.4, -0.2, 0.4],
      [0.4, 0.2, 0.2, -0.2, 0.4, 0.4],
      [-0.2, 0.4, 0.8, -0.4, -0.2, 0.6],
      [0.4, 0.2, 0.8, -0.2, 0.4, 0.6],
      [0.2, -0.4, 1, 0.4, 0.2, 0],
    ],
  },
  {
    id: 17,
    maps: [
      [0.2, 0.4, 0, 0.4, -0.2, 0],
      [-0.2, -0.4, 0.4, -0.4, 0.2, 0.8],
      [0.4, -0.2, 0.4, -0.2, -0.4, 0.8],
      [-0.4, 0.2, 1.2, 0.2, 0.4, 0.4],
      [-0.2, -0.4, 1.2, -0.4, 0.2, 0.4],
    ],
  },
  {
    id: 18,
    maps: [
      [0.4, -0.2, 0, -0.2, -0.4, 0],
      [0.2, 0.4, 0.4, 0.4, -0.2, -0.2],
      [-0.2, -0.4, 0.8, -0.4, 0.2, 0.6],
      [-0.4, 0.2, 1.2, 0.2, 0.4, 0.4],
      [0.2, 0.4, 1, 0.4, -0.2, 0],
    ],
  },
  {
    id: 19,
    maps: [
      [0.2, -0.4, 0, 0.4, 0.2, 0],
      [-0.2, 0.4, 0.4, -0.4, -0.2, 0.8],
      [0.4, 0.2, 0.4, -0.2, 0.4, 0.8],
      [-0.4, -0.2, 1.2, 0.2, -0.4, 0.4],
      [-0.2, 0.4, 1.2, -0.4, -0.2, 0.4],
    ],
  },
  {
    id: 20,
    maps: [
      [-0.4, -0.2, 0.4, 0.2, -0.4, -0.2],
      [-0.2, 0.4, 0.6, -0.4, -0.2, 0.2],
      [0.2, -0.4, 0.6, 0.4, 0.2, 0.2],
      [0.4, 0.2, 0.8, -0.2, 0.4, 0.6],
      [-0.2, 0.4, 1.2, -0.4, -0.2, 0.4],
    ],
  },
  {
    id: 21,
    maps: [
      [0.2, -0.4, 0, 0.4, 0.2, 0],
      [-0.4, -0.2, 0.6, 0.2, -0.4, 0.2],
      [0.2, -0.4, 0.6, 0.4, 0.2, 0.2],
      [-0.4, -0.2, 1.2, 0.2, -0.4, 0.4],
      [-0.2, 0.4, 1.2, -0.4, -0.2, 0.4],
    ],
  },
  {
    id: 22,
    maps: [
      [-0.2, -0.4, 0.2, -0.4, 0.2, 0.4],
      [0.4, -0.2, 0.2, -0.2, -0.4, 0.4],
      [-0.2, -0.4, 0.8, -0.4, 0.2, 0.6],
      [0.4, -0.2, 0.8, -0.2, -0.4, 0.6],
      [0.2, 0.4, 1, 0.4, -0.2, 0],
    ],
  },
  {
    id: 23,
    maps: [
      [0.4, -0.2, 0, 0.2, 0.4, 0],
      [0.4, -0.2, 1, 0.2, 0.4, 0],
      [0.2, 0.4, 1, -0.4, 0.2, 0],
      [-0.2, -0.4, 1, 0.4, -0.2, 0],
      [0.4, -0.2, -1, 0.2, 0.4, 0],
    ],
  },
  {
    id: 24,
    maps: [
      [-0.4, 0.2, 0, -0.2, -0.4, -0],
      [0.4, -0.2, 1, 0.2, 0.4, 0],
      [0.2, 0.4, 1, -0.4, 0.2, 0],
      [-0.4, 0.2, 1, -0.2, -0.4, -0],
      [0.2, 0.4, -1, -0.4, 0.2, 0],
    ],
  },
  {
    id: 25,
    maps: [
      [0.4, 0.2, 0, 0.2, -0.4, 0],
      [-0.2, 0.4, -1, 0.4, 0.2, 0],
      [0.4, 0.2, 1, 0.2, -0.4, 0],
      [0.2, -0.4, -1, -0.4, -0.2, -0],
      [-0.4, -0.2, 1, -0.2, 0.4, 0],
    ],
  },
  {
    id: 26,
    maps: [
      [-0.4, -0.2, -0, -0.2, 0.4, 0],
      [-0.2, 0.4, 1, 0.4, 0.2, 0],
      [0.4, 0.2, -1, 0.2, -0.4, 0],
      [0.2, -0.4, 1, -0.4, -0.2, -0],
      [-0.4, -0.2, -1, -0.2, 0.4, 0],
    ],
  },
  {
    id: 27,
    maps: [
      [0.2, 0.4, 0, -0.4, 0.2, 0],
      [0.4, -0.2, 1, 0.2, 0.4, 0],
      [0.2, 0.4, 1, -0.4, 0.2, 0],
      [-0.2, -0.4, 1, 0.4, -0.2, 0],
      [0.4, -0.2, -1, 0.2, 0.4, 0],
    ],
  },
  {
    id: 28,
    maps: [
      [-0.2, -0.4, -0, 0.4, -0.2, 0],
      [-0.4, 0.2, -1, -0.2, -0.4, -0],
      [-0.2, -0.4, -1, 0.4, -0.2, 0],
      [0.2, 0.4, -1, -0.4, 0.2, 0],
      [-0.4, 0.2, 1, -0.2, -0.4, -0],
    ],
  },
  {
    id: 29,
    maps: [
      [-0.2, 0.4, 0, 0.4, 0.2, 0],
      [-0.2, 0.4, 1, 0.4, 0.2, 0],
      [0.4, 0.2, 1, 0.2, -0.4, 0],
      [0.2, -0.4, 1, -0.4, -0.2, -0],
      [-0.4, -0.2, 1, -0.2, 0.4, 0],
    ],
  },
  {
    id: 30,
    maps: [
      [-0.2, 0.4, 0, 0.4, 0.2, 0],
      [-0.4, -0.2, -1, -0.2, 0.4, 0],
      [-0.2, 0.4, -1, 0.4, 0.2, 0],
      [0.2, -0.4, -1, -0.4, -0.2, -0],
      [-0.4, -0.2, 1, -0.2, 0.4, 0],
    ],
  },
  {
    id: 31,
    maps: [
      [-0.2, 0.4, 0, 0.4, 0.2, 0],
      [0.2, -0.4, 1, -0.4, -0.2, -0],
      [-0.4, -0.2, 1, -0.2, 0.4, 0],
      [0.4, 0.2, 1, 0.2, -0.4, 0],
      [-0.4, -0.2, -0, -0.2, 0.4, 1],
    ],
  },
  {
    id: 32,
    maps: [
      [0.4, 0.2, 0, 0.2, -0.4, 0],
      [-0.2, 0.4, 1, 0.4, 0.2, 0],
      [0.4, 0.2, 1, 0.2, -0.4, 0],
      [0.4, 0.2, 0, 0.2, -0.4, 1],
      [0.2, -0.4, 0, -0.4, -0.2, 1],
    ],
  },
  {
    id: 33,
    maps: [
      [-0.2, 0.4, 0, 0.4, 0.2, 0],
      [-0.2, 0.4, 1, 0.4, 0.2, 0],
      [0.4, 0.2, 1, 0.2, -0.4, 0],
      [0.4, 0.2, 0, 0.2, -0.4, 1],
      [0.2, -0.4, 0, -0.4, -0.2, 1],
    ],
  },
  {
    id: 34,
    maps: [
      [-0.2, 0.4, 0, 0.4, 0.2, 0],
      [-0.2, 0.4, 1, 0.4, 0.2, 0],
      [0.4, 0.2, 1, 0.2, -0.4, 0],
      [0.2, -0.4, 1, -0.4, -0.2, -0],
      [0.2, -0.4, 0, -0.4, -0.2, 1],
    ],
  },
  {
    id: 35,
    maps: [
      [-0.2, -0.4, -0, 0.4, -0.2, 0],
      [-0.4, 0.2, 1, -0.2, -0.4, -0],
      [-0.2, -0.4, 1, 0.4, -0.2, 0],
      [0.4, -0.2, 1, 0.2, 0.4, 0],
      [0.2, 0.4, 1, -0.4, 0.2, 0],
    ],
  },
  {
    id: 36,
    maps: [
      [-0.4, 0.2, 0, -0.2, -0.4, -0],
      [-0.2, -0.4, 1, 0.4, -0.2, 0],
      [0.4, -0.2, 1, 0.2, 0.4, 0],
      [0.2, 0.4, 1, -0.4, 0.2, 0],
      [-0.4, 0.2, 1, -0.2, -0.4, -0],
    ],
  },
  {
    id: 37,
    maps: [
      [-0.2, 0.4, 0, 0.4, 0.2, 0],
      [-0.4, -0.2, -1, -0.2, 0.4, 0],
      [-0.2, 0.4, 1, 0.4, 0.2, 0],
      [0.4, 0.2, -1, 0.2, -0.4, 0],
      [0.2, -0.4, 1, -0.4, -0.2, -0],
    ],
  },
  {
    id: 38,
    maps: [
      [0.2, -0.4, 0, -0.4, -0.2, -0],
      [0.2, -0.4, 1, -0.4, -0.2, -0],
      [0.4, 0.2, -1, 0.2, -0.4, 0],
      [-0.2, 0.4, 1, 0.4, 0.2, 0],
      [-0.4, -0.2, -1, -0.2, 0.4, 0],
    ],
  },
  {
    id: 39,
    maps: [
      [-0.2, -0.4, 0.4, -0.4, 0.2, 0.8],
      [0.4, -0.2, 0.2, -0.2, -0.4, 0.4],
      [0.4, -0.2, 1.2, -0.2, -0.4, 0.4],
      [0.4, 0.2, 0.2, -0.2, 0.4, 0.4],
      [-0.4, -0.2, 1.2, 0.2, -0.4, 0.4],
    ],
  },
  {
    id: 40,
    maps: [
      [-0.5, 0.288675134594813, 1.5, -0.288675134594813, -0.5, 0.866025403784439],
      [0.5, -0.288675134594813, 1.5, -0.288675134594813, -0.5, 0.866025403784439],
      [-0.166666666666667, -0.288675134594813, 1.5, 0.288675134594813, -0.166666666666667, 0.866025403784439],
      [0.166666666666667, 0.288675134594813, 1.5, 0.288675134594813, -0.166666666666667, 0.866025403784439],
      [-0.333333333333333, 0, 2, 0, 0.333333333333333, 1.73205080756888],
    ],
    weights: [0.333333333333333, 0.333333333333333, 0.111111111111111, 0.111111111111111, 0.111111111111111],
  },
  {
    id: 41,
    maps: [
      [-0.5, 0.288675134594813, 1.5, 0.288675134594813, 0.5, -0.866025403784439],
      [-0.5, 0.288675134594813, 3, 0.288675134594813, 0.5, 0],
      [-0.166666666666667, -0.288675134594813, 2, 0.288675134594813, -0.166666666666667, 0],
      [0.333333333333333, 0, 1, 0, 0.333333333333333, 0],
      [0.166666666666667, 0.288675134594813, 1, -0.288675134594813, 0.166666666666667, 0],
    ],
    weights: [0.333333333333333, 0.333333333333333, 0.111111111111111, 0.111111111111111, 0.111111111111111],
  },
  {
    id: 42,
    maps: [
      [-0.5, -0.288675134594813, -0, -0.288675134594813, 0.5, 0],
      [-0, -0.577350269189626, -0, -0.577350269189626, 0, 1],
      [-0.166666666666667, 0.288675134594813, 0, -0.288675134594813, -0.166666666666667, 1],
      [-0.333333333333333, 0, 0.577350269189626, 0, -0.333333333333333, 1],
      [0.333333333333333, 0, 0.577350269189626, 0, 0.333333333333333, 1],
    ],
    weights: [0.333333333333333, 0.333333333333333, 0.111111111111111, 0.111111111111111, 0.111111111111111],
  },
  {
    id: 43,
    maps: [
      [0, 0.543689012692076, 0, -0.543689012692076, 0, 0.543689012692076],
      [0, -0.543689012692076, 1, 0.543689012692076, 0, 0],
      [0.543689012692076, 0, 0, 0, 0.543689012692076, 0.543689012692076],
      [0.295597742522085, 0, 0.543689012692076, 0, 0.295597742522085, 0.543689012692076],
      [0.160713244785839, 0, 0.839286755214161, 0, 0.160713244785839, 0.543689012692076],
    ],
    weights: [0.295597742522085, 0.295597742522085, 0.295597742522085, 0.0873780253841527, 0.025828747049593],
  },
];

type AttractorSettings = { specIndex: number; count: number; seed: number; colorCount: number; preset: number; colorSpectral: number };

function clampInt(value: number, min: number, max: number): number {
  const rounded = Math.trunc(Number.isFinite(value) ? value : min);
  return Math.max(min, Math.min(max, rounded));
}

function parseSetting(settings: Settings, key: keyof Settings, fallback: number): number {
  const value = Number.parseFloat(String(settings[key] ?? ''));
  return Number.isFinite(value) ? value : fallback;
}

function attractorSettings(settings: Settings): AttractorSettings {
  const seed = clampInt(parseSetting(settings, 'seed', 0), 0, ORDER_FIVE_IFS.length - 1);
  const level = clampInt(parseSetting(settings, 'generation', 1), 0, ORDER_FIVE_IFS_LEVEL_COUNTS.length - 1);
  const colorCount = clampInt(parseSetting(settings, 'color_count', 5), 1, MAX_COLORS);
  const preset = clampInt(parseSetting(settings, 'preset', 4), 0, MAX_PALETTE_PRESET);
  const colorSpectral = clampInt(parseSetting(settings, 'color_spectral', 0), 0, 100) / 100;
  return {
    specIndex: seed,
    count: ORDER_FIVE_IFS_LEVEL_COUNTS[level] ?? ORDER_FIVE_IFS_LEVEL_COUNTS[0],
    seed: seed + 1,
    colorCount,
    preset,
    colorSpectral,
  };
}

function nextRandom(state: number): number {
  return (Math.imul(state, 1664525) + 1013904223) >>> 0;
}

function mapIndex(spec: OrderFiveIfsSpec, r: number): number {
  const weights = spec.weights;
  if (!weights) return Math.min(4, Math.floor(r * 5));
  let accum = 0;
  for (let i = 0; i < weights.length; i += 1) {
    accum += weights[i] ?? 0;
    if (r <= accum) return i;
  }
  return 4;
}

function paletteLinearColor(settings: AttractorSettings, customColors: Oklch[] | null, map: number): readonly [number, number, number] {
  const palette = buildPalette(settings.preset, Math.max(2, settings.colorCount), customColors, settings.colorSpectral);
  const slot = settings.colorCount <= 1 ? 0 : Math.round(map / 4 * (settings.colorCount - 1));
  const rgb = oklchToLinearSrgb(paletteColorAt(palette.colors, slot));
  return [
    Math.max(0, Math.min(1, rgb[0])),
    Math.max(0, Math.min(1, rgb[1])),
    Math.max(0, Math.min(1, rgb[2])),
  ];
}

export function isOrderFiveIfsSettings(settings: Settings): boolean {
  return String(settings.family) === String(ORDER_FIVE_IFS_FAMILY);
}

export function orderFiveIfsPointCount(settings: Settings): number {
  return attractorSettings(settings).count;
}

export type OrderFiveIfsPoints = {
  positions: Float32Array;
  colors: Float32Array;
};

export function buildOrderFiveIfsPoints(settings: Settings, customColors: Oklch[] | null = null): OrderFiveIfsPoints {
  const resolved = attractorSettings(settings);
  const spec = ORDER_FIVE_IFS[resolved.specIndex]!;
  const positions = new Float32Array(resolved.count * 3);
  const colors = new Float32Array(resolved.count * 3);
  const colorCache = Array.from({ length: 5 }, (_, index) => paletteLinearColor(resolved, customColors, index));
  let x = 0.5;
  let y = 0;
  let state = (0x9e3779b9 ^ Math.imul(resolved.seed, 0x85ebca6b) ^ Math.imul(resolved.count, 0xc2b2ae35)) >>> 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const burnIn = 32;
  for (let i = 0; i < resolved.count + burnIn; i += 1) {
    state = nextRandom(state);
    const selected = mapIndex(spec, state / 0x100000000);
    const map = spec.maps[selected]!;
    const nx = map[0] * x + map[1] * y + map[2];
    const ny = map[3] * x + map[4] * y + map[5];
    x = Number.isFinite(nx) ? nx : 0;
    y = Number.isFinite(ny) ? ny : 0;
    if (i < burnIn) continue;
    const out = i - burnIn;
    const p = out * 3;
    positions[p] = x;
    positions[p + 1] = y;
    positions[p + 2] = 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    const rgb = colorCache[selected]!;
    colors[p] = rgb[0];
    colors[p + 1] = rgb[1];
    colors[p + 2] = rgb[2];
  }
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const span = Math.max(maxX - minX, maxY - minY, 1e-6);
  const scale = 1.8 / span;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = ((positions[i] ?? 0) - cx) * scale;
    positions[i + 1] = ((positions[i + 1] ?? 0) - cy) * scale;
  }
  return { positions, colors };
}
