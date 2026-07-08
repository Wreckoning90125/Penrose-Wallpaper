// Border geometry — pure, dependency-free (type-only import) so it is unit-testable
// headless (tools/verify_border_joins.mts).
//
// Each TILE draws its own border as a ring inset toward its own centroid. Because
// the tiles already partition the plane with no overlap and no gaps, borders from
// different tiles physically cannot overlap (they live in disjoint tiles) and meet
// exactly on every shared edge (the tiles share it exactly). The "vertex join" is
// just each tile's own two-edge corner — a standard convex-polygon inset corner, so
// there is no N-way junction to get wrong, and edge subdivision can't break it.
// Join style shapes that inner corner: miter (sharp), bevel (flat cut), round (arc).
import type { Point } from '../types';

function unit2(x: number, y: number): Point {
  const len = Math.hypot(x, y);
  return len <= 1e-9 ? [1, 0] : [x / len, y / len];
}

// A tile ready to stroke: each boundary edge as a projected polyline (>= 2 points,
// corner→corner; consecutive edges share a corner), a per-edge visible flag, the
// projected centroid (for the inward direction), and per-tile shading attributes.
export type TileBorder = {
  edges: { pts: Point[]; visible: boolean; curved?: boolean }[];
  centroid: Point;
  ring: number;
  orient: Point;
  center: Point;
};

// Inset a tile inward by halfWidth and emit the ring band on its visible edges. The
// inset corner at each tile vertex is the intersection of the two adjacent inset
// lines (miter), cut flat (bevel) or arced (round) per join style.
export function buildTileRing(
  tile: TileBorder,
  halfWidth: number,
  joinStyle: number,
  fill: number,
  point: number,
  gap: number,
  pushTri: (p0: Point, p1: Point, p2: Point, ring: number, orient: Point, center: Point, surfaceHint?: readonly number[]) => void,
): void {
  const { centroid, ring, orient, center } = tile;
  const k = tile.edges.length;
  if (k < 2) return;

  // Per-edge frame: start corner + chord direction. The inward normal comes from the
  // polygon WINDING (not the centroid), so it is correct even on non-convex tiles
  // (P2 darts, hat / spectre monotiles) where the centroid can sit outside an edge.
  const corners: Point[] = [];
  const chord: Point[] = [];
  for (let e = 0; e < k; e++) {
    const ep = tile.edges[e]!.pts;
    const a = ep[0]!;
    const b = ep[ep.length - 1]!;
    corners.push(a);
    chord.push(unit2(b[0] - a[0], b[1] - a[1]));
  }
  let area2 = 0;
  for (let e = 0; e < k; e++) {
    const a = corners[e]!;
    const b = corners[(e + 1) % k]!;
    area2 += a[0] * b[1] - b[0] * a[1];
  }
  const ccw = area2 >= 0;
  const inward: Point[] = chord.map((d) => (ccw ? [-d[1], d[0]] : [d[1], -d[0]]));

  // Per corner: reflex (non-convex notch) if it turns against the winding.
  const reflex: boolean[] = [];
  for (let i = 0; i < k; i++) {
    const ip = (i - 1 + k) % k;
    const turn = chord[ip]![0] * chord[i]![1] - chord[ip]![1] * chord[i]![0];
    reflex.push(ccw ? turn < -1e-9 : turn > 1e-9);
  }
  const anyReflex = reflex.some(Boolean);
  const edgeSurfaceHints: readonly number[][] = Array.from({ length: k }, (_, e) => [(e - 1 + k) % k, e, (e + 1) % k]);
  const cornerSurfaceHints: readonly number[][] = Array.from({ length: k }, (_, i) => [(i - 1 + k) % k, i]);

  // Width cap: never fold the ring. The centroid clearance is a conservative
  // local limit, and the shortest-edge fraction keeps reflex/skinny features
  // positive without pretending this is a true polygon inradius.
  let centroidClearance = Infinity;
  let minEdge = Infinity;
  for (let e = 0; e < k; e++) {
    const a = corners[e]!;
    const b = corners[(e + 1) % k]!;
    const dist = (centroid[0] - a[0]) * inward[e]![0] + (centroid[1] - a[1]) * inward[e]![1];
    if (dist > 0) centroidClearance = Math.min(centroidClearance, dist);
    minEdge = Math.min(minEdge, Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const cap = anyReflex
    ? minEdge * 0.2
    : Math.min(minEdge * 0.42, Number.isFinite(centroidClearance) ? centroidClearance * 0.92 : minEdge * 0.42);
  const h = Math.min(halfWidth, cap);
  if (h <= 1e-7) return;

  // Inset corner at tile vertex i (between edge i-1 and edge i): march from the
  // vertex along the angle bisector and stop at the NEAREST edge's offset line — i.e.
  // the corner border extends until it would cross another edge's border, and is cut
  // there (the miter point for adjacent edges; a closer edge on a thin tile clips it).
  // Every apex is inside all offset half-planes, so the inset polygon is convex and
  // the band can't self-overlap, at any subdivision.
  // Fill (pull corners toward the centroid) is for convex tilings like the P3 sun;
  // on non-convex tiles it would fold the inset, so it is disabled there.
  const f = anyReflex ? 0 : Math.max(0, Math.min(1, fill));
  // "Close gap" (applied in the band loop below, independent of Fill/Point) pulls each
  // band's INNER edge up to its tile vertex at the corner tips only — the band keeps
  // full width along the edge but tapers to a point at the shared vertex, so the outline
  // tips of every tile around a vertex meet there and the inter-tile star hole closes.
  // The already-meeting midline edge is untouched. Reflex tiles are left alone (would fold).
  const g = anyReflex ? 0 : Math.max(0, Math.min(1, gap));
  const apex: Point[] = [];
  for (let i = 0; i < k; i++) {
    const c = corners[i]!;
    if (reflex[i]) { apex.push(c); continue; } // reflex corners use feet, not an apex
    const ip = (i - 1 + k) % k;
    let bx = inward[ip]![0] + inward[i]![0];
    let by = inward[ip]![1] + inward[i]![1];
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl; by /= bl;
    let tMin = Infinity;
    for (let j = 0; j < k; j++) {
      const o: Point = [corners[j]![0] + inward[j]![0] * h, corners[j]![1] + inward[j]![1] * h];
      const dj = chord[j]!;
      const denom = bx * dj[1] - by * dj[0];
      if (Math.abs(denom) < 1e-9) continue;
      const t = ((o[0] - c[0]) * dj[1] - (o[1] - c[1]) * dj[0]) / denom;
      if (t > 1e-6 && t < tMin) tMin = t;
    }
    if (!Number.isFinite(tMin)) tMin = h;
    // Fill pulls the corner inset DEEPER — from the miter point (gaps between tile
    // borders at the vertex) toward the tile centroid (corners fill in until the
    // border segments meet). Lerp toward an interior point keeps the inset convex.
    const mx = c[0] + bx * tMin;
    const my = c[1] + by * tMin;
    apex.push([mx + (centroid[0] - mx) * f, my + (centroid[1] - my) * f]);
  }

  // Bevel/round cut the corner tip: each edge's inner edge stops SHORT of the apex,
  // pulled back ALONG its own offset line (so the band keeps full width — only the
  // corner is shortened, never the edge). The freed tip is filled by a flat chamfer
  // (bevel) or an arc to the apex (round). Cut points stay on the offset line away
  // from the corner, so they never re-enter the neighbour's strip — no overlap.
  // innerStart[e]/innerEnd[e] are edge e's inner-edge endpoints at its two corners.
  const innerStart: Point[] = [];
  const innerEnd: Point[] = [];
  const pull = (from: Point, toward: Point, dist: number): Point => {
    const dx = toward[0] - from[0];
    const dy = toward[1] - from[1];
    const len = Math.hypot(dx, dy) || 1;
    const d = Math.min(dist, len * 0.5);
    return [from[0] + (dx / len) * d, from[1] + (dy / len) * d];
  };
  const cut = joinStyle === 0 ? 0 : (joinStyle === 1 ? 1.8 : 1.2) * h;
  const foot = (e: number, at: number): Point => [corners[at]![0] + inward[e]![0] * h, corners[at]![1] + inward[e]![1] * h];
  for (let e = 0; e < k; e++) {
    const cs = e;
    const ce = (e + 1) % k;
    // At a convex corner the edge meets the shared apex (cut back for bevel/round); at
    // a reflex corner it meets its own perpendicular foot — the two edges' feet diverge
    // and the notch between them is filled below.
    let a0 = reflex[cs] ? foot(e, cs) : apex[cs]!;
    let a1 = reflex[ce] ? foot(e, ce) : apex[ce]!;
    if (cut > 0 && !reflex[cs]) a0 = pull(a0, reflex[ce] ? foot(e, ce) : apex[ce]!, cut);
    if (cut > 0 && !reflex[ce]) a1 = pull(a1, reflex[cs] ? foot(e, cs) : apex[cs]!, cut);
    innerStart.push(a0);
    innerEnd.push(a1);
  }

  // Point trims the corner SPIKE at each convex vertex — the band stops a short
  // distance back from the vertex (a blunt oblique cut) instead of tapering to a
  // sharp point. It only touches the edge ENDS (proportional to half-width), never
  // the long edge, and is independent of Fill. Reflex notches are left alone.
  const trim = Math.max(0, Math.min(1, point)) * h * 2.2;

  // Band per visible edge: outer = outline points; inner follows the same projected
  // edge polyline offset inward, then is corrected to hit the corner inset endpoints.
  // Curved tiles must not collapse their inner edge to a straight chord: that exposes
  // sampled curve points as fake corners and opens sliver gaps at the joins.
  for (let e = 0; e < k; e++) {
    if (!tile.edges[e]!.visible) continue;
    const ep = tile.edges[e]!.pts;
    const useCurveOffset = tile.edges[e]!.curved === true;
    const a0 = innerStart[e]!;
    const a1 = innerEnd[e]!;
    const last = ep.length - 1;
    let edgeLen = 0;
    for (let j = 0; j < last; j++) edgeLen += Math.hypot(ep[j + 1]![0] - ep[j]![0], ep[j + 1]![1] - ep[j]![1]);
    const endShift = (corner: number): number => (
      reflex[corner] || edgeLen <= 0 ? 0 : Math.min(0.45, trim / edgeLen)
    );
    const tA = endShift(e);
    const tB = 1 - endShift((e + 1) % k);
    const outerAt = (t: number): Point => {
      const s = t * last;
      const j = Math.max(0, Math.min(last - 1, Math.floor(s)));
      const f = s - j;
      return [ep[j]![0] + (ep[j + 1]![0] - ep[j]![0]) * f, ep[j]![1] + (ep[j + 1]![1] - ep[j]![1]) * f];
    };
    const tangentAt = (t: number): Point => {
      const s = Math.max(0, Math.min(last - 1e-9, t * last));
      const j = Math.max(0, Math.min(last - 1, Math.floor(s)));
      const a = ep[j]!;
      const b = ep[j + 1]!;
      return unit2(b[0] - a[0], b[1] - a[1]);
    };
    const normalAt = (t: number): Point => {
      const d = tangentAt(t);
      return ccw ? [-d[1], d[0]] : [d[1], -d[0]];
    };
    const offsetAt = (t: number): Point => {
      const o = outerAt(t);
      const n = normalAt(t);
      return [o[0] + n[0] * h, o[1] + n[1] * h];
    };
    const baseStart = useCurveOffset ? offsetAt(0) : a0;
    const baseEnd = useCurveOffset ? offsetAt(1) : a1;
    // Close gap: near each corner, pull the inner edge up toward the tile vertex over a
    // short zone (~1.5·halfWidth of the edge), tapering the band to a point at the
    // shared vertex while keeping full width in the middle. The tip then coincides with
    // every other tile's tip at that vertex, closing the inter-tile gap. The pinch is
    // skipped at a reflex corner. Extra knee samples localise it so the body is intact.
    const gapZone = g > 0 && edgeLen > 0 ? Math.min(0.45, (h * 1.5) / edgeLen) : 0;
    const innerAt = (t: number): Point => {
      let px: number;
      let py: number;
      if (useCurveOffset) {
        const base = offsetAt(t);
        px = base[0] + (a0[0] - baseStart[0]) * (1 - t) + (a1[0] - baseEnd[0]) * t;
        py = base[1] + (a0[1] - baseStart[1]) * (1 - t) + (a1[1] - baseEnd[1]) * t;
      } else {
        px = a0[0] + (a1[0] - a0[0]) * t;
        py = a0[1] + (a1[1] - a0[1]) * t;
      }
      if (gapZone > 1e-6) {
        if (!reflex[e]) {
          const w = g * Math.max(0, Math.min(1, (tA + gapZone - t) / gapZone));
          if (w > 0) { const c = corners[e]!; px += (c[0] - px) * w; py += (c[1] - py) * w; }
        }
        if (!reflex[(e + 1) % k]) {
          const w = g * Math.max(0, Math.min(1, (t - (tB - gapZone)) / gapZone));
          if (w > 0) { const c = corners[(e + 1) % k]!; px += (c[0] - px) * w; py += (c[1] - py) * w; }
        }
      }
      return [px, py];
    };
    const ts = new Set<number>([tA, tB]);
    for (let j = 1; j < last; j++) { const t = j / last; if (t > tA + 1e-9 && t < tB - 1e-9) ts.add(t); }
    if (gapZone > 1e-6) for (const knee of [tA + gapZone, tB - gapZone]) if (knee > tA + 1e-9 && knee < tB - 1e-9) ts.add(knee);
    const params = [...ts].sort((a, b) => a - b);
    for (let i = 0; i < params.length - 1; i++) {
      const t0 = params[i]!;
      const t1 = params[i + 1]!;
      if (t1 <= t0 + 1e-9) continue;
      const o0 = outerAt(t0);
      const o1 = outerAt(t1);
      const i0 = innerAt(t0);
      const i1 = innerAt(t1);
      pushTri(o0, o1, i1, ring, orient, center, edgeSurfaceHints[e]);
      pushTri(o0, i1, i0, ring, orient, center, edgeSurfaceHints[e]);
    }
  }

  // Corner fills (both touching edges visible). Reflex: fill the notch between the two
  // diverging feet. Convex bevel/round: the chamfer/arc across the pulled-back cut.
  // Convex miter: nothing (the bands already meet on the shared apex).
  for (let i = 0; i < k; i++) {
    const ip = (i - 1 + k) % k;
    if (!tile.edges[ip]!.visible || !tile.edges[i]!.visible) continue;
    const v = corners[i]!;
    const cIn = innerEnd[ip]!;   // incoming edge's inner endpoint at corner i
    const cOut = innerStart[i]!; // outgoing edge's inner endpoint at corner i
    const surfaceHint = cornerSurfaceHints[i];
    if (reflex[i]) {
      pushTri(v, cIn, cOut, ring, orient, center, surfaceHint); // reflex notch (untouched by Point)
    } else if (trim > 1e-9) {
      continue; // convex spike trimmed flat — no apex fill
    } else if (cut > 0 && joinStyle === 1) {
      const m = apex[i]!;
      const segs = 4;
      let prev = cIn;
      for (let s = 1; s <= segs; s++) {
        const t = s / segs;
        const it = 1 - t;
        const p: Point = [
          it * it * cIn[0] + 2 * it * t * m[0] + t * t * cOut[0],
          it * it * cIn[1] + 2 * it * t * m[1] + t * t * cOut[1],
        ];
        pushTri(v, prev, p, ring, orient, center, surfaceHint);
        prev = p;
      }
    } else if (cut > 0) {
      pushTri(v, cIn, cOut, ring, orient, center, surfaceHint);
    }
  }
}
