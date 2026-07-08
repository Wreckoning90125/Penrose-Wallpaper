import { DEFAULT_SETTINGS, normalizeSettings } from '../web/src/settings/androidSettings.ts';
import {
  buildOrderFiveIfsPoints,
  ORDER_FIVE_IFS_FAMILY,
  ORDER_FIVE_IFS_LEVEL_COUNTS,
} from '../web/src/tiling/orderFiveIfs.ts';

type Case = {
  seed: number;
  generation: number;
  // Golden fingerprint of the deterministic attractor (LCG-seeded): rounded
  // centroid plus per-quadrant point counts. A wrong map table, seed order,
  // weight table, or normalization shifts these; count/range checks alone
  // would not notice.
  centroidX: number;
  centroidY: number;
  quadrants: readonly [number, number, number, number];
};

const CASES: readonly Case[] = [
  { seed: 0, generation: 0, centroidX: 0.052614, centroidY: 0.04384, quadrants: [455, 759, 912, 874] },
  { seed: 0, generation: 4, centroidX: 0.037478, centroidY: 0.03914, quadrants: [48538, 75010, 90965, 85487] },
  { seed: 39, generation: 2, centroidX: -0.001364, centroidY: -0.156027, quadrants: [10114, 10098, 4901, 4887] },
  { seed: 40, generation: 2, centroidX: 0.005665, centroidY: 0.005798, quadrants: [12249, 2510, 2537, 12704] },
  { seed: 41, generation: 2, centroidX: -0.069272, centroidY: 0.05704, quadrants: [8692, 4806, 8832, 7670] },
  { seed: 42, generation: 4, centroidX: -0.07472, centroidY: -0.183192, quadrants: [96614, 97041, 75582, 30763] },
];

const CENTROID_TOLERANCE = 1e-6;

function fail(message: string): never {
  throw new Error(`[order-five-ifs] ${message}`);
}

function finiteArray(label: string, values: Float32Array): void {
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] ?? Number.NaN;
    if (!Number.isFinite(value)) fail(`${label}: non-finite value at ${i}`);
  }
}

for (const item of CASES) {
  const settings = normalizeSettings({
    ...DEFAULT_SETTINGS,
    family: String(ORDER_FIVE_IFS_FAMILY),
    seed: String(item.seed),
    generation: item.generation,
    preset: '4',
    color_count: 5,
    color_spectral: 0,
  });
  const { positions, colors } = buildOrderFiveIfsPoints(settings, null);
  const label = `seed ${item.seed} generation ${item.generation}`;
  const expected = ORDER_FIVE_IFS_LEVEL_COUNTS[item.generation] ?? 0;
  if (positions.length !== expected * 3) fail(`${label}: position length ${positions.length} != ${expected * 3}`);
  if (colors.length !== expected * 3) fail(`${label}: color length ${colors.length} != ${expected * 3}`);
  finiteArray(`${label} positions`, positions);
  finiteArray(`${label} colors`, colors);

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let centroidX = 0;
  let centroidY = 0;
  const quadrants = [0, 0, 0, 0];
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] ?? 0;
    const y = positions[i + 1] ?? 0;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    if (Math.abs(x) > 1.05 || Math.abs(y) > 1.05) fail(`${label}: normalized point outside expected bounds`);
    centroidX += x;
    centroidY += y;
    const quadrant = (x >= 0 ? 1 : 0) + (y >= 0 ? 2 : 0);
    quadrants[quadrant] = (quadrants[quadrant] ?? 0) + 1;
  }
  if (Math.max(maxX - minX, maxY - minY) < 0.5) fail(`${label}: attractor bounds collapsed`);
  centroidX /= expected;
  centroidY /= expected;
  if (Math.abs(centroidX - item.centroidX) > CENTROID_TOLERANCE || Math.abs(centroidY - item.centroidY) > CENTROID_TOLERANCE) {
    fail(`${label}: centroid (${centroidX.toFixed(6)}, ${centroidY.toFixed(6)}) != golden (${item.centroidX}, ${item.centroidY})`);
  }
  for (let q = 0; q < 4; q += 1) {
    if (quadrants[q] !== item.quadrants[q]) {
      fail(`${label}: quadrant counts ${JSON.stringify(quadrants)} != golden ${JSON.stringify(item.quadrants)}`);
    }
  }
  for (let i = 0; i < colors.length; i += 1) {
    const value = colors[i] ?? -1;
    if (value < 0 || value > 1) fail(`${label}: color outside linear range`);
  }
}

console.log(`[order-five-ifs] OK: ${CASES.length} representative notebook systems verified against golden fingerprints`);
