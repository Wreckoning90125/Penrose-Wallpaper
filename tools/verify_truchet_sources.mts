// Validates the D4 square-weave / Truchet ornament laws against PRODUCTION
// data, not against local re-implementations of themselves:
//
//  1. `D4_MATRICES` (web/src/render/truchetLaws.ts — what the renderer's
//     ornament mask is built from) must be byte-identical to penrose.cpp's
//     `kD4Matrices` (whose index is the wire format: tile.type = state index).
//  2. The matrix table must actually be the dihedral group D4 in canonical
//     form (distinct, orthogonal, det ±1 split 4/4, identity first, closed
//     under composition).
//  3. `D4_DIAGONAL_STATES` (the explicit set the shader selects on) must
//     equal the set derived independently from the matrices: states whose
//     matrix maps the (1,1) direction into a quadrant with x*y < 0.
//  4. The connected-tile construction (Wolfram notebook grid ops) must agree
//     with the parity/transform formulation the shader implements
//     (connectedBit = classBit XOR latticeParity, with per-quadrant UV
//     reflection) — two independent formulations of the same law.
//  5. The bit-select symmetry the shader relies on — negating u swaps the
//     two Truchet variants — must hold for the actual arc/line distance
//     fields.
import { readFileSync } from 'node:fs';
import { D4_MATRICES, D4_DIAGONAL_STATES, type D4Matrix } from '../web/src/render/truchetLaws.ts';

function fail(message: string): never {
  throw new Error(`[truchet-sources] ${message}`);
}

// ---------------------------------------------------------------- 1. C++ parity
const penroseSrc = readFileSync('android/app/src/main/cpp/tiling/penrose.cpp', 'utf8');
const tableMatch = penroseSrc.match(/kD4Matrices = \{\{(?<body>[\s\S]*?)\}\};/);
if (!tableMatch?.groups?.body) {
  fail('anchor kD4Matrices no longer matches penrose.cpp — update this gate, do not let the parity check go vacuous');
}
const cppMatrices: D4Matrix[] = [];
for (const row of tableMatch.groups.body.matchAll(/\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\}/g)) {
  cppMatrices.push([Number(row[1]), Number(row[2]), Number(row[3]), Number(row[4])]);
}
if (cppMatrices.length !== 8) fail(`parsed ${cppMatrices.length} matrices from penrose.cpp kD4Matrices, expected 8`);
if (D4_MATRICES.length !== 8) fail(`truchetLaws D4_MATRICES has ${D4_MATRICES.length} entries, expected 8`);
for (let i = 0; i < 8; i++) {
  const ts = D4_MATRICES[i]!;
  const cpp = cppMatrices[i]!;
  if (ts.some((value, k) => value !== cpp[k])) {
    fail(`D4 matrix ${i} diverges: web ${JSON.stringify(ts)} vs penrose.cpp ${JSON.stringify(cpp)} — the state index is the wire format, these must match`);
  }
}

// -------------------------------------------------------- 2. group structure
type Vec = readonly [number, number];
const apply = (m: D4Matrix, p: Vec): Vec => [m[0] * p[0] + m[1] * p[1], m[2] * p[0] + m[3] * p[1]];
const det = (m: D4Matrix): number => m[0] * m[3] - m[1] * m[2];
const multiply = (l: D4Matrix, r: D4Matrix): D4Matrix => [
  l[0] * r[0] + l[1] * r[2],
  l[0] * r[1] + l[1] * r[3],
  l[2] * r[0] + l[3] * r[2],
  l[2] * r[1] + l[3] * r[3],
];
const key = (m: D4Matrix): string => m.join(',');

if (key(D4_MATRICES[0]!) !== '1,0,0,1') fail('D4 state 0 must be the identity');
const seen = new Set(D4_MATRICES.map(key));
if (seen.size !== 8) fail('D4 matrices are not distinct');
let rotations = 0;
for (const [index, m] of D4_MATRICES.entries()) {
  const d = det(m);
  if (d !== 1 && d !== -1) fail(`D4 matrix ${index} has det ${d}, expected +-1`);
  if (d === 1) rotations += 1;
  // Orthogonality over the integers: unit columns, zero dot product.
  if (m[0] * m[0] + m[2] * m[2] !== 1 || m[1] * m[1] + m[3] * m[3] !== 1 || m[0] * m[1] + m[2] * m[3] !== 0) {
    fail(`D4 matrix ${index} is not orthogonal`);
  }
}
if (rotations !== 4) fail(`expected 4 rotations / 4 reflections, found ${rotations} rotations`);
for (const a of D4_MATRICES) {
  for (const b of D4_MATRICES) {
    if (!seen.has(key(multiply(a, b)))) {
      fail(`D4 table is not closed under composition: ${key(a)} * ${key(b)} = ${key(multiply(a, b))}`);
    }
  }
}

// -------------------------------------- 3. diagonal set derived from matrices
const derivedDiagonal: number[] = [];
for (const [index, m] of D4_MATRICES.entries()) {
  const [x, y] = apply(m, [1, 1]);
  if (x * y < 0) derivedDiagonal.push(index);
}
if (JSON.stringify(derivedDiagonal) !== JSON.stringify([...D4_DIAGONAL_STATES].sort((a, b) => a - b))) {
  fail(`D4_DIAGONAL_STATES ${JSON.stringify(D4_DIAGONAL_STATES)} != matrix-derived diagonal set ${JSON.stringify(derivedDiagonal)}`);
}

// -------------------------- 4. connected-tile law: grid ops vs parity/sample
type Grid = readonly (readonly number[])[];

function inverseReverse(grid: Grid): number[][] {
  return grid.map(row => [...row].reverse().map(value => 1 - value));
}

function mirrorReverse(grid: Grid): number[][] {
  return [...grid].reverse().map(row => [...row].reverse());
}

function connectedTile(grid: Grid): number[][] {
  const topRight = inverseReverse(grid);
  const bottomLeft = [...grid].reverse().map(row => row.map(value => 1 - value));
  const bottomRight = mirrorReverse(grid);
  const rows: number[][] = [];
  for (let y = 0; y < grid.length; y++) rows.push([...grid[y]!, ...topRight[y]!]);
  for (let y = 0; y < grid.length; y++) rows.push([...bottomLeft[y]!, ...bottomRight[y]!]);
  return rows;
}

// The shader's formulation of the same construction: per 2x2-supercell
// quadrant (qx, qy), reflect the local coordinate on each mirrored axis and
// invert the bit iff the quadrant parity differs (connectedBit = classBit XOR
// latticeParity in ornamentMaskNode). If the two formulations ever disagree,
// either the notebook law or the shader law was changed unilaterally.
function connectedTileViaParity(grid: Grid): number[][] {
  const h = grid.length;
  const w = grid[0]!.length;
  const rows: number[][] = [];
  for (let y = 0; y < 2 * h; y++) {
    const row: number[] = [];
    const qy = y >= h ? 1 : 0;
    const ly = qy ? y - h : y;
    for (let x = 0; x < 2 * w; x++) {
      const qx = x >= w ? 1 : 0;
      const lx = qx ? x - w : x;
      const sampleX = qx ? w - 1 - lx : lx;
      const sampleY = qy ? h - 1 - ly : ly;
      const base = grid[sampleY]![sampleX]!;
      row.push((qx ^ qy) === 1 ? 1 - base : base);
    }
    rows.push(row);
  }
  return rows;
}

// Deterministic pseudo-random grids (no Math.random in gates).
function testGrid(width: number, height: number, seed: number): number[][] {
  let state = (seed * 0x9e3779b9) >>> 0;
  const rows: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      row.push(state >>> 31);
    }
    rows.push(row);
  }
  return rows;
}

function sameGrid(a: Grid, b: Grid): boolean {
  return a.length === b.length && a.every((row, y) => row.length === b[y]!.length && row.every((v, x) => v === b[y]![x]));
}

for (const [width, height, seed] of [[1, 1, 1], [3, 2, 2], [4, 4, 3], [5, 3, 4]] as const) {
  const grid = testGrid(width, height, seed);
  const viaGridOps = connectedTile(grid);
  const viaParity = connectedTileViaParity(grid);
  if (!sameGrid(viaGridOps, viaParity)) {
    fail(`connected-tile law mismatch at ${width}x${height} seed ${seed}: notebook grid ops ${JSON.stringify(viaGridOps)} != shader parity/reflect formulation ${JSON.stringify(viaParity)}`);
  }
}

// ------------------- 5. bit-select symmetry of the actual distance fields
// ornamentMaskNode selects variant by bit and separately negates u for the
// notebook "inverse reverse" transform while flipping the bit. That is only
// coherent if u-negation genuinely swaps the two variants of the drawn
// pattern. Check it on the real distance fields (same formulas as the TSL).
function lineDistance(u: number, v: number, bit: number): number {
  return bit < 0.5 ? Math.abs(u - v) * Math.SQRT1_2 : Math.abs(u + v) * Math.SQRT1_2;
}

function quarterArcDistance(u: number, v: number, cx: number, cy: number, signX: number, signY: number): number {
  const dx = u - cx;
  const dy = v - cy;
  if (dx * signX < -0.001 || dy * signY < -0.001) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.hypot(dx, dy) - 0.5);
}

function arcDistance(u: number, v: number, bit: number): number {
  return bit < 0.5
    ? Math.min(quarterArcDistance(u, v, 0.5, 0.5, -1, -1), quarterArcDistance(u, v, -0.5, -0.5, 1, 1))
    : Math.min(quarterArcDistance(u, v, -0.5, 0.5, 1, -1), quarterArcDistance(u, v, 0.5, -0.5, -1, 1));
}

for (let yi = 0; yi <= 20; yi++) {
  for (let xi = 0; xi <= 20; xi++) {
    const u = -0.5 + xi / 20;
    const v = -0.5 + yi / 20;
    if (Math.abs(lineDistance(-u, v, 1) - lineDistance(u, v, 0)) > 1e-12) {
      fail(`line variant swap broken at (${u}, ${v}): negating u must map variant 0 onto variant 1`);
    }
    const swapped = arcDistance(-u, v, 1);
    const original = arcDistance(u, v, 0);
    if (Number.isFinite(swapped) !== Number.isFinite(original)) {
      fail(`arc variant swap broken at (${u}, ${v}): quadrant masks disagree`);
    }
    if (Number.isFinite(swapped) && Number.isFinite(original) && Math.abs(swapped - original) > 1e-12) {
      fail(`arc variant swap broken at (${u}, ${v}): ${swapped} != ${original}`);
    }
  }
}

console.log('[truchet-sources] OK: D4 table matches penrose.cpp, is canonical D4, diagonal states derive from the matrices, and the connected-tile/bit-swap laws hold in both formulations');
