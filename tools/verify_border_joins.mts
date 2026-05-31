// Headless proof of the per-tile border. Each tile strokes its own inset ring, so
// the only things to verify are local to one tile: the ring stays INSIDE the tile
// (→ borders of different tiles can't overlap, since tiles are disjoint), it is a
// single layer (no self-overlap), and it fully covers the band on visible edges (no
// gaps) — including under edge subdivision and on thin/odd tiles. Run:
//   node tools/verify_border_joins.mts
import { buildTileRing, type TileBorder } from '../web/src/tiling/borderJoin.ts';

type P = [number, number];

function triArea(a: P, b: P, c: P): number {
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
}
function sgn(p: P, a: P, b: P): number {
  return (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
}
function inTri(p: P, t: P[]): boolean {
  const d1 = sgn(p, t[0]!, t[1]!);
  const d2 = sgn(p, t[1]!, t[2]!);
  const d3 = sgn(p, t[2]!, t[0]!);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
function ensureCCW(t: P[]): P[] {
  const s = (t[1]![0] - t[0]![0]) * (t[2]![1] - t[0]![1]) - (t[2]![0] - t[0]![0]) * (t[1]![1] - t[0]![1]);
  return s >= 0 ? t : [t[0]!, t[2]!, t[1]!];
}
function segX(p: P, q: P, a: P, b: P): P {
  const d1: P = [q[0] - p[0], q[1] - p[1]];
  const d2: P = [b[0] - a[0], b[1] - a[1]];
  const dn = d1[0] * d2[1] - d1[1] * d2[0];
  const t = ((a[0] - p[0]) * d2[1] - (a[1] - p[1]) * d2[0]) / (dn || 1e-12);
  return [p[0] + t * d1[0], p[1] + t * d1[1]];
}
// Area of the intersection of triangle `sub` clipped against CCW triangle `clipT`.
function intersectArea(sub: P[], clipT: P[]): number {
  const clip = ensureCCW(clipT);
  let out: P[] = sub.slice();
  for (let i = 0; i < clip.length; i++) {
    const A = clip[i]!;
    const B = clip[(i + 1) % clip.length]!;
    const inside = (pt: P): boolean => (B[0] - A[0]) * (pt[1] - A[1]) - (B[1] - A[1]) * (pt[0] - A[0]) >= -1e-12;
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j]!;
      const prv = input[(j - 1 + input.length) % input.length]!;
      const ci = inside(cur);
      const pi = inside(prv);
      if (ci) { if (!pi) out.push(segX(prv, cur, A, B)); out.push(cur); }
      else if (pi) out.push(segX(prv, cur, A, B));
    }
    if (out.length < 3) return 0;
  }
  let area = 0;
  for (let i = 0; i < out.length; i++) { const a = out[i]!; const b = out[(i + 1) % out.length]!; area += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(area) / 2;
}
// True if any two of the emitted triangles share positive area.
function anyOverlap(tris: P[][]): number {
  let worst = 0;
  for (let i = 0; i < tris.length; i++) {
    for (let j = i + 1; j < tris.length; j++) {
      const ov = intersectArea(tris[i]!, tris[j]!);
      const minA = Math.min(triArea(tris[i]![0]!, tris[i]![1]!, tris[i]![2]!), triArea(tris[j]![0]!, tris[j]![1]!, tris[j]![2]!));
      if (ov > 1e-3 * minA) worst = Math.max(worst, ov / minA);
    }
  }
  return worst;
}
function inPoly(p: P, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function distToSeg(p: P, a: P, b: P): { d: number; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 <= 1e-12 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  const tc = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(p[0] - (a[0] + tc * dx), p[1] - (a[1] + tc * dy)), t };
}

// Build a TileBorder from polygon corners, optional per-edge visibility and a `bow`
// that bends each edge outward (to model a curved projection) via subdivision.
function tileFromPoly(poly: P[], sub: number, visible: boolean[] | null, bow: number): TileBorder {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  const edges = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    const nx = -(b[1] - a[1]);
    const ny = b[0] - a[0];
    const nl = Math.hypot(nx, ny) || 1;
    const pts: P[] = [];
    for (let k = 0; k <= sub; k++) {
      const t = k / sub;
      const bend = Math.sin(t * Math.PI) * bow;
      pts.push([a[0] + (b[0] - a[0]) * t + (nx / nl) * bend, a[1] + (b[1] - a[1]) * t + (ny / nl) * bend]);
    }
    return { pts, visible: visible ? visible[i]! : true };
  });
  return { edges, centroid: [cx, cy], ring: 0, orient: [1, 0], center: [cx, cy] };
}

const SQUARE: P[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const TRI: P[] = [[-1, -0.6], [1, -0.6], [0, 1.1]];
const THIN: P[] = [[-1.4, 0], [0, -0.35], [1.4, 0], [0, 0.35]]; // thin rhombus
const PENT: P[] = [];
for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + 0.3; PENT.push([Math.cos(a), Math.sin(a)]); }

// Penrose P2 DART — non-convex: the (-0.4,0) vertex is a reflex notch. Non-convex
// tiles (darts, hat/spectre monotiles) are real in the atlas and break a naive
// inset, so they must be covered too.
const DART: P[] = [[1, 0], [-1, 0.62], [-0.38, 0], [-1, -0.62]];
// A hat-ish non-convex polygon (several reflex vertices), to stress the general case.
const HAT: P[] = [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [1, 2], [1, 3], [0, 2.6], [-0.6, 1.4]];

const RECT: P[] = [[-1, -0.5], [1, -0.5], [1, 0.5], [-1, 0.5]]; // domino
const RECT_MID: P[] = [[-1, -0.5], [0, -0.5], [1, -0.5], [1, 0.5], [-1, 0.5]]; // collinear mid-edge vertex
const LTROMINO: P[] = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]; // chair (reflex at (1,1))

const SHAPES = [
  { name: 'square', poly: SQUARE },
  { name: 'triangle', poly: TRI },
  { name: 'thin-rhombus', poly: THIN },
  { name: 'pentagon', poly: PENT },
  { name: 'dart(reflex)', poly: DART },
  { name: 'hat(reflex)', poly: HAT },
  { name: 'domino', poly: RECT },
  { name: 'domino-collinear', poly: RECT_MID },
  { name: 'chair(L)', poly: LTROMINO },
];
const STYLES = [{ s: 0, n: 'miter' }, { s: 1, n: 'round' }, { s: 2, n: 'bevel' }];
const WIDTHS = [0.03, 0.08, 0.15, 0.3];
const SUBS = [{ sub: 1, bow: 0 }, { sub: 4, bow: 0 }, { sub: 6, bow: 0.01 }]; // flat, subdivided-flat, curved
const STEP = 0.01;

let failures = 0;
let checks = 0;
for (const shape of SHAPES) {
  for (const sd of SUBS) {
    for (const style of STYLES) {
      for (const h of WIDTHS) {
        const tile = tileFromPoly(shape.poly, sd.sub, null, sd.bow);
        const tris: P[][] = [];
        buildTileRing(tile, h, style.s, 0, 0, (p0, p1, p2) => tris.push([p0, p1, p2]));
        const real = tris.filter((t) => triArea(t[0]!, t[1]!, t[2]!) > 1e-10);
        // outline polygon (for inside test + band-core sampling)
        const outline: P[] = [];
        for (const e of tile.edges) for (let i = 0; i < e.pts.length - 1; i++) outline.push(e.pts[i]!);

        const overlap = anyOverlap(real); // area-based: robust, no sampling artifacts
        let outsidePts = 0;
        let gapPts = 0;
        let corePts = 0;
        let lo: P = [Infinity, Infinity];
        let hi: P = [-Infinity, -Infinity];
        for (const p of outline) { lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1])]; hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1])]; }
        for (let x = lo[0] - 0.05; x <= hi[0] + 0.05; x += STEP) {
          for (let y = lo[1] - 0.05; y <= hi[1] + 0.05; y += STEP) {
            const p: P = [x, y];
            let cover = 0;
            for (const t of real) if (inTri(p, t)) cover++;
            if (cover >= 1 && !inPoly(p, outline)) outsidePts++; // ring escaped the tile
            // band core: inside the tile, near the (possibly bowed) outline, away
            // from the corners where the join shapes things.
            if (inPoly(p, outline)) {
              let dmin = Infinity;
              for (let i = 0; i < outline.length; i++) {
                dmin = Math.min(dmin, distToSeg(p, outline[i]!, outline[(i + 1) % outline.length]!).d);
              }
              const farFromCorner = shape.poly.every((c) => Math.hypot(p[0] - c[0], p[1] - c[1]) > 2.5 * h);
              if (dmin < h * 0.4 && farFromCorner) { corePts++; if (cover === 0) gapPts++; }
            }
          }
        }
        checks++;
        const bad: string[] = [];
        if (overlap > 0) bad.push(`overlap ${(overlap * 100).toFixed(0)}%`);
        if (outsidePts > 2) bad.push(`${outsidePts} outside-tile`);
        if (gapPts > Math.max(6, corePts * 0.04)) bad.push(`${gapPts}/${corePts} band gaps`);
        if (bad.length) {
          failures++;
          console.log(`  FAIL  ${shape.name} sub=${sd.sub}${sd.bow ? '+bow' : ''} ${style.n} h=${h}: ${bad.join(', ')}`);
        }
      }
    }
  }
}

// hidden edge: that edge carries no band; the others still do.
{
  const tile = tileFromPoly(SQUARE, 2, [true, false, true, true], 0);
  const tris: P[][] = [];
  buildTileRing(tile, 0.12, 0, 0, 0, (p0, p1, p2) => tris.push([p0, p1, p2]));
  const mid: P = [1, 0]; // middle of the hidden right edge
  let cover = 0;
  for (const t of tris) if (inTri(mid, t)) cover++;
  if (cover !== 0) { failures++; console.log(`  hidden edge still drew a band (cover ${cover})`); }
}

// Fill sweep: pulling corners toward the centroid must never self-overlap, and must
// grow coverage (more fill → more area). Across every shape/style.
for (const shape of SHAPES) {
  for (const style of STYLES) {
    let prevArea = -1;
    for (const fill of [0, 0.4, 0.8, 1]) {
      const tile = tileFromPoly(shape.poly, 4, null, 0);
      const tris: P[][] = [];
      buildTileRing(tile, 0.1, style.s, fill, 0, (p0, p1, p2) => tris.push([p0, p1, p2]));
      const real = tris.filter((t) => triArea(t[0]!, t[1]!, t[2]!) > 1e-10);
      const ov = anyOverlap(real);
      if (ov > 0) { failures++; console.log(`  FILL overlap ${shape.name}/${style.n} fill=${fill}: ${(ov * 100).toFixed(0)}%`); }
      const a = real.reduce((s, t) => s + triArea(t[0]!, t[1]!, t[2]!), 0);
      if (a < prevArea - 1e-4) { failures++; console.log(`  FILL coverage shrank ${shape.name}/${style.n} fill=${fill}`); }
      prevArea = a;
    }
  }
}

// Point sweep: trimming the corner spikes must never self-overlap (it intentionally
// leaves a gap at the vertex, so coverage shrinks — only overlap is checked), and
// must SHRINK the total area (more trim → more cut). Across every shape/style.
for (const shape of SHAPES) {
  for (const style of STYLES) {
    let prevArea = Infinity;
    for (const point of [0, 0.3, 0.6, 1]) {
      const tile = tileFromPoly(shape.poly, 4, null, 0);
      const tris: P[][] = [];
      buildTileRing(tile, 0.1, style.s, 0, point, (p0, p1, p2) => tris.push([p0, p1, p2]));
      const real = tris.filter((t) => triArea(t[0]!, t[1]!, t[2]!) > 1e-10);
      const ov = anyOverlap(real);
      if (ov > 0) { failures++; console.log(`  POINT overlap ${shape.name}/${style.n} point=${point}: ${(ov * 100).toFixed(0)}%`); }
      const a = real.reduce((s, t) => s + triArea(t[0]!, t[1]!, t[2]!), 0);
      if (a > prevArea + 1e-4) { failures++; console.log(`  POINT coverage grew ${shape.name}/${style.n} point=${point}`); }
      prevArea = a;
    }
  }
}

// styles must differ
function area(style: number): number {
  const tile = tileFromPoly(PENT, 2, null, 0);
  const tris: P[][] = [];
  buildTileRing(tile, 0.12, style, 0, 0, (p0, p1, p2) => tris.push([p0, p1, p2]));
  return tris.reduce((s, t) => s + triArea(t[0]!, t[1]!, t[2]!), 0);
}
if (!(Math.abs(area(0) - area(2)) > 1e-4 && Math.abs(area(1) - area(2)) > 1e-4)) {
  failures++;
  console.log(`  styles not distinct: ${area(0).toFixed(4)} ${area(1).toFixed(4)} ${area(2).toFixed(4)}`);
}

if (failures > 0) {
  console.error(`border: ${failures} bad case(s)`);
  process.exit(1);
}
console.log(`border ok — single layer, inside-tile, no band gaps, distinct styles across ${checks} shape×sub×style×width cases`);
