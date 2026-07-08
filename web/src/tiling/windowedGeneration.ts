import type { Patch, Point, Tile, TilingWindow } from '../types';

type WindowBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

const PHI = 1.6180339887498949;
const PSI = 1 / PHI;
const PSI2 = PSI * PSI;
const HALF_SQRT3 = 0.8660254037844386;

const WINDOWED_GENERATION_FAMILIES = new Set<number>([0, 1, 2, 3, 4, 5, 6, 8, 10, 13]);

// de Bruijn multigrid families (native parity): natural one-step inflation factor
// and per-family generation cap (mirrors kFamilyInfo maxGen in penrose.cpp).
const MG_AMMANN_INFLATION = 1 + Math.SQRT2;              // 1 + sqrt(2)  (silver ratio)
const MG_DODECA_INFLATION = Math.sqrt(2 + Math.sqrt(3)); // sqrt(2 + sqrt(3))
const MG_HEPTAGON_INFLATION = 2 * Math.cos(Math.PI / 7); // 2 cos(pi/7)
const MG_DODECA_MAXGEN = 6;
const MG_AMMANN_MAXGEN = 4;
const MG_HEPTAGON_MAXGEN = 7;
// Crop radius of the generation-0 patch; grows by the inflation factor per generation.
const MG_BASE_RADIUS = 1.6;
const CHAIR_X = [0, 2, 2, 1, 1, 0];
const CHAIR_Y = [0, 0, 1, 1, 2, 2];
const CHAIR_RULES = [
  { lox: 0, loy: 0, orient: 0 },
  { lox: 0, loy: 2, orient: 3 },
  { lox: 0.5, loy: 0.5, orient: 0 },
  { lox: 2, loy: 0, orient: 1 },
];
const PIN_CHILDREN = [
  { s: [-2, 1], l: [0, 1], m: [0, 0] },
  { s: [2, 1], l: [0, 1], m: [0, 0] },
  { s: [0, 0], l: [2, 0], m: [2, 1] },
  { s: [0, 0], l: [2, 0], m: [2, -1] },
  { s: [2, -1], l: [2, 1], m: [3, 1] },
];
type DanzerChild = {
  type: number;
  s: [number, number, number];
  d: [number, number, number];
};

const RHO = 2 * Math.cos(Math.PI / 7);
const SIGMA = Math.sin(3 * Math.PI / 7) / Math.sin(Math.PI / 7);
const DANZER_A = 1 / (RHO * RHO);
const DANZER_B = 1 - DANZER_A;
const DANZER_C = RHO / (RHO + SIGMA);
const DANZER_E = SIGMA / (RHO + SIGMA);
const DANZER_RULES: DanzerChild[][] = [
  [
    { type: 0, s: [0, 0, DANZER_A], d: [1, 0, 0] },
    { type: 1, s: [1, DANZER_A, 0], d: [0, 0, 1] },
  ],
  [
    { type: 1, s: [0, 0, DANZER_C], d: [0, DANZER_B, 0] },
    { type: 0, s: [DANZER_C, 0, 0], d: [0, 1, DANZER_B] },
    { type: 2, s: [DANZER_C, 1, 0], d: [0, 0, 1] },
  ],
  [
    { type: 2, s: [0, 0, DANZER_C], d: [DANZER_B, 0, 0] },
    { type: 2, s: [DANZER_B, 0, DANZER_C], d: [DANZER_A, DANZER_B, 0] },
    { type: 1, s: [DANZER_C, 1, DANZER_B], d: [0, 0, DANZER_A] },
    { type: 3, s: [DANZER_B, 0, 0], d: [DANZER_A, 1, DANZER_B] },
  ],
  [
    { type: 1, s: [0, 0, DANZER_C], d: [0, DANZER_E, 0] },
    { type: 3, s: [1, 0, DANZER_C], d: [0, DANZER_E, 0] },
    { type: 2, s: [0, 1, 0], d: [DANZER_E, 0, 1] },
  ],
];

export function supportsWindowedPatchGeneration(family: number): boolean {
  return WINDOWED_GENERATION_FAMILIES.has(family);
}

export function windowedPatchKey(window: TilingWindow | null): string {
  if (!window) return 'full';
  const basis = Math.max(Math.min(window.halfWidth, window.halfHeight), 1e-3);
  const centerStep = Math.max(basis * 0.08, 0.01);
  const sizeStep = Math.max(basis * 0.04, 0.005);
  const q = (value: number, step: number): string => String(Math.round(value / step));
  return `${q(window.centerX, centerStep)},${q(window.centerY, centerStep)},${q(window.halfWidth, sizeStep)},${q(window.halfHeight, sizeStep)}`;
}

export function generateWindowedPatch(family: number, seed: number, generation: number, window: TilingWindow): Patch | null {
  if (!supportsWindowedPatchGeneration(family)) return null;
  const bounds = boundsForWindow(window);
  const cap = Math.max(0, Math.floor(generation));
  if (family === 0) {
    // P3 rhombi: Robinson-triangle equal-edge deflation (GS87), composed base-base into rhombs.
    let tiles = seedGoldenTriangles(seed, 3);
    for (let g = 0; g < cap; g++) {
      tiles = subdivideGoldenTriangles(tiles);
      tiles = pruneTilesForBounds(tiles, bounds);
    }
    return { family, seed, generation: cap, tiles: finalizeGoldenTriangles(tiles) };
  }
  if (family === 1) {
    // P2 kites/darts: the "Penrose Tiles" notebook deflation, composed leg-leg. No
    // finalize — these tiles are already in renderer convention (apex at vert 1,
    // base at edge 2, acute = type 1).
    let tiles = seedKiteDart(seed);
    for (let g = 0; g < cap; g++) {
      tiles = subdivideKiteDart(tiles);
      tiles = pruneTilesForBounds(tiles, bounds);
    }
    return { family, seed, generation: cap, tiles };
  }
  if (family === 3) {
    const g = Math.min(cap, MG_DODECA_MAXGEN);
    return { family, seed, generation: g, tiles: generateMultigrid(6, seed, g, MG_DODECA_INFLATION) };
  }
  if (family === 5) {
    const g = Math.min(cap, MG_AMMANN_MAXGEN);
    return { family, seed, generation: g, tiles: generateMultigrid(4, seed, g, MG_AMMANN_INFLATION) };
  }
  if (family === 6) {
    const g = Math.min(cap, MG_HEPTAGON_MAXGEN);
    return { family, seed, generation: g, tiles: generateMultigrid(7, seed, g, MG_HEPTAGON_INFLATION) };
  }
  if (family === 2) {
    let tiles = seedChair(seed);
    for (let g = 0; g < cap; g++) {
      tiles = subdivideChair(tiles);
      tiles = pruneTilesForBounds(tiles, bounds);
    }
    return { family, seed, generation: cap, tiles };
  }
  if (family === 4) {
    let tiles = seedPinwheel(seed);
    for (let g = 0; g < cap; g++) {
      tiles = subdividePinwheel(tiles);
      tiles = pruneTilesForBounds(tiles, bounds);
    }
    return { family, seed, generation: cap, tiles };
  }
  if (family === 8) {
    let tiles = seedTuebingen(seed);
    for (let g = 0; g < cap; g++) {
      tiles = subdivideTuebingen(tiles);
      tiles = pruneTilesForBounds(tiles, bounds);
    }
    return { family, seed, generation: cap, tiles };
  }
  if (family === 10) {
    let tiles = seedDanzer(seed);
    for (let g = 0; g < cap; g++) {
      tiles = subdivideDanzer(tiles);
      tiles = pruneTilesForBounds(tiles, bounds);
    }
    return { family, seed, generation: cap, tiles };
  }
  if (family === 13) {
    let tiles = seedEquithirds(seed);
    for (let g = 0; g < cap; g++) {
      tiles = subdivideEquithirds(tiles);
      tiles = pruneTilesForBounds(tiles, bounds);
    }
    return { family, seed, generation: cap, tiles };
  }
  return null;
}

function boundsForWindow(window: TilingWindow): WindowBounds {
  return {
    minX: window.centerX - window.halfWidth,
    maxX: window.centerX + window.halfWidth,
    minY: window.centerY - window.halfHeight,
    maxY: window.centerY + window.halfHeight,
  };
}

function makePoint(x: number, y: number): Point {
  const point: Point = [x, y];
  return point;
}

function makeTriangle(type: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): Tile {
  return {
    type,
    verts: [
      makePoint(ax, ay),
      makePoint(bx, by),
      makePoint(cx, cy),
    ],
  };
}

function makePolygon(type: number, verts: Point[]): Tile {
  return { type, verts };
}

function combine(ax: number, ay: number, a: number, bx: number, by: number, b: number): Point {
  return makePoint(a * ax + b * bx, a * ay + b * by);
}

// de Bruijn N-grid dualization, faithful port of generateMultigrid() in
// penrose.cpp: the dual of N line grids (spaced pi/N) is a rhombic tiling with
// 2N-fold symmetry. One generation = one true inflation — the half-range grows by
// `inflation` per generation from the minimal rosette (B = 2). seedIdx 0 is the
// symmetric rosette; 1-2 are quasiperiodic phase shifts.
function generateMultigrid(gridCount: number, seedIdx: number, generations: number, inflation: number): Tile[] {
  const N = gridCount < 2 ? 2 : gridCount;
  const dirx: number[] = [];
  const diry: number[] = [];
  for (let k = 0; k < N; k++) {
    const ang = Math.PI * k / N;
    dirx.push(Math.cos(ang));
    diry.push(Math.sin(ang));
  }
  const si = seedIdx >= 0 && seedIdx < 3 ? seedIdx : 0;
  const gamma: number[] = [];
  if (si === 0) {
    for (let k = 0; k < N; k++) gamma.push(0.5);
  } else {
    const phase = [0.1701, 0.4327];
    const base = 0.5 + phase[si - 1]!;
    for (let k = 0; k < N; k++) gamma.push((base + k * 0.4142135623730951) % 1.0);
  }
  const gen = generations < 0 ? 0 : generations;
  // Crop radius grows by one true inflation per generation from the minimal rosette
  // (grown directly, not through the integer grid half-range, so gen 1 stays small).
  const keepLin = MG_BASE_RADIUS * Math.pow(inflation, gen);
  const keepR2 = keepLin * keepLin;
  let B = Math.ceil(2 * keepLin / N) + 1;
  if (B < 2) B = 2;
  const shiftx = si === 0 ? 1.0 : 0.0;
  const shifty = si === 0 ? 1.0 / Math.tan(Math.PI / (2 * N)) : 0.0;
  const out: Tile[] = [];
  let maxR2 = 0;
  for (let j = 0; j < N; j++) {
    for (let k = j + 1; k < N; k++) {
      const det = dirx[j]! * diry[k]! - diry[j]! * dirx[k]!;
      const d = k - j;
      const shape = d < N - d ? d : N - d;
      const type = shape - 1;
      for (let r = -B; r <= B; r++) {
        const a = r + gamma[j]!;
        for (let s = -B; s <= B; s++) {
          const b = s + gamma[k]!;
          const px = (a * diry[k]! - b * diry[j]!) / det;
          const py = (b * dirx[j]! - a * dirx[k]!) / det;
          let basex = 0;
          let basey = 0;
          for (let l = 0; l < N; l++) {
            if (l === j || l === k) continue;
            const t = px * dirx[l]! + py * diry[l]! - gamma[l]!;
            const kl = Math.floor(t + 1e-9);
            basex += kl * dirx[l]!;
            basey += kl * diry[l]!;
          }
          const v0x = basex + (r - 1) * dirx[j]! + (s - 1) * dirx[k]! + shiftx;
          const v0y = basey + (r - 1) * diry[j]! + (s - 1) * diry[k]! + shifty;
          const cx = [v0x, v0x + dirx[j]!, v0x + dirx[j]! + dirx[k]!, v0x + dirx[k]!];
          const cy = [v0y, v0y + diry[j]!, v0y + diry[j]! + diry[k]!, v0y + diry[k]!];
          const centx = (cx[0]! + cx[1]! + cx[2]! + cx[3]!) * 0.25;
          const centy = (cy[0]! + cy[1]! + cy[2]! + cy[3]!) * 0.25;
          if (centx * centx + centy * centy > keepR2) continue;
          const verts: Point[] = [];
          for (let c = 0; c < 4; c++) {
            verts.push(makePoint(cx[c]!, cy[c]!));
            const rr = cx[c]! * cx[c]! + cy[c]! * cy[c]!;
            if (rr > maxR2) maxR2 = rr;
          }
          out.push(makePolygon(type, verts));
        }
      }
    }
  }
  if (maxR2 > 1e-12) {
    const inv = 1.0 / Math.sqrt(maxR2);
    for (const tile of out) {
      for (const v of tile.verts) {
        v[0] *= inv;
        v[1] *= inv;
      }
    }
  }
  return out;
}

// Penrose P3 (rhomb) deflation: the Robinson-triangle substitution MLD to the Penrose
// Rhomb tiling (Grünbaum & Shephard [GS87]; inflation phi). Both half-triangles keep
// legs = rhombus edge every generation, so two same-type triangles sharing their base
// reconstitute a rhomb. Worked internally in role order (verts [A(apex), B, C], `type`
// = colour 0 acute / 1 obtuse); finalizeGoldenTriangles() reorders to the renderer
// convention (base at edge index 2, type acute = 1 / obtuse = 0). This is the P3
// rhomb substitution only; P2 kites/darts use the distinct notebook rule below.
// Ten acute (colour 0) Robinson triangles meeting apex-first at the origin — a legal
// fivefold P3 centre — alternating winding so the disk tiles edge-to-edge; `twist`
// rotates the whole rosette.
function goldenTriangleSun(twist: number): Tile[] {
  const out: Tile[] = [];
  for (let i = 0; i < 10; i++) {
    const a1 = 2 * Math.PI * i / 10 + twist;
    const a2 = 2 * Math.PI * (i + 1) / 10 + twist;
    let bx = Math.cos(a1);
    let by = Math.sin(a1);
    let cx = Math.cos(a2);
    let cy = Math.sin(a2);
    if ((i & 1) === 0) {
      const tx = bx;
      const ty = by;
      bx = cx;
      by = cy;
      cx = tx;
      cy = ty;
    }
    out.push(makeTriangle(0, 0, 0, bx, by, cx, cy));
  }
  return out;
}

// P3 seeds are distinct all-acute (Robinson) framings; the rhomb obtuse rule expects
// children in a specific role order that hand-built obtuse seeds do not carry, so each
// seed is an acute patch that deflates cleanly. Mirrors the native seedP3.
function seedGoldenTriangles(seed: number, maxSeed: number): Tile[] {
  const selected = seed < 0 || seed > maxSeed ? 0 : seed;
  if (selected === 1) {
    // Star: decagon fan, apex at origin, each direction a +/- pair (non-alternating).
    const out: Tile[] = [];
    for (let i = 0; i < 5; i++) {
      const a0 = 2 * Math.PI * i / 5;
      const ap = a0 + Math.PI / 5;
      const am = a0 - Math.PI / 5;
      const ax = Math.cos(a0);
      const ay = Math.sin(a0);
      out.push(makeTriangle(0, 0, 0, ax, ay, Math.cos(ap), Math.sin(ap)));
      out.push(makeTriangle(0, 0, 0, ax, ay, Math.cos(am), Math.sin(am)));
    }
    return out;
  }
  if (selected === 3) {
    // Ace: two acute triangles, apexes at origin, legs = phi.
    const acute = (ang: number): Tile => makeTriangle(
      0, 0, 0,
      PHI * Math.cos(ang - Math.PI / 10), PHI * Math.sin(ang - Math.PI / 10),
      PHI * Math.cos(ang + Math.PI / 10), PHI * Math.sin(ang + Math.PI / 10),
    );
    return [acute(Math.PI / 2 - Math.PI / 10), acute(Math.PI / 2 + Math.PI / 10)];
  }
  // Sun (0) and Cartwheel (2): rosette, Cartwheel rotated by pi/10.
  return goldenTriangleSun(selected === 2 ? Math.PI / 10 : 0);
}

function subdivideGoldenTriangles(tiles: Tile[]): Tile[] {
  const out: Tile[] = [];
  for (const tile of tiles) {
    const a = tile.verts[0];
    const b = tile.verts[1];
    const c = tile.verts[2];
    if (!a || !b || !c) continue;
    if (tile.type === 0) {
      // acute (colour 0): cut P on leg A->B at 1/phi from the apex A. Children:
      // one acute + one obtuse, both with legs = parent leg / phi.
      const p = combine(a[0], a[1], PSI2, b[0], b[1], PSI);
      out.push(makeTriangle(0, c[0], c[1], p[0], p[1], b[0], b[1]));
      out.push(makeTriangle(1, p[0], p[1], c[0], c[1], a[0], a[1]));
    } else {
      // obtuse (colour 1): cut Q on B->A and R on B->C, each at 1/phi from B.
      // Children: one acute + two obtuse, all with legs = parent leg / phi.
      const q = combine(b[0], b[1], PSI2, a[0], a[1], PSI);
      const r = combine(b[0], b[1], PSI2, c[0], c[1], PSI);
      out.push(makeTriangle(1, r[0], r[1], c[0], c[1], a[0], a[1]));
      out.push(makeTriangle(1, q[0], q[1], r[0], r[1], b[0], b[1]));
      out.push(makeTriangle(0, r[0], r[1], q[0], q[1], a[0], a[1]));
    }
  }
  return out;
}

// P2 seeds in the notebook convention (type 1 = acute a[], apex at the origin
// vertex): Sun = ten acute apex-first at the centre; Star = a five-point star of
// obtuse triangles. Matches subdivideKiteDart below and the native seedP2.
function seedKiteDart(seed: number): Tile[] {
  const out: Tile[] = [];
  if (seed === 1) {
    for (let i = 0; i < 5; i++) {
      const a0 = 2 * Math.PI * i / 5;
      const ap = a0 + Math.PI / 5;
      const am = a0 - Math.PI / 5;
      const yx = Math.cos(a0);
      const yy = Math.sin(a0);
      out.push(makeTriangle(0, 0, 0, yx, yy, PHI * Math.cos(ap), PHI * Math.sin(ap)));
      out.push(makeTriangle(0, 0, 0, yx, yy, PHI * Math.cos(am), PHI * Math.sin(am)));
    }
    return out;
  }
  for (let i = 0; i < 5; i++) {
    const a0 = 2 * Math.PI * i / 5;
    const ap = a0 + Math.PI / 5;
    const am = a0 - Math.PI / 5;
    const ax = Math.cos(a0);
    const ay = Math.sin(a0);
    out.push(makeTriangle(1, ax, ay, 0, 0, Math.cos(ap), Math.sin(ap)));
    out.push(makeTriangle(1, ax, ay, 0, 0, Math.cos(am), Math.sin(am)));
  }
  return out;
}

// P2 kite/dart deflation: "Penrose Tiles" notebook Deflate (c1 = PSI = 1/phi,
// c2 = PSI2 = 1/phi^2; type 1 = acute a[], type 0 = obtuse o[]). Distinct from the
// P3 rhomb rule above; children pair leg-leg into whole kites and darts.
function subdivideKiteDart(tiles: Tile[]): Tile[] {
  const out: Tile[] = [];
  for (const tile of tiles) {
    const x = tile.verts[0];
    const y = tile.verts[1];
    const z = tile.verts[2];
    if (!x || !y || !z) continue;
    if (tile.type === 1) {
      // acute a[x,y,z] -> a[d,z,x], a[d,z,e], o[y,e,d]
      const d = combine(x[0], x[1], PSI, y[0], y[1], PSI2);
      const e = combine(y[0], y[1], PSI, z[0], z[1], PSI2);
      out.push(makeTriangle(1, d[0], d[1], z[0], z[1], x[0], x[1]));
      out.push(makeTriangle(1, d[0], d[1], z[0], z[1], e[0], e[1]));
      out.push(makeTriangle(0, y[0], y[1], e[0], e[1], d[0], d[1]));
    } else {
      // obtuse o[x,y,z] -> o[z,d,y], a[y,x,d]
      const d = combine(x[0], x[1], PSI2, z[0], z[1], PSI);
      out.push(makeTriangle(0, z[0], z[1], d[0], d[1], y[0], y[1]));
      out.push(makeTriangle(1, y[0], y[1], x[0], x[1], d[0], d[1]));
    }
  }
  return out;
}

// Reorder internal (Robinson-triangle role) golden triangles to the renderer
// convention: verts = [baseVertex, apex, baseVertex] so the base (the odd edge; the
// two equal edges are the legs) sits at edge index 2 (verts[2]->verts[0]), and map
// the internal colour to the renderer type (acute = 1, obtuse = 0).
function finalizeGoldenTriangles(tiles: Tile[]): Tile[] {
  const out: Tile[] = [];
  for (const tile of tiles) {
    const a = tile.verts[0];
    const b = tile.verts[1];
    const c = tile.verts[2];
    if (!a || !b || !c) continue;
    const eab = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const ebc = Math.hypot(b[0] - c[0], b[1] - c[1]);
    const eca = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const type = tile.type === 0 ? 1 : 0;
    const dAbBc = Math.abs(eab - ebc);
    const dBcCa = Math.abs(ebc - eca);
    const dCaAb = Math.abs(eca - eab);
    if (dAbBc <= dBcCa && dAbBc <= dCaAb) {
      // legs AB & BC equal -> apex B, base CA
      out.push(makePolygon(type, [c, b, a]));
    } else if (dBcCa <= dCaAb) {
      // legs BC & CA equal -> apex C, base AB
      out.push(makePolygon(type, [a, c, b]));
    } else {
      // legs CA & AB equal -> apex A, base BC
      out.push(makePolygon(type, [b, a, c]));
    }
  }
  return out;
}

function seedEquithirds(seed: number): Tile[] {
  if (seed === 1) {
    return [
      makeTriangle(1, -HALF_SQRT3, -1 / 6, HALF_SQRT3, -1 / 6, 0, 1 / 3),
    ];
  }
  return [
    makeTriangle(0, -0.5, -HALF_SQRT3 / 3, 0.5, -HALF_SQRT3 / 3, 0, 2 * HALF_SQRT3 / 3),
  ];
}

function rotateInt(px: number, py: number, orient: number): Point {
  const normalized = ((orient % 4) + 4) % 4;
  if (normalized === 0) return makePoint(px, py);
  if (normalized === 1) return makePoint(-py, px);
  if (normalized === 2) return makePoint(-px, -py);
  return makePoint(py, -px);
}

function chairTile(ox: number, oy: number, orient: number, scale: number): Tile {
  const verts: Point[] = [];
  for (let i = 0; i < CHAIR_X.length; i++) {
    const rx = CHAIR_X[i] ?? 0;
    const ry = CHAIR_Y[i] ?? 0;
    const p = rotateInt(rx, ry, orient);
    verts.push(makePoint(ox + scale * p[0], oy + scale * p[1]));
  }
  return makePolygon(((orient % 4) + 4) % 4, verts);
}

function seedChair(seed: number): Tile[] {
  const selected = seed < 0 || seed > 2 ? 0 : seed;
  if (selected === 1) {
    const scale = 0.45;
    return [
      chairTile(-scale, -1.5 * scale, 0, scale),
      chairTile(scale, 1.5 * scale, 2, scale),
    ];
  }
  if (selected === 2) {
    const scale = 0.35;
    return [
      chairTile(-2 * scale, -1.5 * scale, 0, scale),
      chairTile(0, 1.5 * scale, 2, scale),
      chairTile(0, -1.5 * scale, 0, scale),
      chairTile(2 * scale, 1.5 * scale, 2, scale),
    ];
  }
  const scale = 0.225;
  return [
    chairTile(-2 * scale, -2 * scale, 0, scale),
    chairTile(-2 * scale, 2 * scale, 3, scale),
    chairTile(2 * scale, -2 * scale, 1, scale),
    chairTile(2 * scale, 2 * scale, 2, scale),
  ];
}

function subdivideChair(tiles: Tile[]): Tile[] {
  const out: Tile[] = [];
  for (const tile of tiles) {
    const p0 = tile.verts[0];
    const p1 = tile.verts[1];
    if (!p0 || !p1) continue;
    const parentOrient = tile.type & 3;
    const parentScale = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * 0.5;
    const childScale = parentScale * 0.5;
    for (const rule of CHAIR_RULES) {
      const offset = rotateInt(rule.lox, rule.loy, parentOrient);
      const childOrient = ((rule.orient + parentOrient) % 4 + 4) % 4;
      out.push(chairTile(
        p0[0] + parentScale * offset[0],
        p0[1] + parentScale * offset[1],
        childOrient,
        childScale,
      ));
    }
  }
  return out;
}

function makePin(sx: number, sy: number, lx: number, ly: number, mx: number, my: number): Tile {
  return makeTriangle(0, sx, sy, lx, ly, mx, my);
}

function seedPinwheel(seed: number): Tile[] {
  const selected = seed < 0 || seed > 2 ? 0 : seed;
  const out: Tile[] = [];
  const rect = (lox: number, loy: number, width: number): void => {
    const height = width * 0.5;
    out.push(makePin(lox, loy, lox + width, loy, lox + width, loy + height));
    out.push(makePin(lox + width, loy + height, lox, loy + height, lox, loy));
  };
  if (selected === 1) {
    out.push(makePin(-0.8, -0.4, 0.8, -0.4, 0.8, 0.4));
    return out;
  }
  if (selected === 2) {
    rect(-0.8, -0.4, 1.6);
    return out;
  }
  rect(-0.8, 0, 1.6);
  rect(-0.8, -0.8, 1.6);
  return out;
}

function subdividePinwheel(tiles: Tile[]): Tile[] {
  const out: Tile[] = [];
  for (const tile of tiles) {
    const small = tile.verts[0];
    const large = tile.verts[1];
    const mid = tile.verts[2];
    if (!small || !large || !mid) continue;
    const ux = large[0] - small[0];
    const uy = large[1] - small[1];
    const wx = mid[0] - small[0];
    const wy = mid[1] - small[1];
    const c1x = wx * 0.2;
    const c1y = wy * 0.2;
    const c2x = wx * 0.4 - ux * 0.5;
    const c2y = wy * 0.4 - uy * 0.5;
    for (const child of PIN_CHILDREN) {
      const corners = [child.s, child.l, child.m];
      const points: Point[] = [];
      for (const corner of corners) {
        const a = (corner[0] ?? 0) + 2;
        const b = (corner[1] ?? 0) - 1;
        points.push(makePoint(small[0] + a * c1x + b * c2x, small[1] + a * c1y + b * c2y));
      }
      const p0 = points[0];
      const p1 = points[1];
      const p2 = points[2];
      if (p0 && p1 && p2) out.push(makePin(p0[0], p0[1], p1[0], p1[1], p2[0], p2[1]));
    }
  }
  return out;
}

function framePoint(origin: Point, u: Point, w: Point, s: number, d: number): Point {
  return makePoint(origin[0] + s * u[0] + d * w[0], origin[1] + s * u[1] + d * w[1]);
}

function seedTuebingen(seed: number): Tile[] {
  if (seed === 1) {
    const height = Math.sqrt(PHI * PHI - 0.25);
    return [makeTriangle(1, 0, height, -0.5, 0, 0.5, 0)];
  }
  const out: Tile[] = [];
  for (let i = 0; i < 10; i++) {
    const a1 = 2 * Math.PI * i / 10;
    const a2 = 2 * Math.PI * (i + 1) / 10;
    const p1x = Math.cos(a1);
    const p1y = Math.sin(a1);
    const p2x = Math.cos(a2);
    const p2y = Math.sin(a2);
    if ((i & 1) === 1) out.push(makeTriangle(1, 0, 0, p2x, p2y, p1x, p1y));
    else out.push(makeTriangle(1, 0, 0, p1x, p1y, p2x, p2y));
  }
  return out;
}

function subdivideTuebingen(tiles: Tile[]): Tile[] {
  const out: Tile[] = [];
  for (const tile of tiles) {
    const p0 = tile.verts[0];
    const p1 = tile.verts[1];
    const p2 = tile.verts[2];
    if (!p0 || !p1 || !p2) continue;
    const u = makePoint(p1[0] - p0[0], p1[1] - p0[1]);
    const w = makePoint(p2[0] - p0[0], p2[1] - p0[1]);
    if (tile.type === 1) {
      const d = framePoint(p0, u, w, PSI, 0);
      const e = framePoint(p0, u, w, 0, PSI);
      out.push(makeTriangle(1, p0[0], p0[1], d[0], d[1], e[0], e[1]));
      out.push(makeTriangle(1, p2[0], p2[1], d[0], d[1], p1[0], p1[1]));
      out.push(makeTriangle(0, e[0], e[1], d[0], d[1], p2[0], p2[1]));
    } else {
      const foot = framePoint(p0, u, w, PSI, PSI2);
      out.push(makeTriangle(0, foot[0], foot[1], p0[0], p0[1], p1[0], p1[1]));
      out.push(makeTriangle(1, p2[0], p2[1], p0[0], p0[1], foot[0], foot[1]));
    }
  }
  return out;
}

function seedDanzer(seed: number): Tile[] {
  if (seed === 1) {
    const height = Math.sqrt(RHO * RHO - SIGMA * SIGMA * 0.25);
    const cx = (SIGMA + SIGMA * 0.5) / 3;
    const cy = height / 3;
    const scale = 0.62;
    const x = (value: number): number => (value - cx) * scale;
    const y = (value: number): number => (value - cy) * scale;
    return [
      makeTriangle(2, x(0), y(0), x(SIGMA), y(0), x(SIGMA * 0.5), y(height)),
    ];
  }
  const out: Tile[] = [];
  for (let i = 0; i < 14; i++) {
    const a1 = Math.PI * i / 7;
    const a2 = Math.PI * (i + 1) / 7;
    out.push(makeTriangle(3, 0, 0, Math.cos(a1), Math.sin(a1), Math.cos(a2), Math.sin(a2)));
  }
  return out;
}

function subdivideDanzer(tiles: Tile[]): Tile[] {
  const out: Tile[] = [];
  for (const tile of tiles) {
    const p0 = tile.verts[0];
    const p1 = tile.verts[1];
    const p2 = tile.verts[2];
    if (!p0 || !p1 || !p2) continue;
    const u = makePoint(p1[0] - p0[0], p1[1] - p0[1]);
    const w = makePoint(p2[0] - p0[0], p2[1] - p0[1]);
    const rules = DANZER_RULES[tile.type & 3] ?? [];
    for (const rule of rules) {
      const a = framePoint(p0, u, w, rule.s[0], rule.d[0]);
      const b = framePoint(p0, u, w, rule.s[1], rule.d[1]);
      const c = framePoint(p0, u, w, rule.s[2], rule.d[2]);
      out.push(makeTriangle(rule.type, a[0], a[1], b[0], b[1], c[0], c[1]));
    }
  }
  return out;
}

function subdivideEquithirds(tiles: Tile[]): Tile[] {
  const out: Tile[] = [];
  for (const tile of tiles) {
    const p0 = tile.verts[0];
    const p1 = tile.verts[1];
    const p2 = tile.verts[2];
    if (!p0 || !p1 || !p2) continue;
    if (tile.type === 0) {
      const cx = (p0[0] + p1[0] + p2[0]) / 3;
      const cy = (p0[1] + p1[1] + p2[1]) / 3;
      out.push(makeTriangle(1, p0[0], p0[1], p1[0], p1[1], cx, cy));
      out.push(makeTriangle(1, p1[0], p1[1], p2[0], p2[1], cx, cy));
      out.push(makeTriangle(1, p2[0], p2[1], p0[0], p0[1], cx, cy));
      continue;
    }
    const mx = (p0[0] + p1[0]) * 0.5;
    const my = (p0[1] + p1[1]) * 0.5;
    const sx = (p1[0] - p0[0]) / 6;
    const sy = (p1[1] - p0[1]) / 6;
    const b1x = mx - sx;
    const b1y = my - sy;
    const b2x = mx + sx;
    const b2y = my + sy;
    out.push(makeTriangle(1, p0[0], p0[1], p2[0], p2[1], b1x, b1y));
    out.push(makeTriangle(0, b1x, b1y, b2x, b2y, p2[0], p2[1]));
    out.push(makeTriangle(1, p2[0], p2[1], p1[0], p1[1], b2x, b2y));
  }
  return out;
}

function tileIntersectsBounds(tile: Tile, bounds: WindowBounds, margin: number): boolean {
  const first = tile.verts[0];
  if (!first) return false;
  let minX = first[0];
  let maxX = first[0];
  let minY = first[1];
  let maxY = first[1];
  for (let i = 1; i < tile.verts.length; i++) {
    const p = tile.verts[i];
    if (!p) continue;
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  return maxX >= bounds.minX - margin
    && minX <= bounds.maxX + margin
    && maxY >= bounds.minY - margin
    && minY <= bounds.maxY + margin;
}

function pruneTilesForBounds(tiles: Tile[], bounds: WindowBounds): Tile[] {
  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-3);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1e-3);
  const margin = Math.max(0.08, Math.max(spanX, spanY) * 0.18);
  const kept = tiles.filter(tile => tileIntersectsBounds(tile, bounds, margin));
  return kept.length > 0 ? kept : tiles;
}
