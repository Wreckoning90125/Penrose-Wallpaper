import { BufferAttribute, BufferGeometry, InterleavedBuffer, InterleavedBufferAttribute, Sphere, Vector3 } from 'three/webgpu';
import { intSetting, numberSetting, type Settings } from '../settings/androidSettings';
import {
  buildPalette,
  MAX_COLORS,
  MAX_PALETTE_PRESET,
  oklchToLinearSrgb,
  paletteColorAt,
  topologyPaletteSlot,
  type Oklch,
  type Palette,
} from '../color/palette';
import type { AtlasItem, GeometryBuild, Patch, Point, Point3, Tile, TilingWindow } from '../types';
import { buildTileRing, type TileBorder } from './borderJoin';
import { ORDER_FIVE_IFS_FAMILY } from './orderFiveIfs';
import {
  familySupportsWieringaRoof,
  penroseCompositionEdgeRuleForFamily,
  sourceOverlayActiveForStyle,
  sourceOverlayKindForFamily,
} from './capabilities';
import { generateWindowedPatch, windowedPatchKey } from './windowedGeneration';

type FamilySpec = {
  typeBuckets: number;
  orientBuckets: number;
  orientFromType: boolean;
  angA: number;
  angB: number;
  orientHalfTurn: boolean;
  ringChebyshev: boolean;
};

type PatchIdentity = {
  family: number;
  seed: number;
  generation: number;
};

type TileClasses = {
  bucket: Float32Array;
  numBuckets: number;
};

type Projector = {
  enabled: boolean;
  map: (x: number, y: number) => Point;
};

type MeshBuffers = {
  position: Float32Array;
  color: Float32Array;
  paletteSlot: Float32Array;
  topologyPaletteColor: Float32Array;
  tileType: Float32Array;
  tileRing: Float32Array;
  tileOrient: Float32Array;
  tileCenter: Float32Array;
  tileRelief: Float32Array;
  tileReliefSlope: Float32Array;
  tileEdgeBary: Float32Array;
  tileEdgeDistance: Float32Array;
  tileShape: Float32Array;
  tileScale: Float32Array;
  tileLocal: Float32Array;
  tileTopology: Float32Array;
};

type PaletteSlotBuild = {
  paletteSlot: Float32Array;
  topologyPaletteColor: Float32Array;
  palette: Palette;
};

type Snapper = (point: Point) => Point;
type ReliefSampler = (point: Point) => SurfaceSample;
type EdgeKind = 'base' | 'leg' | 'edge';
type EdgeSide = {
  tileIndex: number;
  edgeIndex: number;
  type: number;
  kind: EdgeKind;
  a: Point;
  b: Point;
};
type EdgeEntry = {
  a: Point;
  b: Point;
  sides: EdgeSide[];
};
type EdgeTopology = {
  edgesByKey: Map<string, EdgeEntry>;
  visibleKeys: Set<string>;
};
type BorderLayoutTile = {
  edges: TileBorder['edges'];
  centroid: Point;
  outline: Point[];
  surface: SurfaceIndex | null;
  surfaceByEdge: SurfaceIndex[];
  localSurfaceHints: boolean;
  reliefApex: number;
  typeValue: number;
  shapeValue: number;
  tileScale: number;
  ring: number;
  orient: Point;
  center: Point;
  localFrame: AtlasFrame;
  topology: TopologyQuad;
};
type SurfaceVertex = {
  p: Point;
  relief: number;
};
type SurfaceTri = {
  a: SurfaceVertex;
  b: SurfaceVertex;
  c: SurfaceVertex;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  queryMark: number;
};
type Bounds2 = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};
type SurfaceIndex = {
  surfaces: SurfaceTri[];
  axis: 0 | 1;
  min: number;
  invBinSize: number;
  bins: SurfaceTri[][] | null;
};
type SurfaceSample = {
  relief: number;
  slopeX: number;
  slopeY: number;
};
type WieringaRoofTile = {
  heights: number[];
};
type WieringaRhombRecord = {
  firstTile: Tile;
  secondTile: Tile;
  rhomb: [Point, Point, Point, Point];
};
type SpectreMeshDetail = {
  samplesPerSide: number;
  radialBands: number;
  key: string;
};
type TileTriangulationPlan = {
  centroidFan: boolean;
  ears: [number, number, number][];
};
type SpectreBoundaryCacheEntry = {
  key: string;
  verts: Point[];
};
type TileSourceTriangle = {
  a: Point3;
  b: Point3;
  c: Point3;
  edges: number[];
  edgeMask: EdgeMask;
};
type EdgeMask = [boolean, boolean, boolean];
type EdgeBary = [number, number, number];
type TopologyQuad = [number, number, number, number];
type FillSourceVertex = {
  point: Point3;
  edgeBary: EdgeBary;
};
type AtlasFrame = {
  center: Point;
  axis: Point;
  scale: number;
};
type TileSourceTriangleCacheEntry = {
  key: string;
  triangles: TileSourceTriangle[];
};
type BorderLayoutCacheEntry = {
  key: string;
  layout: BorderLayoutTile[];
};
export type SpectreBorderLayoutDebugEdge = {
  tileIndex: number;
  edgeIndex: number;
  logicalEdgeCount: number;
  curved: boolean;
  sampleCount: number;
  first: Point;
  last: Point;
  maxChordDistance: number;
  visible: boolean;
  surfaceHints: number[];
};
const SPECTRE_TILE_CACHE_LIMIT = 4;
const BORDER_LAYOUT_CACHE_LIMIT = 4;
const borderLayoutCache = new WeakMap<Patch, BorderLayoutCacheEntry[]>();
const spectreBoundaryCache = new WeakMap<Tile, SpectreBoundaryCacheEntry[]>();
const spectreTriangleCache = new WeakMap<Tile, TileSourceTriangleCacheEntry[]>();
const tileTriangulationCache = new WeakMap<Tile, TileTriangulationPlan>();
let surfaceQueryMark = 1;
// Indexed by the numeric penrose::Family enum and the .ptg family id. This is
// ABI/file-format order, not menu order; keep it in lockstep with penrose.h.
const FAMILY_SPECS_BY_ID: FamilySpec[] = [
  /*  0 P3              */ { typeBuckets: 2, orientBuckets: 10, orientFromType: false, angA: 0, angB: 2, orientHalfTurn: false, ringChebyshev: false },
  /*  1 P2              */ { typeBuckets: 2, orientBuckets: 10, orientFromType: false, angA: 0, angB: 2, orientHalfTurn: false, ringChebyshev: false },
  /*  2 Chair           */ { typeBuckets: 4, orientBuckets: 4, orientFromType: true, angA: 0, angB: 0, orientHalfTurn: false, ringChebyshev: true },
  /*  3 Dodecagonal     */ { typeBuckets: 3, orientBuckets: 6, orientFromType: false, angA: 0, angB: 1, orientHalfTurn: true, ringChebyshev: false },
  /*  4 Pinwheel        */ { typeBuckets: 2, orientBuckets: 10, orientFromType: false, angA: 0, angB: 2, orientHalfTurn: false, ringChebyshev: false },
  /*  5 AmmannBeenker   */ { typeBuckets: 2, orientBuckets: 4, orientFromType: false, angA: 0, angB: 1, orientHalfTurn: true, ringChebyshev: false },
  /*  6 Heptagonal      */ { typeBuckets: 3, orientBuckets: 7, orientFromType: false, angA: 0, angB: 1, orientHalfTurn: true, ringChebyshev: false },
  /*  7 Binary          */ { typeBuckets: 2, orientBuckets: 5, orientFromType: false, angA: 0, angB: 1, orientHalfTurn: true, ringChebyshev: false },
  /*  8 Tuebingen       */ { typeBuckets: 2, orientBuckets: 10, orientFromType: false, angA: 0, angB: 2, orientHalfTurn: false, ringChebyshev: false },
  /*  9 P1              */ { typeBuckets: 4, orientBuckets: 10, orientFromType: false, angA: 0, angB: 1, orientHalfTurn: false, ringChebyshev: false },
  /* 10 Danzer          */ { typeBuckets: 4, orientBuckets: 14, orientFromType: false, angA: 0, angB: 2, orientHalfTurn: false, ringChebyshev: false },
  /* 11 Hat             */ { typeBuckets: 5, orientBuckets: 12, orientFromType: false, angA: 0, angB: 1, orientHalfTurn: false, ringChebyshev: false },
  /* 12 Spectre         */ { typeBuckets: 10, orientBuckets: 12, orientFromType: false, angA: 0, angB: 1, orientHalfTurn: false, ringChebyshev: false },
  /* 13 Equithirds      */ { typeBuckets: 2, orientBuckets: 6, orientFromType: false, angA: 0, angB: 1, orientHalfTurn: false, ringChebyshev: false },
  /* 14 CromwellKRT     */ { typeBuckets: 3, orientBuckets: 10, orientFromType: false, angA: 0, angB: 1, orientHalfTurn: false, ringChebyshev: false },
  /* 15 GailiunasSpiral */ { typeBuckets: 18, orientBuckets: 18, orientFromType: false, angA: 0, angB: 1, orientHalfTurn: false, ringChebyshev: false },
  /* 16 Cairo           */ { typeBuckets: 8, orientBuckets: 8, orientFromType: false, angA: 0, angB: 1, orientHalfTurn: false, ringChebyshev: true },
  /* 17 SocolarTaylor   */ { typeBuckets: 28, orientBuckets: 6, orientFromType: false, angA: 0, angB: 1, orientHalfTurn: false, ringChebyshev: false },
  /* 18 D4Substitution  */ { typeBuckets: 8, orientBuckets: 8, orientFromType: true, angA: 0, angB: 0, orientHalfTurn: false, ringChebyshev: true },
  /* 19 OrderFiveIFS    */ { typeBuckets: 5, orientBuckets: 5, orientFromType: true, angA: 0, angB: 0, orientHalfTurn: false, ringChebyshev: false },
];
const MAX_FAMILY_ID = FAMILY_SPECS_BY_ID.length - 1;
const FAMILY_MAX_SEED_BY_ID = new Map<number, number>([
  [0, 3], [1, 1], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 1],
  [8, 1], [9, 0], [10, 1], [11, 3], [12, 8], [13, 1], [14, 3], [15, 51], [16, 0], [17, 1], [18, 5], [19, 42],
]);
const FAMILY_MAX_GENERATION_BY_ID = new Map<number, number>([
  // 3/5/6 mirror the true multigrid caps (MG_DODECA/MG_AMMANN/MG_HEPTAGON in
  // windowedGeneration.ts and penrose.cpp kFamilyInfo) — the generator clamps
  // there anyway, so higher UI values would just alias the top generation
  // under distinct cache keys.
  [2, 7], [3, 6], [4, 6], [5, 4], [6, 7], [9, 7], [10, 7], [11, 4], [12, 3], [13, 10], [14, 5], [15, 8], [16, 8], [17, 7], [18, 8], [19, 4],
]);
// Subdivision detail is useful on sparse patches and pathological on dense
// live-generated patches. These caps keep allocations bounded without changing
// normal atlas presets; dense patches still render, just with less per-tile
// tessellation where the extra vertices would be visually redundant.
const MAX_FILL_VERTEX_COUNT = 2_400_000;
const MAX_BORDER_VERTEX_COUNT = 2_400_000;
const MIN_BORDER_SURFACE_SUBDIVISION = 3;
const MAX_TILE_VERTEX_COUNT = 64;
const SPECTRE_FAMILY_ID = 12;
const SPECTRE_LOGICAL_SIDE_COUNT = 14;
const SPECTRE_FILL_SAMPLES_PER_SIDE = 6;
const SPECTRE_BORDER_SAMPLES_PER_SIDE = 12;
const SPECTRE_CURVE_BULGE = 0.6;
const MIN_SPECTRE_FILL_SUBDIVISION = 1;
const SPECTRE_EDGE_FADE_FRACTION = 0.24;
const SPECTRE_RELIEF_RING_FRACTIONS = [0, 0.55, 1.15];
const SPECTRE_RADIAL_SUPPORT_BANDS = 13;
const SPECTRE_KEY_INDICES = [4, 6, 8, 12];
const WIERINGA_ROOF_RELIEF_SCALE = 0.72;
const DEFAULT_SPECTRE_MESH_DETAIL: SpectreMeshDetail = {
  samplesPerSide: SPECTRE_FILL_SAMPLES_PER_SIDE,
  radialBands: SPECTRE_RADIAL_SUPPORT_BANDS,
  key: `${SPECTRE_FILL_SAMPLES_PER_SIDE}:${SPECTRE_RADIAL_SUPPORT_BANDS}`,
};
const SPECTRE_MESH_DETAIL_CANDIDATES: readonly SpectreMeshDetail[] = [
  DEFAULT_SPECTRE_MESH_DETAIL,
  { samplesPerSide: 5, radialBands: 13, key: '5:13' },
  { samplesPerSide: 4, radialBands: 13, key: '4:13' },
  { samplesPerSide: 4, radialBands: 9, key: '4:9' },
  { samplesPerSide: 3, radialBands: 9, key: '3:9' },
  { samplesPerSide: 3, radialBands: 5, key: '3:5' },
  { samplesPerSide: 2, radialBands: 3, key: '2:3' },
  { samplesPerSide: 2, radialBands: 2, key: '2:2' },
  { samplesPerSide: 1, radialBands: 1, key: '1:1' },
];
const AREA_EPS = 1e-14;
const PROJECTED_AREA_EPS = 2e-9;
const SEGMENT_EPS = 1e-12;
const CLIP_DISTANCE_EPS = 1e-10;
const SURFACE_BOUNDS_EPS = 1e-10;
const SOURCE_EDGE_KEY_SCALE = 1e5;

class Float32Builder {
  private data: Float32Array;
  length: number;

  constructor(capacity = 1024) {
    this.data = new Float32Array(capacity);
    this.length = 0;
  }

  private ensure(extra: number): void {
    const required = this.length + extra;
    if (required <= this.data.length) return;
    let capacity = this.data.length;
    while (capacity < required) capacity *= 2;
    const next = new Float32Array(capacity);
    next.set(this.data);
    this.data = next;
  }

  push1(a: number): void {
    this.ensure(1);
    this.data[this.length] = a;
    this.length += 1;
  }

  push2(a: number, b: number): void {
    this.ensure(2);
    this.data[this.length] = a;
    this.data[this.length + 1] = b;
    this.length += 2;
  }

  push3(a: number, b: number, c: number): void {
    this.ensure(3);
    this.data[this.length] = a;
    this.data[this.length + 1] = b;
    this.data[this.length + 2] = c;
    this.length += 3;
  }

  push4(a: number, b: number, c: number, d: number): void {
    this.ensure(4);
    this.data[this.length] = a;
    this.data[this.length + 1] = b;
    this.data[this.length + 2] = c;
    this.data[this.length + 3] = d;
    this.length += 4;
  }

  view(): Float32Array {
    return this.data.subarray(0, this.length);
  }
}

function patchVertexCount(tiles: readonly Tile[]): number {
  let count = 0;
  for (const tile of tiles) count += tile.verts.length;
  return count;
}

function patchBorderSourceCount(tiles: readonly Tile[], family: number): number {
  if (family !== SPECTRE_FAMILY_ID) return patchVertexCount(tiles);
  let count = 0;
  for (const tile of tiles) {
    count += isSpectreCurveTile(tile, family)
      ? SPECTRE_LOGICAL_SIDE_COUNT * SPECTRE_BORDER_SAMPLES_PER_SIDE
      : tile.verts.length;
  }
  return count;
}

function clampQuadraticSubdivision(requested: number, sourceTriangleCount: number, maxVertices: number): number {
  if (sourceTriangleCount <= 0) return requested;
  const maxSub = Math.max(1, Math.floor(Math.sqrt(maxVertices / (sourceTriangleCount * 3))));
  return Math.max(1, Math.min(requested, maxSub));
}

function minFillSubdivisionForFamily(family: number): number {
  return family === SPECTRE_FAMILY_ID ? MIN_SPECTRE_FILL_SUBDIVISION : 1;
}

// #4 Screen-error-adaptive tessellation (SurfLab/Yeo iPASS, 1109reyes). The fill
// density was a fixed hyp_fill_subdiv budget. Yeo's insight (eqs. 8-10) is that
// the tessellation factor needed to keep parametric distortion under a pixel is
// tau = m * sqrt(w), where w is a slefe "variance from linearity" bound that
// contracts quadratically (h^2) under subdivision. We do not build slefes; the
// patch-level variance proxy is the relief amplitude normalized by tile radius
// (how far the displaced surface bows off its flat facet), and the screen term
// is the Poincaré zoom (hyp_scale) since the disk projection compresses the rim
// and needs more detail there. adapt_tess = 0 returns EXACTLY the fixed budget
// (byte-identical default). This is a single pure function shared by the fill and
// palette-slot builders so their vertex counts can never desync.
function adaptiveFillSub(settings: Settings, activePatch: Patch, sourceTriCount: number): number {
  const base = Math.max(intSetting(settings, 'hyp_fill_subdiv', 1, 8), minFillSubdivisionForFamily(activePatch.family));
  const adapt = intSetting(settings, 'adapt_tess', 0, 100) / 100;
  let requested = base;
  if (adapt > 0) {
    // w = an actually-measured per-patch variance-from-linearity: how far the
    // relief field bows off the linear centre→rim chord that a coarse fan bakes.
    // This genuinely varies with tile geometry (irregular / non-star tiles bow
    // more), unlike a fixed amplitude ratio.
    const w = reliefVarianceFromLinearity(activePatch);
    const zoom = intSetting(settings, 'projection', 0, 1) === 1
      ? 1 + intSetting(settings, 'hyp_scale', 0, 100) / 100
      : 1;
    // tau = m * sqrt(w) (Yeo eq. 9), floored at the base budget and scaled by the
    // Poincare zoom as the screen-error term; adapt blends it in (0 => base).
    const tau = base * (1 + adapt * (Math.sqrt(Math.max(w, 0)) * 2 * zoom));
    requested = Math.max(base, Math.round(tau));
  }
  return clampQuadraticSubdivision(requested, sourceTriCount, MAX_FILL_VERTEX_COUNT);
}

// Per-patch variance-from-linearity proxy for #4: sample the analytic relief
// field (apex normalized to 1) at the centre→vertex midpoints of a stride of
// tiles and take the max deviation from the linear chord value (0.5 at the
// midpoint). Dimensionless and geometry-dependent — the slefe "w" stand-in that
// Yeo's iPASS feeds into tau = m*sqrt(w). Deterministic on the patch, so the fill
// and palette builders that both call adaptiveFillSub cannot desync.
function reliefVarianceFromLinearity(activePatch: Patch): number {
  const tiles = activePatch.tiles;
  if (tiles.length === 0) return 0;
  let maxDev = 0;
  const stride = Math.max(1, Math.floor(tiles.length / 24));
  for (let i = 0; i < tiles.length; i += stride) {
    const tile = tiles[i]!;
    const verts = tile.verts;
    if (verts.length < 3) continue;
    const c = centroid(verts);
    for (const v of verts) {
      const mid: Point = [(c[0] + v[0]) * 0.5, (c[1] + v[1]) * 0.5];
      const relief = tileReliefAt(mid, c, verts, 1);
      const dev = Math.abs(relief - 0.5);
      if (dev > maxDev) maxDev = dev;
    }
  }
  return Math.max(0, Math.min(1, maxDev * 2));
}

function spectreSourceTrianglesPerTile(detail: SpectreMeshDetail): number {
  const sampleCount = SPECTRE_LOGICAL_SIDE_COUNT * Math.max(1, detail.samplesPerSide);
  const reliefBandCount = Math.max(0, SPECTRE_RELIEF_RING_FRACTIONS.length - 1);
  const capBandCount = Math.max(1, detail.radialBands);
  return sampleCount * (2 * reliefBandCount + 2 * capBandCount - 1);
}

function spectreMeshDetailForPatch(tiles: readonly Tile[], family: number): SpectreMeshDetail {
  if (family !== SPECTRE_FAMILY_ID) return DEFAULT_SPECTRE_MESH_DETAIL;
  const spectreTileCount = tiles.reduce((count, tile) => count + (isSpectreCurveTile(tile, family) ? 1 : 0), 0);
  if (spectreTileCount <= 0) return DEFAULT_SPECTRE_MESH_DETAIL;
  const maxSourceTriangles = Math.floor(MAX_FILL_VERTEX_COUNT / 3);
  for (const detail of SPECTRE_MESH_DETAIL_CANDIDATES) {
    if (spectreTileCount * spectreSourceTrianglesPerTile(detail) <= maxSourceTriangles) return detail;
  }
  return SPECTRE_MESH_DETAIL_CANDIDATES[SPECTRE_MESH_DETAIL_CANDIDATES.length - 1]!;
}

function clampLinearSubdivision(requested: number, edgeFanCount: number, maxVertices: number, verticesPerSegment: number): number {
  if (edgeFanCount <= 0) return requested;
  const maxSub = Math.max(1, Math.floor(maxVertices / (edgeFanCount * verticesPerSegment)));
  return Math.max(1, Math.min(requested, maxSub));
}

function lerp2(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function cubic2(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return [
    uu * u * p0[0] + 3 * uu * t * p1[0] + 3 * u * tt * p2[0] + tt * t * p3[0],
    uu * u * p0[1] + 3 * uu * t * p1[1] + 3 * u * tt * p2[1] + tt * t * p3[1],
  ];
}

function spectreAnchors(tile: Tile): Point[] {
  if (tile.verts.length === SPECTRE_LOGICAL_SIDE_COUNT) return tile.verts;
  if (
    tile.verts.length > SPECTRE_LOGICAL_SIDE_COUNT
    && tile.verts.length % SPECTRE_LOGICAL_SIDE_COUNT === 0
  ) {
    const samplesPerSide = tile.verts.length / SPECTRE_LOGICAL_SIDE_COUNT;
    return Array.from({ length: SPECTRE_LOGICAL_SIDE_COUNT }, (_, side) => tile.verts[side * samplesPerSide]!);
  }
  return tile.verts;
}

function isSpectreCurveTile(tile: Tile, family: number): boolean {
  return family === SPECTRE_FAMILY_ID && spectreAnchors(tile).length === SPECTRE_LOGICAL_SIDE_COUNT;
}

function spectreCurvePoint(anchors: readonly Point[], side: number, t: number): Point {
  const start = anchors[side]!;
  const end = anchors[(side + 1) % SPECTRE_LOGICAL_SIDE_COUNT]!;
  const vx = end[0] - start[0];
  const vy = end[1] - start[1];
  const wx = -vy;
  const wy = vx;
  const bulge = side % 2 === 0 ? SPECTRE_CURVE_BULGE : -SPECTRE_CURVE_BULGE;
  const c1: Point = [start[0] + vx * 0.33 + wx * bulge, start[1] + vy * 0.33 + wy * bulge];
  const c2: Point = [start[0] + vx * 0.67 + wx * bulge, start[1] + vy * 0.67 + wy * bulge];
  return cubic2(start, c1, c2, end, t);
}

function spectreCurvePolygon(tile: Tile, samplesPerSide: number): Point[] {
  const anchors = spectreAnchors(tile);
  if (anchors.length !== SPECTRE_LOGICAL_SIDE_COUNT) return tile.verts;
  const samples = Math.max(1, samplesPerSide);
  const key = String(samples);
  const entries = spectreBoundaryCache.get(tile);
  const existingIndex = entries?.findIndex(entry => entry.key === key) ?? -1;
  if (entries && existingIndex >= 0) {
    const [entry] = entries.splice(existingIndex, 1);
    entries.unshift(entry!);
    return entry!.verts;
  }
  const points: Point[] = [];
  for (let side = 0; side < SPECTRE_LOGICAL_SIDE_COUNT; side++) {
    for (let sample = 0; sample < samples; sample++) {
      points.push(spectreCurvePoint(anchors, side, sample / samples));
    }
  }
  const next = entries ?? [];
  next.unshift({ key, verts: points });
  if (next.length > SPECTRE_TILE_CACHE_LIMIT) next.length = SPECTRE_TILE_CACHE_LIMIT;
  if (!entries) spectreBoundaryCache.set(tile, next);
  return points;
}

function spectreKeyCenter(anchors: readonly Point[]): Point {
  if (anchors.length < SPECTRE_LOGICAL_SIDE_COUNT) return centroid([...anchors]);
  let x = 0;
  let y = 0;
  for (const index of SPECTRE_KEY_INDICES) {
    const p = anchors[index]!;
    x += p[0];
    y += p[1];
  }
  return [x / SPECTRE_KEY_INDICES.length, y / SPECTRE_KEY_INDICES.length];
}

function spectreFrameForTile(
  tile: Tile,
  family: number,
  projector: Projector,
  snap: Snapper,
): { center: Point; orient: Point; scale: number; sourceCenter: Point } | null {
  if (!isSpectreCurveTile(tile, family)) return null;
  const anchors = spectreAnchors(tile);
  const sourceCenter = spectreKeyCenter(anchors);
  const center = snap(projector.map(sourceCenter[0], sourceCenter[1]));
  const axisA = snap(projector.map(anchors[1]![0], anchors[1]![1]));
  const axisB = snap(projector.map(anchors[2]![0], anchors[2]![1]));
  const dx = axisB[0] - axisA[0];
  const dy = axisB[1] - axisA[1];
  const len = Math.hypot(dx, dy);
  const hand = signedArea(sourceBoundaryVerts(tile, family)) >= 0 ? 1 : -1;
  return {
    center,
    orient: len > SEGMENT_EPS ? [dx / len, dy / len] : orientation(tile, family),
    scale: hand * Math.max(len, SEGMENT_EPS),
    sourceCenter,
  };
}

function sourceBoundaryVerts(
  tile: Tile,
  family: number,
  spectreDetail: SpectreMeshDetail = DEFAULT_SPECTRE_MESH_DETAIL,
): Point[] {
  return isSpectreCurveTile(tile, family)
    ? spectreCurvePolygon(tile, spectreDetail.samplesPerSide)
    : tile.verts;
}

function sourceCenterForTile(tile: Tile, family: number): Point {
  return isSpectreCurveTile(tile, family)
    ? spectreKeyCenter(spectreAnchors(tile))
    : centroid(tile.verts);
}

function projectedTileRadius(
  verts: readonly Point[],
  center: Point,
  projector: Projector,
  snap: Snapper,
): number {
  const projectedCenter = snap(projector.map(center[0], center[1]));
  let sum = 0;
  for (const p of verts) {
    const q = snap(projector.map(p[0], p[1]));
    sum += Math.hypot(q[0] - projectedCenter[0], q[1] - projectedCenter[1]);
  }
  return Math.max(1e-6, sum / Math.max(1, verts.length));
}

function logicalBoundaryEdgeGroups(tile: Tile, family: number): number[][] {
  if (!isSpectreCurveTile(tile, family)) return tile.verts.map((_, edgeIndex) => [edgeIndex]);
  return Array.from({ length: SPECTRE_LOGICAL_SIDE_COUNT }, (_, side) => [side]);
}

function maxSeedForFamily(family: number): number {
  return FAMILY_MAX_SEED_BY_ID.get(family) ?? 0;
}

function maxGenerationForFamilyId(family: number): number {
  return FAMILY_MAX_GENERATION_BY_ID.get(family) ?? 8;
}

function typeBucketCount(tiles: readonly Tile[], family: number, spec: FamilySpec): number {
  if (family !== 15) return Math.max(1, spec.typeBuckets);
  let maxType = 0;
  for (const tile of tiles) maxType = Math.max(maxType, tile.type);
  return maxType + 1;
}

export async function loadPatch(item: AtlasItem): Promise<Patch> {
  if (!item.geometry) throw new Error(`atlas target has no geometry: ${item.id}`);
  const response = await fetch(`/generated/atlas/${item.geometry}`, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`geometry HTTP ${response.status}: ${item.geometry}`);
  return parsePatch(await response.arrayBuffer());
}

export async function loadPatchForSettings(settings: Settings, item: AtlasItem | null = null, window: TilingWindow | null = null): Promise<Patch> {
  const family = intSetting(settings, 'family', 0, MAX_FAMILY_ID);
  const seed = intSetting(settings, 'seed', 0, maxSeedForFamily(family));
  const generation = intSetting(settings, 'generation', 0, maxGenerationForFamilyId(family));
  const expected = { family, seed, generation };
  if (family === ORDER_FIVE_IFS_FAMILY) return { ...expected, tiles: [] };
  const windowedPatch = window ? generateWindowedPatch(family, seed, generation, window) : null;
  if (windowedPatch) return windowedPatch;
  if (
    item?.geometry
    && intSetting(item.settings ?? {}, 'family', -1, MAX_FAMILY_ID) === family
    && intSetting(item.settings ?? {}, 'seed', -1, maxSeedForFamily(family)) === seed
    && intSetting(item.settings ?? {}, 'generation', -1, maxGenerationForFamilyId(family)) === generation
  ) {
    const patch = await loadPatch(item);
    if (samePatchIdentity(patch, expected)) return patch;
  }

  const response = await fetch(`/generated/live/${family}/${seed}/${generation}.ptg`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`geometry HTTP ${response.status}: family=${family} seed=${seed} generation=${generation}`);
  const patch = parsePatch(await response.arrayBuffer());
  if (!samePatchIdentity(patch, expected)) {
    throw new Error(`geometry identity mismatch: expected ${family}/${seed}/${generation}, got ${patch.family}/${patch.seed}/${patch.generation}`);
  }
  return patch;
}

export function tilingWindowKey(window: TilingWindow | null): string {
  return windowedPatchKey(window);
}

export function windowPatchForView(patch: Patch, window: TilingWindow | null): Patch {
  if (!window || patch.tiles.length === 0) return patch;
  const radius = averageTileRadius(patch.tiles);
  const margin = Math.max(radius * 6, 1e-5);
  const bounds: Bounds2 = {
    minX: window.centerX - window.halfWidth - margin,
    maxX: window.centerX + window.halfWidth + margin,
    minY: window.centerY - window.halfHeight - margin,
    maxY: window.centerY + window.halfHeight + margin,
  };
  const tiles = patch.tiles.filter(tile => tileIntersectsBounds(tile, bounds));
  return {
    family: patch.family,
    seed: patch.seed,
    generation: patch.generation,
    tiles,
  };
}

function samePatchIdentity(patch: Patch, expected: PatchIdentity): boolean {
  return patch.family === expected.family && patch.seed === expected.seed && patch.generation === expected.generation;
}

function parsePatch(buffer: ArrayBuffer): Patch {
  if (buffer.byteLength < 20) throw new Error(`tiling geometry is truncated: ${buffer.byteLength} bytes`);
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'PTG1') throw new Error('bad tiling geometry magic');
  let offset = 4;
  const family = view.getUint32(offset, true); offset += 4;
  const seed = view.getUint32(offset, true); offset += 4;
  const generation = view.getUint32(offset, true); offset += 4;
  const tileCount = view.getUint32(offset, true); offset += 4;
  if (family > MAX_FAMILY_ID) throw new Error(`tiling geometry has invalid family id ${family}`);
  if (seed > maxSeedForFamily(family)) throw new Error(`tiling geometry has invalid seed ${seed} for family ${family}`);
  if (generation > maxGenerationForFamilyId(family)) throw new Error(`tiling geometry has invalid generation ${generation} for family ${family}`);
  const minTileBytes = 2 + 3 * 8;
  if (tileCount > Math.floor((buffer.byteLength - offset) / minTileBytes)) {
    throw new Error(`tiling geometry tile count exceeds buffer length: ${tileCount}`);
  }
  const tiles: Tile[] = new Array<Tile>(tileCount);
  for (let i = 0; i < tileCount; i++) {
    if (offset + 2 > buffer.byteLength) throw new Error(`tiling geometry truncated before tile ${i}`);
    const vcount = view.getUint8(offset++);
    const type = view.getUint8(offset++);
    if (vcount < 3) throw new Error(`tiling geometry tile ${i} has invalid vertex count ${vcount}`);
    if (vcount > MAX_TILE_VERTEX_COUNT) throw new Error(`tiling geometry tile ${i} has too many vertices ${vcount}`);
    if (offset + vcount * 8 > buffer.byteLength) throw new Error(`tiling geometry truncated in tile ${i}`);
    const verts: Point[] = new Array<Point>(vcount);
    for (let j = 0; j < vcount; j++) {
      const x = view.getFloat32(offset, true);
      const y = view.getFloat32(offset + 4, true);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`tiling geometry tile ${i} vertex ${j} is non-finite`);
      verts[j] = [x, y];
      offset += 8;
    }
    validateParsedTile(verts, i);
    tiles[i] = { type, verts };
  }
  if (offset !== buffer.byteLength) throw new Error(`tiling geometry has ${buffer.byteLength - offset} trailing byte(s)`);
  return { family, seed, generation, tiles };
}

function validateParsedTile(verts: Point[], tileIndex: number): void {
  if (Math.abs(signedArea(verts)) <= AREA_EPS) {
    throw new Error(`tiling geometry tile ${tileIndex} has degenerate area`);
  }
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]!;
    const b = verts[(i + 1) % verts.length]!;
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= SEGMENT_EPS) {
      throw new Error(`tiling geometry tile ${tileIndex} has duplicate adjacent vertices`);
    }
  }
  for (let i = 0; i < verts.length; i++) {
    const a0 = verts[i]!;
    const a1 = verts[(i + 1) % verts.length]!;
    for (let j = i + 1; j < verts.length; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === verts.length - 1);
      if (adjacent) continue;
      const b0 = verts[j]!;
      const b1 = verts[(j + 1) % verts.length]!;
      if (segmentsIntersect(a0, a1, b0, b1)) {
        throw new Error(`tiling geometry tile ${tileIndex} has crossing polygon edges`);
      }
    }
  }
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const eps = SEGMENT_EPS;
  if (
    Math.max(a[0], b[0]) + eps < Math.min(c[0], d[0])
    || Math.max(c[0], d[0]) + eps < Math.min(a[0], b[0])
    || Math.max(a[1], b[1]) + eps < Math.min(c[1], d[1])
    || Math.max(c[1], d[1]) + eps < Math.min(a[1], b[1])
  ) return false;
  const o1 = orient2(a, b, c);
  const o2 = orient2(a, b, d);
  const o3 = orient2(c, d, a);
  const o4 = orient2(c, d, b);
  if (Math.abs(o1) <= eps && pointOnSegment(a, b, c)) return true;
  if (Math.abs(o2) <= eps && pointOnSegment(a, b, d)) return true;
  if (Math.abs(o3) <= eps && pointOnSegment(c, d, a)) return true;
  if (Math.abs(o4) <= eps && pointOnSegment(c, d, b)) return true;
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function orient2(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointOnSegment(a: Point, b: Point, p: Point): boolean {
  const eps = SEGMENT_EPS;
  return p[0] >= Math.min(a[0], b[0]) - eps
    && p[0] <= Math.max(a[0], b[0]) + eps
    && p[1] >= Math.min(a[1], b[1]) - eps
    && p[1] <= Math.max(a[1], b[1]) + eps;
}

export function buildMeshGeometry(patch: Patch, settings: Settings, customColors: Oklch[] | null = null, window: TilingWindow | null = null): GeometryBuild {
  const activePatch = windowPatchForView(patch, window);
  const colorMode = intSetting(settings, 'color_mode', 0, 3);
  const colorCount = intSetting(settings, 'color_count', 2, MAX_COLORS);
  // color_spread is a 0..100% span control over the already-defined palette
  // slots. It never changes slot colors; it only controls how far bucket mapping
  // reaches across the available Slots range.
  const colorSpread = intSetting(settings, 'color_spread', 0, 100);
  const preset = intSetting(settings, 'preset', 0, MAX_PALETTE_PRESET);
  const colorSpectral = intSetting(settings, 'color_spectral', 0, 100) / 100;
  const palette = buildPalette(preset, colorCount, customColors, colorSpectral);
  const classes = classify(activePatch.tiles, activePatch.family, colorMode, colorCount);
  const relief = averageTileRadius(activePatch.tiles) * 0.34;
  const spec = familySpec(activePatch.family);
  const maxType = Math.max(1, typeBucketCount(activePatch.tiles, activePatch.family, spec) - 1);
  const rings = tileRings(activePatch.tiles, spec);
  const projector = createProjector(settings);
  const snap = createVertexSnapper(projector.enabled ? 1e-5 : 1e-7);
  // Subdivision applies in BOTH projections. It was originally gated to Poincaré
  // (only the curved projection needed it), but the per-vertex surface displacement
  // (undulate/relief/field) needs the extra vertices to bend smoothly in Euclidean
  // too — gating it there left flat-mode undulation coarse no matter the setting.
  const spectreDetail = spectreMeshDetailForPatch(activePatch.tiles, activePatch.family);
  const roofMap = familySupportsWieringaRoof(activePatch.family) && intSetting(settings, 'surface_relief_mode', 0, 1) === 1
    ? p3WieringaRoofMap(activePatch, relief * WIERINGA_ROOF_RELIEF_SCALE)
    : null;
  // #2 refinement resamples the analytic relief field per fill child for the
  // multi-sided non-Spectre path. Off (default) = today's linear baking.
  const facetRefine = intSetting(settings, 'facet_refine', 0, 1) === 1 && activePatch.family !== SPECTRE_FAMILY_ID;
  const sourceTriCount = roofMap ? roofSourceTriangleCount(activePatch.tiles, roofMap) : patchSourceTriangleCount(activePatch.tiles, activePatch.family, spectreDetail);
  const fillSub = adaptiveFillSub(settings, activePatch, sourceTriCount);

  const triCount = sourceTriCount * fillSub * fillSub;
  const vertexCount = triCount * 3;
  if (vertexCount > MAX_FILL_VERTEX_COUNT) {
    throw new Error(`tiling mesh exceeds vertex budget: ${vertexCount} > ${MAX_FILL_VERTEX_COUNT}`);
  }
  const position = new Float32Array(vertexCount * 3);
  const color = new Float32Array(vertexCount * 3);
  const paletteSlot = new Float32Array(vertexCount);
  const topologyPaletteColor = new Float32Array(vertexCount * 3);
  const tileType = new Float32Array(vertexCount);
  const tileRing = new Float32Array(vertexCount);
  const tileOrient = new Float32Array(vertexCount * 2);
  const tileCenter = new Float32Array(vertexCount * 2);
  const tileRelief = new Float32Array(vertexCount);
  const tileReliefSlope = new Float32Array(vertexCount * 2);
  const tileEdgeBary = new Float32Array(vertexCount * 3);
  const tileEdgeDistance = new Float32Array(vertexCount * 3);
  const tileShape = new Float32Array(vertexCount);
  const tileScale = new Float32Array(vertexCount);
  const tileLocal = new Float32Array(vertexCount * 2);
  const tileTopology = new Float32Array(vertexCount * 4);
  const topologyScalars = tileTopologyScalars(activePatch, rings);

  let cursor = 0;
  for (let tileIndex = 0; tileIndex < activePatch.tiles.length; tileIndex++) {
    const tile = activePatch.tiles[tileIndex]!;
    const sourceVerts = sourceBoundaryVerts(tile, activePatch.family, spectreDetail);
    const spectreFrame = spectreFrameForTile(tile, activePatch.family, projector, snap);
    const center = spectreFrame?.sourceCenter ?? centroid(sourceVerts);
    const projectedCenter = spectreFrame?.center ?? snap(projector.map(center[0], center[1]));
    const scaleValue = spectreFrame?.scale ?? projectedTileRadius(sourceVerts, center, projector, snap);
    const orient = spectreFrame?.orient ?? orientation(tile, activePatch.family);
    const typeValue = tile.type / maxType;
    const ringValue = rings[tileIndex] ?? 0;
    const topologyValue: Point = [
      topologyScalars.degree[tileIndex] ?? 0,
      topologyScalars.motif[tileIndex] ?? 0,
    ];
    const topologyExtra: Point = [
      topologyScalars.relaxed[tileIndex] ?? 0,
      topologyScalars.biharmonic[tileIndex] ?? 0,
    ];
    const paletteIndex = bucketToPaletteIdx(classes.bucket[tileIndex] ?? 0, classes.numBuckets, colorCount, colorSpread);
    const rgb = paletteLinearRgbAt(palette, paletteIndex);
    const topologyPaletteIndex = topologyPaletteSlot(
      paletteIndex,
      colorCount,
      topologyValue[0],
      topologyValue[1],
      topologyExtra[0],
      topologyExtra[1],
      ringValue,
    );
    const topologyRgb = paletteLinearRgbAt(palette, topologyPaletteIndex);
    const centerZ = relief * (0.65 + ringValue * 0.35 + typeValue * 0.18);
    const roof = roofMap?.get(tile) ?? null;
    const shapeValue = roof || activePatch.family === SPECTRE_FAMILY_ID ? 1 : 0;
    const reliefValue = activePatch.family === SPECTRE_FAMILY_ID ? centerZ : null;
    const reliefReference = activePatch.family === SPECTRE_FAMILY_ID
      ? spectreReliefReference(center, sourceVerts)
      : 1;
    const reliefSampler = activePatch.family === SPECTRE_FAMILY_ID
      ? (p: Point): SurfaceSample => spectreReliefSampleAt(p, sourceVerts, centerZ, reliefReference)
      : facetRefine && !roof
        ? (p: Point): SurfaceSample => tileReliefSampleAt(p, center, sourceVerts, centerZ, averageSegmentLength(sourceVerts) * 0.01)
        : null;
    // Tiles come in both orientations; Spectre's generated rings can also create
    // local triangles whose winding differs from the tile outline. emitTriangle
    // normalizes each child triangle, using this only for degenerate fallback.
    const flip = signedArea(sourceVerts) < 0;
    const sourceTriangles = roof ? roofSourceTriangles(tile, roof) : tileSourceTriangles(tile, center, centerZ, activePatch.family, spectreDetail);
    for (const tri of sourceTriangles) {
      const bakedSlope: Point = roof ? slopeForSourceTriangle(tri) : [0, 0];
      cursor = emitTriangle(
        cursor,
        { position, color, paletteSlot, topologyPaletteColor, tileType, tileRing, tileOrient, tileCenter, tileRelief, tileReliefSlope, tileEdgeBary, tileEdgeDistance, tileShape, tileScale, tileLocal, tileTopology },
        projector,
        snap,
        fillSub,
        tri.a,
        tri.b,
        tri.c,
        rgb,
        topologyRgb,
        typeValue,
        ringValue,
        orient,
        projectedCenter,
        paletteIndex,
        flip,
        reliefSampler,
        reliefValue,
        shapeValue,
        scaleValue,
        sourceAtlasFrame(sourceVerts, center, orient),
        bakedSlope,
        tri.edgeMask,
        topologyValue,
        topologyExtra,
      );
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('color', new BufferAttribute(color, 3));
  geometry.setAttribute('paletteSlot', new BufferAttribute(paletteSlot, 1));
  setFillCustomAttributes(geometry, tileType, tileRing, tileOrient, tileCenter, tileRelief, tileReliefSlope, tileEdgeBary, tileEdgeDistance, tileShape, tileScale, tileLocal, tileTopology, topologyPaletteColor);
  // The WebGPU material supplies its own normalNode. Do not emit geometry normals:
  // they would only feed Three's geometry-roughness path and consume another
  // WebGPU vertex-buffer slot.
  geometry.computeBoundingSphere();
  applyPatchBoundingSphere(geometry, patch);
  const edgeGeometry = buildEdgeGeometryForPatch(activePatch, settings);
  const overlayGeometry = sourceOverlayActiveForStyle(activePatch.family, intSetting(settings, 'ornament_style', 0, 4))
    ? buildOverlayGeometryForPatch(activePatch, settings)
    : null;
  return { geometry, edgeGeometry, overlayGeometry, palette };
}

export function buildPaletteSlotsForPatch(
  patch: Patch,
  settings: Settings,
  customColors: Oklch[] | null = null,
  window: TilingWindow | null = null,
): PaletteSlotBuild {
  const activePatch = windowPatchForView(patch, window);
  const colorMode = intSetting(settings, 'color_mode', 0, 3);
  const colorCount = intSetting(settings, 'color_count', 2, MAX_COLORS);
  const colorSpread = intSetting(settings, 'color_spread', 0, 100);
  const preset = intSetting(settings, 'preset', 0, MAX_PALETTE_PRESET);
  const colorSpectral = intSetting(settings, 'color_spectral', 0, 100) / 100;
  const palette = buildPalette(preset, colorCount, customColors, colorSpectral);
  const classes = classify(activePatch.tiles, activePatch.family, colorMode, colorCount);
  const spec = familySpec(activePatch.family);
  const rings = tileRings(activePatch.tiles, spec);
  const topologyScalars = tileTopologyScalars(activePatch, rings);
  const spectreDetail = spectreMeshDetailForPatch(activePatch.tiles, activePatch.family);
  const relief = averageTileRadius(activePatch.tiles) * 0.34;
  const roofMap = familySupportsWieringaRoof(activePatch.family) && intSetting(settings, 'surface_relief_mode', 0, 1) === 1
    ? p3WieringaRoofMap(activePatch, relief * WIERINGA_ROOF_RELIEF_SCALE)
    : null;
  const sourceTriCount = roofMap ? roofSourceTriangleCount(activePatch.tiles, roofMap) : patchSourceTriangleCount(activePatch.tiles, activePatch.family, spectreDetail);
  const fillSub = adaptiveFillSub(settings, activePatch, sourceTriCount);
  const vertexCount = sourceTriCount * fillSub * fillSub * 3;
  if (vertexCount > MAX_FILL_VERTEX_COUNT) {
    throw new Error(`tiling palette exceeds vertex budget: ${vertexCount} > ${MAX_FILL_VERTEX_COUNT}`);
  }
  const paletteSlot = new Float32Array(vertexCount);
  const topologyPaletteColor = new Float32Array(vertexCount * 3);
  let cursor = 0;
  for (let tileIndex = 0; tileIndex < activePatch.tiles.length; tileIndex++) {
    const tile = activePatch.tiles[tileIndex]!;
    const roof = roofMap?.get(tile) ?? null;
    const sourceCount = roof ? roofSourceTriangles(tile, roof).length : sourceTriangleCount(tile, sourceCenterForTile(tile, activePatch.family), activePatch.family, spectreDetail);
    const count = sourceCount * fillSub * fillSub * 3;
    const paletteIndex = bucketToPaletteIdx(classes.bucket[tileIndex] ?? 0, classes.numBuckets, colorCount, colorSpread);
    const topologyPaletteIndex = topologyPaletteSlot(
      paletteIndex,
      colorCount,
      topologyScalars.degree[tileIndex] ?? 0,
      topologyScalars.motif[tileIndex] ?? 0,
      topologyScalars.relaxed[tileIndex] ?? 0,
      topologyScalars.biharmonic[tileIndex] ?? 0,
      rings[tileIndex] ?? 0,
    );
    const topologyRgb = paletteLinearRgbAt(palette, topologyPaletteIndex);
    paletteSlot.fill(paletteIndex, cursor, cursor + count);
    for (let v = cursor; v < cursor + count; v++) {
      const p = v * 3;
      topologyPaletteColor[p] = topologyRgb[0];
      topologyPaletteColor[p + 1] = topologyRgb[1];
      topologyPaletteColor[p + 2] = topologyRgb[2];
    }
    cursor += count;
  }
  return { paletteSlot, topologyPaletteColor, palette };
}

function familySpec(family: number): FamilySpec {
  return FAMILY_SPECS_BY_ID[family] ?? FAMILY_SPECS_BY_ID[0]!;
}

function clampRgb(rgb: Point3): Point3 {
  return [
    Math.max(0, Math.min(1, rgb[0])),
    Math.max(0, Math.min(1, rgb[1])),
    Math.max(0, Math.min(1, rgb[2])),
  ];
}

function setFillCustomAttributes(
  geometry: BufferGeometry,
  tileType: Float32Array,
  tileRing: Float32Array,
  tileOrient: Float32Array,
  tileCenter: Float32Array,
  tileRelief: Float32Array,
  tileReliefSlope: Float32Array,
  tileEdgeBary: Float32Array,
  tileEdgeDistance: Float32Array,
  tileShape: Float32Array,
  tileScale: Float32Array,
  tileLocal: Float32Array,
  tileTopology: Float32Array,
  topologyPaletteColor: Float32Array,
): void {
  const count = tileType.length;
  const stride = 26;
  const packed = new Float32Array(count * stride);
  for (let i = 0; i < count; i++) {
    const base = i * stride;
    const pair = i * 2;
    packed[base] = tileType[i] ?? 0;
    packed[base + 1] = tileRing[i] ?? 0;
    packed[base + 2] = tileOrient[pair] ?? 1;
    packed[base + 3] = tileOrient[pair + 1] ?? 0;
    packed[base + 4] = tileCenter[pair] ?? 0;
    packed[base + 5] = tileCenter[pair + 1] ?? 0;
    packed[base + 6] = tileRelief[i] ?? 0;
    packed[base + 7] = tileShape[i] ?? 0;
    packed[base + 8] = tileScale[i] ?? 1;
    packed[base + 9] = tileReliefSlope[pair] ?? 0;
    packed[base + 10] = tileReliefSlope[pair + 1] ?? 0;
    packed[base + 11] = tileLocal[pair] ?? 0;
    packed[base + 12] = tileLocal[pair + 1] ?? 0;
    const triple = i * 3;
    packed[base + 13] = tileEdgeBary[triple] ?? 1;
    packed[base + 14] = tileEdgeBary[triple + 1] ?? 1;
    packed[base + 15] = tileEdgeBary[triple + 2] ?? 1;
    packed[base + 16] = tileEdgeDistance[triple] ?? 1;
    packed[base + 17] = tileEdgeDistance[triple + 1] ?? 1;
    packed[base + 18] = tileEdgeDistance[triple + 2] ?? 1;
    const quad = i * 4;
    packed[base + 19] = tileTopology[quad] ?? 0;
    packed[base + 20] = tileTopology[quad + 1] ?? 0;
    packed[base + 21] = tileTopology[quad + 2] ?? 0;
    packed[base + 22] = tileTopology[quad + 3] ?? 0;
    const color = i * 3;
    packed[base + 23] = topologyPaletteColor[color] ?? 1;
    packed[base + 24] = topologyPaletteColor[color + 1] ?? 1;
    packed[base + 25] = topologyPaletteColor[color + 2] ?? 1;
  }
  const data = new InterleavedBuffer(packed, stride);
  geometry.setAttribute('tileType', new InterleavedBufferAttribute(data, 1, 0));
  geometry.setAttribute('tileRing', new InterleavedBufferAttribute(data, 1, 1));
  geometry.setAttribute('tileOrient', new InterleavedBufferAttribute(data, 2, 2));
  geometry.setAttribute('tileCenter', new InterleavedBufferAttribute(data, 2, 4));
  geometry.setAttribute('tileRelief', new InterleavedBufferAttribute(data, 1, 6));
  geometry.setAttribute('tileShape', new InterleavedBufferAttribute(data, 1, 7));
  geometry.setAttribute('tileScale', new InterleavedBufferAttribute(data, 1, 8));
  geometry.setAttribute('tileReliefSlope', new InterleavedBufferAttribute(data, 2, 9));
  geometry.setAttribute('tileLocal', new InterleavedBufferAttribute(data, 2, 11));
  geometry.setAttribute('uv', new InterleavedBufferAttribute(data, 2, 11));
  geometry.setAttribute('tileEdgeBary', new InterleavedBufferAttribute(data, 3, 13));
  geometry.setAttribute('tileEdgeDistance', new InterleavedBufferAttribute(data, 3, 16));
  geometry.setAttribute('tileTopology', new InterleavedBufferAttribute(data, 4, 19));
  geometry.setAttribute('topologyPaletteColor', new InterleavedBufferAttribute(data, 3, 23));
}

function setEdgeCustomAttributes(
  geometry: BufferGeometry,
  tileType: Float32Array,
  tileRing: Float32Array,
  tileOrient: Float32Array,
  tileCenter: Float32Array,
  tileRelief: Float32Array,
  tileShape: Float32Array,
  tileScale: Float32Array,
  tileLocal: Float32Array,
  tileTopology: Float32Array,
  edgeSide: Float32Array,
  edgeSlope: Float32Array,
): void {
  const count = tileRing.length;
  const stride = 18;
  const packed = new Float32Array(count * stride);
  for (let i = 0; i < count; i++) {
    const base = i * stride;
    const pair = i * 2;
    const quad = i * 4;
    packed[base] = tileType[i] ?? 0;
    packed[base + 1] = tileRing[i] ?? 0;
    packed[base + 2] = tileOrient[pair] ?? 1;
    packed[base + 3] = tileOrient[pair + 1] ?? 0;
    packed[base + 4] = tileCenter[pair] ?? 0;
    packed[base + 5] = tileCenter[pair + 1] ?? 0;
    packed[base + 6] = tileRelief[i] ?? 0;
    packed[base + 7] = tileShape[i] ?? 0;
    packed[base + 8] = tileScale[i] ?? 1;
    packed[base + 9] = tileLocal[pair] ?? 0;
    packed[base + 10] = tileLocal[pair + 1] ?? 0;
    packed[base + 11] = tileTopology[quad] ?? 0;
    packed[base + 12] = tileTopology[quad + 1] ?? 0;
    packed[base + 13] = tileTopology[quad + 2] ?? 0;
    packed[base + 14] = tileTopology[quad + 3] ?? 0;
    packed[base + 15] = edgeSide[i] ?? 1;
    packed[base + 16] = edgeSlope[pair] ?? 0;
    packed[base + 17] = edgeSlope[pair + 1] ?? 0;
  }
  const data = new InterleavedBuffer(packed, stride);
  geometry.setAttribute('tileType', new InterleavedBufferAttribute(data, 1, 0));
  geometry.setAttribute('tileRing', new InterleavedBufferAttribute(data, 1, 1));
  geometry.setAttribute('tileOrient', new InterleavedBufferAttribute(data, 2, 2));
  geometry.setAttribute('tileCenter', new InterleavedBufferAttribute(data, 2, 4));
  geometry.setAttribute('tileRelief', new InterleavedBufferAttribute(data, 1, 6));
  geometry.setAttribute('tileShape', new InterleavedBufferAttribute(data, 1, 7));
  geometry.setAttribute('tileScale', new InterleavedBufferAttribute(data, 1, 8));
  geometry.setAttribute('tileLocal', new InterleavedBufferAttribute(data, 2, 9));
  geometry.setAttribute('tileTopology', new InterleavedBufferAttribute(data, 4, 11));
  geometry.setAttribute('edgeSide', new InterleavedBufferAttribute(data, 1, 15));
  geometry.setAttribute('edgeSlope', new InterleavedBufferAttribute(data, 2, 16));
}

// Signed area of a polygon (shoelace). Positive = CCW vertex order.
function signedArea(verts: Point[]): number {
  let area = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]!;
    const b = verts[(i + 1) % verts.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area * 0.5;
}

function patchSourceTriangleCount(
  tiles: readonly Tile[],
  family: number,
  spectreDetail: SpectreMeshDetail = DEFAULT_SPECTRE_MESH_DETAIL,
): number {
  let count = 0;
  for (const tile of tiles) count += sourceTriangleCount(tile, sourceCenterForTile(tile, family), family, spectreDetail);
  return count;
}

function sourceTriangleCount(
  tile: Tile,
  center: Point,
  family: number,
  spectreDetail: SpectreMeshDetail = DEFAULT_SPECTRE_MESH_DETAIL,
): number {
  const verts = sourceBoundaryVerts(tile, family, spectreDetail);
  if (isSpectreCurveTile(tile, family)) return cachedSpectreReliefBandTriangles(tile, verts, center, spectreDetail).length;
  const sourceCenter = center;
  const plan = family === SPECTRE_FAMILY_ID
    ? { centroidFan: false, ears: triangulatePolygonIndices(verts) }
    : tileTriangulationPlan(tile, sourceCenter);
  if (plan.centroidFan) return verts.length;
  if (family === SPECTRE_FAMILY_ID) return plan.ears.length;
  let count = 0;
  for (const [ia, ib, ic] of plan.ears) {
    count += boundaryEdgeIndex(ia, ib, verts.length) >= 0 ? 1 : 2;
    count += boundaryEdgeIndex(ib, ic, verts.length) >= 0 ? 1 : 2;
    count += boundaryEdgeIndex(ic, ia, verts.length) >= 0 ? 1 : 2;
  }
  return count;
}

function logicalEdgeIndex(edge: number, count: number, family: number): number {
  if (family !== SPECTRE_FAMILY_ID || count % SPECTRE_LOGICAL_SIDE_COUNT !== 0) return edge;
  return Math.floor(edge / (count / SPECTRE_LOGICAL_SIDE_COUNT));
}

function boundaryEdgesForTriangle(ia: number, ib: number, ic: number, count: number, family: number): number[] {
  const edges: number[] = [];
  const add = (first: number, second: number): void => {
    const edge = boundaryEdgeIndex(first, second, count);
    if (edge >= 0) edges.push(logicalEdgeIndex(edge, count, family));
  };
  add(ia, ib);
  add(ib, ic);
  add(ic, ia);
  return edges;
}

function boundaryEdgeMaskForTriangle(ia: number, ib: number, ic: number, count: number): EdgeMask {
  return [
    boundaryEdgeIndex(ia, ib, count) >= 0,
    boundaryEdgeIndex(ib, ic, count) >= 0,
    boundaryEdgeIndex(ic, ia, count) >= 0,
  ];
}

function emptyEdgeMask(): EdgeMask {
  return [false, false, false];
}

function edgeBaryRows(mask: EdgeMask): [EdgeBary, EdgeBary, EdgeBary] {
  const a: EdgeBary = [1, 0, 0];
  const b: EdgeBary = [0, 1, 0];
  const c: EdgeBary = [0, 0, 1];
  if (!mask[1]) {
    a[0] = 1;
    b[0] = 1;
    c[0] = 1;
  }
  if (!mask[2]) {
    a[1] = 1;
    b[1] = 1;
    c[1] = 1;
  }
  if (!mask[0]) {
    a[2] = 1;
    b[2] = 1;
    c[2] = 1;
  }
  return [a, b, c];
}

function interpolateEdgeBary(a: EdgeBary, b: EdgeBary, c: EdgeBary, fa: number, fb: number, fc: number): EdgeBary {
  return [
    fa * a[0] + fb * b[0] + fc * c[0],
    fa * a[1] + fb * b[1] + fc * c[1],
    fa * a[2] + fb * b[2] + fc * c[2],
  ];
}

function point3FromPoint(p: Point, relief = 0): Point3 {
  return [p[0], p[1], relief];
}

function spectreEdgeInwardNormal(a: Point, b: Point, ccw: boolean): Point {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len <= SEGMENT_EPS) return [0, 0];
  return ccw ? [-dy / len, dx / len] : [dy / len, -dx / len];
}

function spectreVertexInwardNormal(verts: Point[], index: number, ccw: boolean): Point {
  const count = verts.length;
  const prev = spectreEdgeInwardNormal(verts[(index + count - 1) % count]!, verts[index]!, ccw);
  const next = spectreEdgeInwardNormal(verts[index]!, verts[(index + 1) % count]!, ccw);
  const nx = prev[0] + next[0];
  const ny = prev[1] + next[1];
  const len = Math.hypot(nx, ny);
  if (len > SEGMENT_EPS) return [nx / len, ny / len];
  return next;
}

function spectreOffsetRingPoint(p: Point, normal: Point, center: Point, distance: number, verts: Point[]): Point {
  const centerDistance = Math.hypot(center[0] - p[0], center[1] - p[1]);
  if (centerDistance <= SEGMENT_EPS || distance <= SEGMENT_EPS) return [p[0], p[1]];
  const normalLen = Math.hypot(normal[0], normal[1]);
  if (normalLen <= SEGMENT_EPS) return lerp2(p, center, Math.min(0.5, distance / centerDistance));
  let step = Math.min(distance, centerDistance * 0.48);
  for (let attempt = 0; attempt < 4; attempt++) {
    const candidate: Point = [
      p[0] + normal[0] / normalLen * step,
      p[1] + normal[1] / normalLen * step,
    ];
    if (pointInPolygon(candidate, verts)) return candidate;
    step *= 0.5;
  }
  let t = Math.min(0.48, distance / centerDistance);
  for (let attempt = 0; attempt < 4; attempt++) {
    const candidate = lerp2(p, center, t);
    if (pointInPolygon(candidate, verts)) return candidate;
    t *= 0.5;
  }
  return [p[0], p[1]];
}

function spectreReliefRings(verts: Point[], center: Point): Point[][] {
  const reference = spectreReliefReference(center, verts);
  const edgeBand = Math.max(reference * SPECTRE_EDGE_FADE_FRACTION, SEGMENT_EPS);
  const ccw = signedArea(verts) >= 0;
  return SPECTRE_RELIEF_RING_FRACTIONS.map((fraction) => {
    if (fraction <= 0) return verts.map((p) => [p[0], p[1]]);
    return verts.map((p, index) => spectreOffsetRingPoint(
      p,
      spectreVertexInwardNormal(verts, index, ccw),
      center,
      edgeBand * fraction,
      verts,
    ));
  });
}

function spectreRadialCapRings(inner: Point[], center: Point, bands: number): Point[][] {
  const count = Math.max(1, bands);
  const rings: Point[][] = [];
  for (let band = 1; band <= count; band++) {
    const t = Math.sqrt(band / count);
    rings.push(inner.map((p) => lerp2(center, p, t)));
  }
  return rings;
}

function orientPoint3XY(a: Point3, b: Point3, c: Point3): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function distPoint3XYSq(a: Point3, b: Point3): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return dx * dx + dy * dy;
}

function triangleQualityPoint3XY(a: Point3, b: Point3, c: Point3): number {
  const area = Math.abs(orientPoint3XY(a, b, c));
  if (area <= AREA_EPS) return Number.NEGATIVE_INFINITY;
  const longest = Math.max(
    distPoint3XYSq(a, b),
    distPoint3XYSq(b, c),
    distPoint3XYSq(c, a),
    SEGMENT_EPS,
  );
  return area / longest;
}

function splitQuadOnBD(a: Point3, b: Point3, c: Point3, d: Point3, alternateTie: boolean): boolean {
  const acScore = Math.min(
    triangleQualityPoint3XY(a, b, c),
    triangleQualityPoint3XY(a, c, d),
  );
  const bdScore = Math.min(
    triangleQualityPoint3XY(a, b, d),
    triangleQualityPoint3XY(b, c, d),
  );
  if (bdScore > acScore + AREA_EPS) return true;
  if (acScore > bdScore + AREA_EPS) return false;
  return alternateTie;
}

function spectreReliefBandTriangles(
  verts: Point[],
  center: Point,
  spectreDetail: SpectreMeshDetail,
): TileSourceTriangle[] {
  if (verts.length < 3) return [];
  const rings = spectreReliefRings(verts, center);
  const inner = rings[rings.length - 1]!;
  const capRings = spectreRadialCapRings(inner, center, spectreDetail.radialBands);
  const triangles: TileSourceTriangle[] = [];
  const edgeCount = verts.length;
  const addTriangle = (a: Point3, b: Point3, c: Point3, edges: number[], edgeMask: EdgeMask): void => {
    if (Math.abs(orient2([a[0], a[1]], [b[0], b[1]], [c[0], c[1]])) <= AREA_EPS) return;
    triangles.push({ a, b, c, edges, edgeMask });
  };
  const addQuad = (a: Point3, b: Point3, c: Point3, d: Point3, edges: number[], alternateTie: boolean): void => {
    if (splitQuadOnBD(a, b, c, d, alternateTie)) {
      addTriangle(a, b, d, edges, edges.length > 0 ? [true, false, false] : emptyEdgeMask());
      addTriangle(b, c, d, edges, emptyEdgeMask());
      return;
    }
    addTriangle(a, b, c, edges, edges.length > 0 ? [true, false, false] : emptyEdgeMask());
    addTriangle(a, c, d, edges, emptyEdgeMask());
  };
  for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex++) {
    const outer = rings[ringIndex]!;
    const innerRing = rings[ringIndex + 1]!;
    for (let i = 0; i < edgeCount; i++) {
      const next = (i + 1) % edgeCount;
      const edges = ringIndex === 0 ? [logicalEdgeIndex(i, edgeCount, SPECTRE_FAMILY_ID)] : [];
      addQuad(
        point3FromPoint(outer[i]!),
        point3FromPoint(outer[next]!),
        point3FromPoint(innerRing[next]!),
        point3FromPoint(innerRing[i]!),
        edges,
        (ringIndex + i) % 2 === 1,
      );
    }
  }
  for (let ringIndex = 0; ringIndex < capRings.length; ringIndex++) {
    const outer = capRings[ringIndex]!;
    const innerRing = ringIndex === 0 ? null : capRings[ringIndex - 1]!;
    for (let i = 0; i < edgeCount; i++) {
      const next = (i + 1) % edgeCount;
      if (innerRing === null) {
        const central = edgeCount <= SPECTRE_LOGICAL_SIDE_COUNT * 2
          ? triangulatePolygonIndicesByArea(outer)
          : null;
        if (central) {
          for (const [ia, ib, ic] of central) {
            addTriangle(point3FromPoint(outer[ia]!), point3FromPoint(outer[ib]!), point3FromPoint(outer[ic]!), [], emptyEdgeMask());
          }
          break;
        }
        addTriangle(point3FromPoint(center), point3FromPoint(outer[i]!), point3FromPoint(outer[next]!), [], emptyEdgeMask());
        continue;
      }
      addQuad(
        point3FromPoint(innerRing[i]!),
        point3FromPoint(outer[i]!),
        point3FromPoint(outer[next]!),
        point3FromPoint(innerRing[next]!),
        [],
        (ringIndex + i) % 2 === 1,
      );
    }
  }
  return triangles;
}

function cachedSpectreReliefBandTriangles(
  tile: Tile,
  verts: Point[],
  center: Point,
  spectreDetail: SpectreMeshDetail,
): TileSourceTriangle[] {
  const key = `${spectreDetail.key}:${center[0]}:${center[1]}`;
  const entries = spectreTriangleCache.get(tile);
  const existingIndex = entries?.findIndex(entry => entry.key === key) ?? -1;
  if (entries && existingIndex >= 0) {
    const [entry] = entries.splice(existingIndex, 1);
    entries.unshift(entry!);
    return entry!.triangles;
  }
  const triangles = spectreReliefBandTriangles(verts, center, spectreDetail);
  const next = entries ?? [];
  next.unshift({ key, triangles });
  if (next.length > SPECTRE_TILE_CACHE_LIMIT) next.length = SPECTRE_TILE_CACHE_LIMIT;
  if (!entries) spectreTriangleCache.set(tile, next);
  return triangles;
}

function tileSourceTriangles(
  tile: Tile,
  center: Point,
  reliefApex: number,
  family: number,
  spectreDetail: SpectreMeshDetail = DEFAULT_SPECTRE_MESH_DETAIL,
): TileSourceTriangle[] {
  const verts = sourceBoundaryVerts(tile, family, spectreDetail);
  if (isSpectreCurveTile(tile, family)) return cachedSpectreReliefBandTriangles(tile, verts, center, spectreDetail);
  const sourceCenter = center;
  const plan = family === SPECTRE_FAMILY_ID
    ? { centroidFan: false, ears: triangulatePolygonIndices(verts) }
    : tileTriangulationPlan(tile, sourceCenter);
  if (plan.centroidFan) {
    return verts.map((_, edgeIndex) => {
      const edgeStart = verts[edgeIndex]!;
      const edgeEnd = verts[(edgeIndex + 1) % verts.length]!;
      const edge = logicalEdgeIndex(edgeIndex, verts.length, family);
      return {
        a: [sourceCenter[0], sourceCenter[1], reliefApex],
        b: [edgeStart[0], edgeStart[1], 0],
        c: [edgeEnd[0], edgeEnd[1], 0],
        edges: [edge],
        edgeMask: [false, true, false],
      };
    });
  }

  if (family === SPECTRE_FAMILY_ID) {
    return plan.ears.map(([ia, ib, ic]) => ({
      a: [verts[ia]![0], verts[ia]![1], 0],
      b: [verts[ib]![0], verts[ib]![1], 0],
      c: [verts[ic]![0], verts[ic]![1], 0],
      edges: boundaryEdgesForTriangle(ia, ib, ic, verts.length, family),
      edgeMask: boundaryEdgeMaskForTriangle(ia, ib, ic, verts.length),
    }));
  }

  const triangles: TileSourceTriangle[] = [];
  for (const [ia, ib, ic] of plan.ears) {
    const a = verts[ia]!;
    const b = verts[ib]!;
    const c = verts[ic]!;
    const localCenter: Point = [
      (a[0] + b[0] + c[0]) / 3,
      (a[1] + b[1] + c[1]) / 3,
    ];
    const localRelief = tileReliefAt(localCenter, sourceCenter, verts, reliefApex);
    const hub: Point3 = [localCenter[0], localCenter[1], localRelief];
    const add = (first: number, second: number): void => {
      const edge = boundaryEdgeIndex(first, second, verts.length);
      const a: Point3 = [verts[first]![0], verts[first]![1], 0];
      const b: Point3 = [verts[second]![0], verts[second]![1], 0];
      if (edge >= 0) {
        triangles.push({ a: hub, b: a, c: b, edges: [edge], edgeMask: [false, true, false] });
        return;
      }
      const mid: Point = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
      const mid3: Point3 = [mid[0], mid[1], tileReliefAt(mid, sourceCenter, verts, reliefApex)];
      triangles.push({ a: hub, b: a, c: mid3, edges: [], edgeMask: emptyEdgeMask() });
      triangles.push({ a: hub, b: mid3, c: b, edges: [], edgeMask: emptyEdgeMask() });
    };
    add(ia, ib);
    add(ib, ic);
    add(ic, ia);
  }
  return triangles;
}

function tileTriangulationPlan(tile: Tile, center: Point): TileTriangulationPlan {
  const cached = tileTriangulationCache.get(tile);
  if (cached) return cached;
  const plan = triangulationPlanForVerts(tile.verts, center);
  tileTriangulationCache.set(tile, plan);
  return plan;
}

function triangulationPlanForVerts(verts: Point[], center: Point): TileTriangulationPlan {
  return fanTriangulationContained(verts, center)
    ? { centroidFan: true, ears: [] }
    : { centroidFan: false, ears: triangulatePolygonIndices(verts) };
}

function fanTriangulationContained(verts: Point[], center: Point): boolean {
  if (!pointInPolygon(center, verts)) return false;
  for (let i = 0; i < verts.length; i++) {
    if (segmentCrossesPolygonBoundary(center, verts[i]!, verts, i)) return false;
  }
  return true;
}

function triangulatePolygonIndices(verts: Point[]): [number, number, number][] {
  if (verts.length < 3) throw new Error('cannot triangulate a polygon with fewer than 3 vertices');
  if (verts.length === 3) return [[0, 1, 2]];
  const area = signedArea(verts);
  if (Math.abs(area) <= AREA_EPS) throw new Error('cannot triangulate a degenerate polygon');
  const ccw = area > 0;
  const remaining = verts.map((_, index) => index);
  const triangles: [number, number, number][] = [];

  while (remaining.length > 3) {
    let earAt = -1;
    for (let i = 0; i < remaining.length; i++) {
      const ia = remaining[(i - 1 + remaining.length) % remaining.length]!;
      const ib = remaining[i]!;
      const ic = remaining[(i + 1) % remaining.length]!;
      if (!isConvexCorner(verts[ia]!, verts[ib]!, verts[ic]!, ccw)) continue;
      let blocked = false;
      for (const index of remaining) {
        if (index === ia || index === ib || index === ic) continue;
        if (pointInTriangle(verts[index]!, verts[ia]!, verts[ib]!, verts[ic]!, ccw)) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        triangles.push([ia, ib, ic]);
        earAt = i;
        break;
      }
    }
    if (earAt < 0) throw new Error('cannot triangulate a simple tile polygon');
    remaining.splice(earAt, 1);
  }

  triangles.push([remaining[0]!, remaining[1]!, remaining[2]!]);
  return triangles;
}

function triangulatePolygonIndicesByArea(verts: Point[]): [number, number, number][] | null {
  if (verts.length < 3) return null;
  if (verts.length === 3) return [[0, 1, 2]];
  const area = signedArea(verts);
  if (Math.abs(area) <= AREA_EPS) return null;
  const ccw = area > 0;
  const remaining = verts.map((_, index) => index);
  const triangles: [number, number, number][] = [];

  while (remaining.length > 3) {
    let earAt = -1;
    let bestScore = Infinity;
    let bestTriangle: [number, number, number] | null = null;
    for (let i = 0; i < remaining.length; i++) {
      const ia = remaining[(i - 1 + remaining.length) % remaining.length]!;
      const ib = remaining[i]!;
      const ic = remaining[(i + 1) % remaining.length]!;
      if (!isConvexCorner(verts[ia]!, verts[ib]!, verts[ic]!, ccw)) continue;
      let blocked = false;
      for (const index of remaining) {
        if (index === ia || index === ib || index === ic) continue;
        if (pointInTriangle(verts[index]!, verts[ia]!, verts[ib]!, verts[ic]!, ccw)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      const score = Math.abs(orient2(verts[ia]!, verts[ib]!, verts[ic]!));
      if (score < bestScore) {
        bestScore = score;
        earAt = i;
        bestTriangle = [ia, ib, ic];
      }
    }
    if (!bestTriangle || earAt < 0) return null;
    triangles.push(bestTriangle);
    remaining.splice(earAt, 1);
  }

  triangles.push([remaining[0]!, remaining[1]!, remaining[2]!]);
  return triangles;
}

function isConvexCorner(a: Point, b: Point, c: Point, ccw: boolean): boolean {
  const turn = orient2(a, b, c);
  return ccw ? turn > AREA_EPS : turn < -AREA_EPS;
}

function pointInTriangle(p: Point, a: Point, b: Point, c: Point, ccw: boolean): boolean {
  const ab = orient2(a, b, p);
  const bc = orient2(b, c, p);
  const ca = orient2(c, a, p);
  return ccw
    ? ab >= -CLIP_DISTANCE_EPS && bc >= -CLIP_DISTANCE_EPS && ca >= -CLIP_DISTANCE_EPS
    : ab <= CLIP_DISTANCE_EPS && bc <= CLIP_DISTANCE_EPS && ca <= CLIP_DISTANCE_EPS;
}

function pointInPolygon(p: Point, verts: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i, i++) {
    const a = verts[j]!;
    const b = verts[i]!;
    if (Math.abs(orient2(a, b, p)) <= SEGMENT_EPS && pointOnSegment(a, b, p)) return true;
    const crosses = (a[1] > p[1]) !== (b[1] > p[1]);
    if (crosses) {
      const x = a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
      if (x > p[0]) inside = !inside;
    }
  }
  return inside;
}

function segmentCrossesPolygonBoundary(start: Point, end: Point, verts: Point[], endIndex: number): boolean {
  for (let i = 0; i < verts.length; i++) {
    const j = (i + 1) % verts.length;
    if (i === endIndex || j === endIndex) continue;
    if (segmentsIntersect(start, end, verts[i]!, verts[j]!)) return true;
  }
  return false;
}

function boundaryEdgeIndex(first: number, second: number, count: number): number {
  if ((first + 1) % count === second) return first;
  if ((second + 1) % count === first) return second;
  return -1;
}

function tileReliefAt(p: Point, center: Point, verts: Point[], reliefApex: number): number {
  if (reliefApex <= 0) return 0;
  const boundaryDistance = distanceToPolygonBoundary(p, verts);
  const centerDistance = Math.hypot(p[0] - center[0], p[1] - center[1]);
  const denom = boundaryDistance + centerDistance;
  return denom > SEGMENT_EPS ? reliefApex * boundaryDistance / denom : 0;
}

// #2 Principled multi-sided-tile refinement (SurfLab 21ccnew improved n-gon
// face rule / 22remesh augmented refinement). The default multi-sided path bakes
// tileRelief linearly across the big centroid-fan source triangles, so relief
// reads as flat chords between the tile centre and its rim. Karciauskas & Peters'
// insight — the value of a principled refinement is a curvature-following, well
// graded facet interior, not the µ_n control-net stencil (whose off-face neighbour
// nodes do not exist for a tiling). So instead of adding triangles we resample the
// analytic relief field per fill-subdivision child and finite-difference its
// slope, exactly as the Spectre curved path already does. The source-triangle
// corners resample to their original heights (centre → apex, rim → 0), so seams
// stay watertight and the triangle count is unchanged — facet_refine = 0 is
// byte-identical to today. This is a reusable SurfaceSample producer, shared with
// the C++ renderer's tileDepthAt resample for parity.
function tileReliefSampleAt(p: Point, center: Point, verts: Point[], reliefApex: number, h: number): SurfaceSample {
  if (reliefApex <= 0) return { relief: 0, slopeX: 0, slopeY: 0 };
  const relief = tileReliefAt(p, center, verts, reliefApex);
  const step = Math.max(h, SEGMENT_EPS);
  const dx = tileReliefAt([p[0] + step, p[1]], center, verts, reliefApex)
    - tileReliefAt([p[0] - step, p[1]], center, verts, reliefApex);
  const dy = tileReliefAt([p[0], p[1] + step], center, verts, reliefApex)
    - tileReliefAt([p[0], p[1] - step], center, verts, reliefApex);
  const inv = 1 / (2 * step);
  return { relief, slopeX: -dx * inv, slopeY: -dy * inv };
}

function planarSlopeForTriangle(verts: Point[], heights: readonly [number, number, number]): Point {
  const a = verts[0]!;
  const b = verts[1]!;
  const c = verts[2]!;
  const v0x = b[0] - a[0];
  const v0y = b[1] - a[1];
  const v1x = c[0] - a[0];
  const v1y = c[1] - a[1];
  const denom = v0x * v1y - v1x * v0y;
  if (Math.abs(denom) <= AREA_EPS) return [0, 0];
  const db = heights[1] - heights[0];
  const dc = heights[2] - heights[0];
  const dzDx = (db * v1y - dc * v0y) / denom;
  const dzDy = (-db * v1x + dc * v0x) / denom;
  return [-dzDx, -dzDy];
}

function p3WieringaRoofMap(patch: Patch, amplitude: number): Map<Tile, WieringaRoofTile> | null {
  if (!familySupportsWieringaRoof(patch.family) || amplitude <= 0) return null;
  const topology = collectEdgeTopology(patch);
  const roof = new Map<Tile, WieringaRoofTile>();
  const records: WieringaRhombRecord[] = [];
  const apexForSide = (side: EdgeSide): { tile: Tile; apexIndex: number } | null => {
    const tile = patch.tiles[side.tileIndex];
    if (!tile || tile.verts.length !== 3) return null;
    const aKey = pointKey(side.a);
    const bKey = pointKey(side.b);
    for (let i = 0; i < tile.verts.length; i++) {
      const key = pointKey(tile.verts[i]!);
      if (key !== aKey && key !== bKey) return { tile, apexIndex: i };
    }
    return null;
  };
  for (const edge of topology.edgesByKey.values()) {
    if (edge.sides.length !== 2) continue;
    const first = edge.sides[0]!;
    const second = edge.sides[1]!;
    if (!isComposedRobinsonEdge(patch.family, first.kind, second.kind) || first.type !== second.type) continue;
    const firstApex = apexForSide(first);
    const secondApex = apexForSide(second);
    if (!firstApex || !secondApex) continue;
    const baseA = first.a;
    const baseB = first.b;
    const firstApexPoint = firstApex.tile.verts[firstApex.apexIndex]!;
    const secondApexPoint = secondApex.tile.verts[secondApex.apexIndex]!;
    records.push({ firstTile: firstApex.tile, secondTile: secondApex.tile, rhomb: [firstApexPoint, baseA, secondApexPoint, baseB] });
  }
  if (records.length === 0) return null;
  const planes = new Map<string, number>();
  const candidates: readonly (readonly number[])[] = [[2, 1, 2, 3], [3, 4, 3, 2]];
  const scoreCandidate = (record: WieringaRhombRecord, indices: readonly number[]): number => {
    let score = 0;
    for (let i = 0; i < record.rhomb.length; i++) {
      const existing = planes.get(pointKey(record.rhomb[i]!));
      if (existing === undefined) continue;
      score += existing === indices[i] ? 0 : Math.abs(existing - (indices[i] ?? existing)) + 16;
    }
    return score;
  };
  for (const record of records) {
    const first = candidates[0]!;
    const second = candidates[1]!;
    const firstScore = scoreCandidate(record, first);
    const secondScore = scoreCandidate(record, second);
    const selected = firstScore <= secondScore ? first : second;
    for (let i = 0; i < record.rhomb.length; i++) {
      const key = pointKey(record.rhomb[i]!);
      if (!planes.has(key)) planes.set(key, selected[i] ?? 2);
    }
  }
  const assign = (tile: Tile): void => {
    const heights: number[] = [];
    for (let i = 0; i < tile.verts.length; i++) {
      const plane = planes.get(pointKey(tile.verts[i]!)) ?? 2.5;
      heights[i] = (plane - 2.5) * amplitude;
    }
    roof.set(tile, { heights });
  };
  for (const tile of patch.tiles) {
    if (tile.verts.length === 3) assign(tile);
  }
  return roof;
}

function roofSourceTriangles(tile: Tile, roof: WieringaRoofTile): TileSourceTriangle[] {
  if (tile.verts.length !== 3) return [];
  const h0 = roof.heights[0] ?? 0;
  const h1 = roof.heights[1] ?? h0;
  const h2 = roof.heights[2] ?? h0;
  return [{
    a: [tile.verts[0]![0], tile.verts[0]![1], h0],
    b: [tile.verts[1]![0], tile.verts[1]![1], h1],
    c: [tile.verts[2]![0], tile.verts[2]![1], h2],
    edges: [0, 1, 2],
    edgeMask: [true, true, true],
  }];
}

function slopeForSourceTriangle(tri: TileSourceTriangle): Point {
  return planarSlopeForTriangle(
    [[tri.a[0], tri.a[1]], [tri.b[0], tri.b[1]], [tri.c[0], tri.c[1]]],
    [tri.a[2], tri.b[2], tri.c[2]],
  );
}

function roofSourceTriangleCount(tiles: readonly Tile[], roofMap: Map<Tile, WieringaRoofTile>): number {
  let count = 0;
  for (const tile of tiles) {
    const roof = roofMap.get(tile);
    count += roof ? roofSourceTriangles(tile, roof).length : 0;
  }
  return count;
}

function roofSampleAt(tile: Tile, roof: WieringaRoofTile, p: Point): SurfaceSample {
  const triangles = roofSourceTriangles(tile, roof);
  const tri = triangles[0];
  if (!tri) return { relief: 0, slopeX: 0, slopeY: 0 };
  const a: Point = [tri.a[0], tri.a[1]];
  const b: Point = [tri.b[0], tri.b[1]];
  const c: Point = [tri.c[0], tri.c[1]];
  const v0x = b[0] - a[0];
  const v0y = b[1] - a[1];
  const v1x = c[0] - a[0];
  const v1y = c[1] - a[1];
  const v2x = p[0] - a[0];
  const v2y = p[1] - a[1];
  const denom = v0x * v1y - v1x * v0y;
  const slope = slopeForSourceTriangle(tri);
  if (Math.abs(denom) <= AREA_EPS) return { relief: tri.a[2], slopeX: slope[0], slopeY: slope[1] };
  const u = (v2x * v1y - v1x * v2y) / denom;
  const v = (v0x * v2y - v2x * v0y) / denom;
  return {
    relief: tri.a[2] * (1 - u - v) + tri.b[2] * u + tri.c[2] * v,
    slopeX: slope[0],
    slopeY: slope[1],
  };
}

function spectreReliefReference(center: Point, verts: Point[]): number {
  if (verts.length < 3) return 1;
  let total = 0;
  let count = 0;
  for (const p of verts) {
    total += Math.hypot(p[0] - center[0], p[1] - center[1]);
    count++;
  }
  return Math.max(total / Math.max(1, count), averageSegmentLength(verts) * 0.5, SEGMENT_EPS);
}

function spectreReliefSampleAt(
  p: Point,
  verts: Point[],
  reliefApex: number,
  referenceDistance: number,
): SurfaceSample {
  if (reliefApex <= 0) return { relief: 0, slopeX: 0, slopeY: 0 };
  const boundary = nearestBoundaryDistanceSample(p, verts);
  const edgeBand = Math.max(referenceDistance * SPECTRE_EDGE_FADE_FRACTION, SEGMENT_EPS);
  const edgeT = Math.max(0, Math.min(1, boundary.distance / edgeBand));
  const edgeFade = smootherStep(edgeT);
  const edgeDerivative = edgeT > 0 && edgeT < 1
    ? smootherStepDerivative(edgeT) / edgeBand
    : 0;
  const edgeDx = edgeDerivative * boundary.gradX;
  const edgeDy = edgeDerivative * boundary.gradY;
  const dhDx = reliefApex * edgeDx;
  const dhDy = reliefApex * edgeDy;
  return {
    relief: reliefApex * edgeFade,
    slopeX: -dhDx,
    slopeY: -dhDy,
  };
}

function smootherStep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function smootherStepDerivative(t: number): number {
  return 30 * t * t * (t - 1) * (t - 1);
}

function averageSegmentLength(verts: Point[]): number {
  if (verts.length === 0) return 1;
  let total = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]!;
    const b = verts[(i + 1) % verts.length]!;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total / verts.length;
}

function nearestBoundaryDistanceSample(p: Point, verts: Point[]): { distance: number; gradX: number; gradY: number } {
  if (verts.length === 0) return { distance: 0, gradX: 0, gradY: 0 };
  const ccw = signedArea(verts) >= 0;
  let best = { distance: Infinity, gradX: 0, gradY: 0 };
  for (let i = 0; i < verts.length; i++) {
    const sample = segmentBoundaryDistanceSample(p, verts[i]!, verts[(i + 1) % verts.length]!, ccw);
    if (sample.distance < best.distance) best = sample;
  }
  return Number.isFinite(best.distance) ? best : { distance: 0, gradX: 0, gradY: 0 };
}

function segmentBoundaryDistanceSample(
  p: Point,
  a: Point,
  b: Point,
  ccw: boolean,
): { distance: number; gradX: number; gradY: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= SEGMENT_EPS) {
    const vx = p[0] - a[0];
    const vy = p[1] - a[1];
    const distance = Math.hypot(vx, vy);
    return distance > SEGMENT_EPS
      ? { distance, gradX: vx / distance, gradY: vy / distance }
      : { distance: 0, gradX: 0, gradY: 0 };
  }
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  const qx = a[0] + dx * t;
  const qy = a[1] + dy * t;
  const vx = p[0] - qx;
  const vy = p[1] - qy;
  const distance = Math.hypot(vx, vy);
  if (distance > SEGMENT_EPS) return { distance, gradX: vx / distance, gradY: vy / distance };
  const len = Math.sqrt(lenSq);
  return ccw
    ? { distance: 0, gradX: -dy / len, gradY: dx / len }
    : { distance: 0, gradX: dy / len, gradY: -dx / len };
}

function distanceToPolygonBoundary(p: Point, verts: readonly Point[]): number {
  let best = Infinity;
  for (let i = 0; i < verts.length; i++) {
    best = Math.min(best, distanceToSegment(p, verts[i]!, verts[(i + 1) % verts.length]!));
  }
  return Number.isFinite(best) ? best : 0;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= SEGMENT_EPS) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

function normalizedOppositeEdgeDistance(p: Point, a: Point, b: Point, reference: number): number {
  return Math.max(0, Math.min(1, distanceToSegment(p, a, b) / Math.max(reference, SEGMENT_EPS)));
}

function triangleEdgeMetric(a: Point, b: Point, c: Point, mask: EdgeMask, reference: number): EdgeBary {
  return [
    mask[1] ? normalizedOppositeEdgeDistance(a, b, c, reference) : 1,
    mask[2] ? normalizedOppositeEdgeDistance(b, c, a, reference) : 1,
    mask[0] ? normalizedOppositeEdgeDistance(c, a, b, reference) : 1,
  ];
}

function sourceAtlasFrame(verts: Point[], center: Point, orient: Point): AtlasFrame {
  const axisLen = Math.hypot(orient[0], orient[1]);
  const axis: Point = axisLen > SEGMENT_EPS ? [orient[0] / axisLen, orient[1] / axisLen] : [1, 0];
  const side: Point = [-axis[1], axis[0]];
  let extent = SEGMENT_EPS;
  for (const p of verts) {
    const dx = p[0] - center[0];
    const dy = p[1] - center[1];
    extent = Math.max(
      extent,
      Math.abs(dx * axis[0] + dy * axis[1]),
      Math.abs(dx * side[0] + dy * side[1]),
    );
  }
  return { center, axis, scale: extent * 2 };
}

function atlasLocalPoint(p: Point3, frame: AtlasFrame): Point {
  const dx = p[0] - frame.center[0];
  const dy = p[1] - frame.center[1];
  const safeScale = Math.max(Math.abs(frame.scale), SEGMENT_EPS);
  return [
    (dx * frame.axis[0] + dy * frame.axis[1]) / safeScale,
    (dy * frame.axis[0] - dx * frame.axis[1]) / safeScale,
  ];
}

function emitTriangle(
  cursor: number,
  buffers: MeshBuffers,
  projector: Projector,
  snap: Snapper,
  fillSub: number,
  a: Point3,
  b: Point3,
  c: Point3,
  rgb: Point3,
  topologyRgb: Point3,
  typeValue: number,
  ringValue: number,
  orient: Point,
  center: Point,
  paletteIndex: number,
  // Fallback for degenerate child triangles. Nondegenerate children choose their
  // own winding below so generated Spectre rings cannot leave isolated backfaces.
  flip: boolean,
  reliefSampler: ReliefSampler | null,
  reliefValue: number | null,
  shapeValue: number,
  scaleValue: number,
  atlasFrame: AtlasFrame,
  bakedSlope: Point,
  edgeMask: EdgeMask,
  topologyValue: Point,
  topologyExtra: Point,
): number {
  const edgeBary = edgeBaryRows(edgeMask);
  const emitTri = (
    p0: FillSourceVertex,
    p1: FillSourceVertex,
    p2: FillSourceVertex,
  ): void => {
    const q0 = snap(projector.map(p0.point[0], p0.point[1]));
    const q1 = snap(projector.map(p1.point[0], p1.point[1]));
    const q2 = snap(projector.map(p2.point[0], p2.point[1]));
    const edgeMetric = triangleEdgeMetric(q0, q1, q2, edgeMask, Math.max(scaleValue, SEGMENT_EPS));
    const emitPoint = (p: FillSourceVertex): void => {
      const tileLocal = atlasLocalPoint(p.point, atlasFrame);
      if (reliefSampler) {
        const sample = reliefSampler([p.point[0], p.point[1]]);
        cursor = emitProjectedVertex(cursor, buffers, projector, snap, [p.point[0], p.point[1], sample.relief], rgb, topologyRgb, typeValue, ringValue, orient, center, paletteIndex, reliefValue, shapeValue, scaleValue, [sample.slopeX, sample.slopeY], tileLocal, p.edgeBary, edgeMetric, topologyValue, topologyExtra);
        return;
      }
      cursor = emitProjectedVertex(cursor, buffers, projector, snap, p.point, rgb, topologyRgb, typeValue, ringValue, orient, center, paletteIndex, reliefValue, shapeValue, scaleValue, bakedSlope, tileLocal, p.edgeBary, edgeMetric, topologyValue, topologyExtra);
    };
    const projectedArea = orient2(q0, q1, q2);
    const sourceArea = orient2([p0.point[0], p0.point[1]], [p1.point[0], p1.point[1]], [p2.point[0], p2.point[1]]);
    const area = Math.abs(projectedArea) > PROJECTED_AREA_EPS ? projectedArea : sourceArea;
    const flipTriangle = Math.abs(area) > AREA_EPS ? area < 0 : flip;
    if (flipTriangle) {
      emitPoint(p0);
      emitPoint(p2);
      emitPoint(p1);
    } else {
      emitPoint(p0);
      emitPoint(p1);
      emitPoint(p2);
    }
  };
  const sourceA: FillSourceVertex = { point: a, edgeBary: edgeBary[0] };
  const sourceB: FillSourceVertex = { point: b, edgeBary: edgeBary[1] };
  const sourceC: FillSourceVertex = { point: c, edgeBary: edgeBary[2] };
  if (fillSub <= 1) {
    emitTri(sourceA, sourceB, sourceC);
    return cursor;
  }
  const invN = 1 / fillSub;
  const point = (i: number, j: number): FillSourceVertex => {
    const k = fillSub - i - j;
    const fa = i * invN;
    const fb = j * invN;
    const fc = k * invN;
    return {
      point: [
        fa * a[0] + fb * b[0] + fc * c[0],
        fa * a[1] + fb * b[1] + fc * c[1],
        fa * a[2] + fb * b[2] + fc * c[2],
      ],
      edgeBary: interpolateEdgeBary(sourceA.edgeBary, sourceB.edgeBary, sourceC.edgeBary, fa, fb, fc),
    };
  };
  for (let i = 0; i < fillSub; i++) {
    for (let j = 0; j < fillSub - i; j++) {
      const a0 = point(i, j);
      const b0 = point(i + 1, j);
      const c0 = point(i, j + 1);
      emitTri(a0, b0, c0);
      if (j < fillSub - i - 1) {
        const a1 = point(i + 1, j);
        const b1 = point(i + 1, j + 1);
        const c1 = point(i, j + 1);
        emitTri(a1, b1, c1);
      }
    }
  }
  return cursor;
}

function emitProjectedVertex(
  cursor: number,
  buffers: MeshBuffers,
  projector: Projector,
  snap: Snapper,
  vertex: Point3,
  rgb: Point3,
  topologyRgb: Point3,
  typeValue: number,
  ringValue: number,
  orient: Point,
  center: Point,
  paletteIndex: number,
  reliefValue: number | null,
  shapeValue: number,
  scaleValue: number,
  reliefSlope: Point,
  tileLocalValue: Point,
  edgeBaryValue: EdgeBary,
  edgeDistanceValue: EdgeBary,
  topologyValue: Point,
  topologyExtra: Point,
): number {
  const [x, y] = snap(projector.map(vertex[0], vertex[1]));
  return emitVertex(
    cursor,
    buffers.position,
	    buffers.color,
	    buffers.paletteSlot,
	    buffers.topologyPaletteColor,
	    buffers.tileType,
    buffers.tileRing,
    buffers.tileOrient,
    buffers.tileCenter,
    buffers.tileRelief,
    buffers.tileReliefSlope,
    buffers.tileEdgeBary,
    buffers.tileEdgeDistance,
    buffers.tileShape,
    buffers.tileScale,
    buffers.tileLocal,
    buffers.tileTopology,
    x,
    y,
    vertex[2],
    rgb,
    topologyRgb,
    typeValue,
    ringValue,
    orient,
    center,
    paletteIndex,
    reliefValue,
    shapeValue,
    scaleValue,
    reliefSlope,
    tileLocalValue,
    edgeBaryValue,
    edgeDistanceValue,
    topologyValue,
    topologyExtra,
  );
}

function emitVertex(
  cursor: number,
  position: Float32Array,
	  color: Float32Array,
	  paletteSlot: Float32Array,
	  topologyPaletteColor: Float32Array,
	  tileType: Float32Array,
  tileRing: Float32Array,
  tileOrient: Float32Array,
  tileCenter: Float32Array,
  tileRelief: Float32Array,
  tileReliefSlope: Float32Array,
  tileEdgeBary: Float32Array,
  tileEdgeDistance: Float32Array,
  tileShape: Float32Array,
  tileScale: Float32Array,
  tileLocal: Float32Array,
  tileTopology: Float32Array,
  x: number,
  y: number,
  z: number,
  rgb: Point3,
  topologyRgb: Point3,
  typeValue: number,
  ringValue: number,
  orient: Point,
  center: Point,
  paletteIndex: number,
  reliefValue: number | null,
  shapeValue: number,
  scaleValue: number,
  reliefSlope: Point,
  tileLocalValue: Point,
  edgeBaryValue: EdgeBary,
  edgeDistanceValue: EdgeBary,
  topologyValue: Point,
  topologyExtra: Point,
): number {
  const p = cursor * 3;
  position[p] = x;
  position[p + 1] = y;
  position[p + 2] = shapeValue > 0 ? z : 0;
  color[p] = rgb[0];
  color[p + 1] = rgb[1];
  color[p + 2] = rgb[2];
  topologyPaletteColor[p] = topologyRgb[0];
  topologyPaletteColor[p + 1] = topologyRgb[1];
  topologyPaletteColor[p + 2] = topologyRgb[2];
  paletteSlot[cursor] = paletteIndex;
  tileType[cursor] = typeValue;
  tileRing[cursor] = ringValue;
  tileRelief[cursor] = reliefValue === null ? z : reliefValue;
  tileShape[cursor] = shapeValue;
  tileScale[cursor] = scaleValue;
  const o = cursor * 2;
  tileOrient[o] = orient[0];
  tileOrient[o + 1] = orient[1];
  tileCenter[o] = center[0];
  tileCenter[o + 1] = center[1];
  tileReliefSlope[o] = reliefSlope[0];
  tileReliefSlope[o + 1] = reliefSlope[1];
  tileLocal[o] = tileLocalValue[0];
  tileLocal[o + 1] = tileLocalValue[1];
  const q = cursor * 4;
  tileTopology[q] = topologyValue[0];
  tileTopology[q + 1] = topologyValue[1];
  tileTopology[q + 2] = topologyExtra[0];
  tileTopology[q + 3] = topologyExtra[1];
  tileEdgeBary[p] = edgeBaryValue[0];
  tileEdgeBary[p + 1] = edgeBaryValue[1];
  tileEdgeBary[p + 2] = edgeBaryValue[2];
  tileEdgeDistance[p] = Math.max(0, Math.min(1, edgeDistanceValue[0]));
  tileEdgeDistance[p + 1] = Math.max(0, Math.min(1, edgeDistanceValue[1]));
  tileEdgeDistance[p + 2] = Math.max(0, Math.min(1, edgeDistanceValue[2]));
  return cursor + 1;
}

export function buildEdgeGeometryForPatch(patch: Patch, settings: Settings, window: TilingWindow | null = null): BufferGeometry | null {
  const activePatch = windowPatchForView(patch, window);
  const borderOn = String(settings.border_on) !== 'false';
  const radius = averageTileRadius(activePatch.tiles);
  const relief = radius * 0.34;
  const width = radius * intSetting(settings, 'border_width', 0, 600) / 600 * 0.16;
  if (!borderOn || width <= 1e-7) return null;

  const tileVertexCount = patchBorderSourceCount(activePatch.tiles, activePatch.family);
  const spectreDetail = spectreMeshDetailForPatch(activePatch.tiles, activePatch.family);
  const roofMap = familySupportsWieringaRoof(activePatch.family) && intSetting(settings, 'surface_relief_mode', 0, 1) === 1
    ? p3WieringaRoofMap(activePatch, relief * WIERINGA_ROOF_RELIEF_SCALE)
    : null;
  const sourceTriCount = roofMap ? roofSourceTriangleCount(activePatch.tiles, roofMap) : patchSourceTriangleCount(activePatch.tiles, activePatch.family, spectreDetail);
  const requestedFillSub = intSetting(settings, 'hyp_fill_subdiv', 1, 8);
  const fillSub = clampQuadraticSubdivision(
    Math.max(requestedFillSub, minFillSubdivisionForFamily(activePatch.family)),
    sourceTriCount,
    MAX_FILL_VERTEX_COUNT,
  );
  const borderSurfaceFillSub = clampQuadraticSubdivision(
    Math.max(requestedFillSub, MIN_BORDER_SURFACE_SUBDIVISION, minFillSubdivisionForFamily(activePatch.family)),
    sourceTriCount,
    MAX_FILL_VERTEX_COUNT,
  );
  const surfaceSub = Math.max(1, Math.ceil(borderSurfaceFillSub / fillSub));
  const projector = createProjector(settings);
  const snap = createVertexSnapper(projector.enabled ? 1e-5 : 1e-7);
  const sub = clampLinearSubdivision(
    intSetting(settings, 'hyp_border_subdiv', 1, 32),
    tileVertexCount,
    MAX_BORDER_VERTEX_COUNT,
    Math.max(48 * surfaceSub * surfaceSub, 32 * fillSub),
  );
  const positions = new Float32Builder();
  const tileType = new Float32Builder();
  const tileRing = new Float32Builder();
  const tileOrient = new Float32Builder();
  const tileCenter = new Float32Builder();
  const tileRelief = new Float32Builder();
  const tileShape = new Float32Builder();
  const tileScale = new Float32Builder();
  const tileLocal = new Float32Builder();
  const tileTopology = new Float32Builder();
  const edgeSide = new Float32Builder();
  const edgeSlope = new Float32Builder();
  const pushSampledVertex = (p: Point, border: BorderLayoutTile, sample: SurfaceSample, side: number): void => {
    const local = atlasLocalPoint([p[0], p[1], 0], border.localFrame);
    positions.push3(p[0], p[1], border.shapeValue > 0 ? sample.relief : 0);
    tileType.push1(border.typeValue);
    tileRing.push1(border.ring);
    tileOrient.push2(border.orient[0], border.orient[1]);
    tileCenter.push2(border.center[0], border.center[1]);
    tileRelief.push1(border.shapeValue > 0 ? border.reliefApex : sample.relief);
    tileShape.push1(border.shapeValue);
    tileScale.push1(border.tileScale);
    tileLocal.push2(local[0], local[1]);
    tileTopology.push4(border.topology[0], border.topology[1], border.topology[2], border.topology[3]);
    edgeSide.push1(side);
    edgeSlope.push2(sample.slopeX, sample.slopeY);
  };
  const pointInTri = (a: Point, b: Point, c: Point, i: number, j: number, n: number): Point => {
    const k = n - i - j;
    const fa = i / n;
    const fb = j / n;
    const fc = k / n;
    return [
      fa * a[0] + fb * b[0] + fc * c[0],
      fa * a[1] + fb * b[1] + fc * c[1],
    ];
  };
  const emitConstrained = (points: Point[], border: BorderLayoutTile, surface: SurfaceTri): boolean => {
    if (points.length < 3 || Math.abs(signedArea(points)) <= AREA_EPS) return false;
    let emitted = false;
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[0]!;
      const b = points[i]!;
      const c = points[i + 1]!;
      if (Math.abs(signedArea([a, b, c])) <= AREA_EPS) continue;
      const sampleA = sampleSurfaceTri(a, surface);
      const sampleB = sampleSurfaceTri(b, surface);
      const sampleC = sampleSurfaceTri(c, surface);
      pushSampledVertex(a, border, sampleA, 1);
      pushSampledVertex(b, border, sampleB, 1);
      pushSampledVertex(c, border, sampleC, 1);
      if (border.shapeValue > 0) {
        emitted = true;
        continue;
      }
      pushSampledVertex(a, border, sampleA, -1);
      pushSampledVertex(c, border, sampleC, -1);
      pushSampledVertex(b, border, sampleB, -1);
      emitted = true;
    }
    return emitted;
  };
  const pushTri = (
    p0: Point,
    p1: Point,
    p2: Point,
    border: BorderLayoutTile,
    surfaceHint?: readonly number[],
  ): void => {
    const emitAgainst = (a: Point, b: Point, c: Point, surface: SurfaceTri): boolean => {
      return emitConstrained(clipPolygonToSurfaceTri([a, b, c], surface), border, surface);
    };
    const emit = (a: Point, b: Point, c: Point): void => {
      const bounds: Bounds2 = {
        minX: Math.min(a[0], b[0], c[0]) - SURFACE_BOUNDS_EPS,
        maxX: Math.max(a[0], b[0], c[0]) + SURFACE_BOUNDS_EPS,
        minY: Math.min(a[1], b[1], c[1]) - SURFACE_BOUNDS_EPS,
        maxY: Math.max(a[1], b[1], c[1]) + SURFACE_BOUNDS_EPS,
      };
      let emitted = false;
      if (surfaceHint && border.localSurfaceHints) {
        for (const edgeIndex of surfaceHint) {
          forEachSurfaceCandidate(border.surfaceByEdge[edgeIndex], bounds, surface => {
            emitted = emitAgainst(a, b, c, surface) || emitted;
          });
        }
      }
      if (!emitted && border.surface) {
        forEachSurfaceCandidate(border.surface, bounds, surface => {
          emitted = emitAgainst(a, b, c, surface) || emitted;
        });
      }
    };
    for (let i = 0; i < surfaceSub; i++) {
      for (let j = 0; j < surfaceSub - i; j++) {
        const a0 = pointInTri(p0, p1, p2, i, j, surfaceSub);
        const b0 = pointInTri(p0, p1, p2, i + 1, j, surfaceSub);
        const c0 = pointInTri(p0, p1, p2, i, j + 1, surfaceSub);
        emit(a0, b0, c0);
        if (j < surfaceSub - i - 1) {
          const a1 = pointInTri(p0, p1, p2, i + 1, j, surfaceSub);
          const b1 = pointInTri(p0, p1, p2, i + 1, j + 1, surfaceSub);
          const c1 = pointInTri(p0, p1, p2, i, j + 1, surfaceSub);
          emit(a1, b1, c1);
        }
      }
    }
  };
  const layout = cachedBorderLayout(
    activePatch,
    borderLayoutCacheKey(settings, activePatch.family, fillSub, borderSurfaceFillSub, sub, relief, spectreDetail),
    () => borderLayout(activePatch, projector, snap, sub, borderSurfaceFillSub, relief, spectreDetail, roofMap),
  );
  for (const border of layout) {
    buildTileRing(
      border,
      width * 0.5,
      intSetting(settings, 'border_join', 0, 2),
      intSetting(settings, 'border_fill', 0, 100) / 100,
      intSetting(settings, 'border_point', 0, 100) / 100,
      intSetting(settings, 'border_gap', 0, 100) / 100,
      (p0, p1, p2, _ring, _orient, _center, surfaceHint) => pushTri(p0, p1, p2, border, surfaceHint),
    );
  }
  if (positions.length === 0) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions.view(), 3));
  setEdgeCustomAttributes(
    geometry,
    tileType.view(),
    tileRing.view(),
    tileOrient.view(),
    tileCenter.view(),
    tileRelief.view(),
    tileShape.view(),
    tileScale.view(),
    tileLocal.view(),
    tileTopology.view(),
    edgeSide.view(),
    edgeSlope.view(),
  );
  geometry.computeBoundingSphere();
  applyPatchBoundingSphere(geometry, patch);
  return geometry;
}

function pushOverlayVertex(
  positions: Float32Builder,
  tileType: Float32Builder,
  tileRing: Float32Builder,
  tileOrient: Float32Builder,
  tileCenter: Float32Builder,
  tileRelief: Float32Builder,
  tileShape: Float32Builder,
  tileScale: Float32Builder,
  tileLocal: Float32Builder,
  tileTopology: Float32Builder,
  edgeSide: Float32Builder,
  edgeSlope: Float32Builder,
  p: Point,
  typeValue: number,
  ring: number,
  orient: Point,
  center: Point,
  tileScaleValue: number,
  localFrame: AtlasFrame,
  topologyValue: TopologyQuad,
  sample: SurfaceSample | null = null,
  side = 1,
  shapeOverride: number | null = null,
): void {
  const shapeValue = shapeOverride ?? (sample ? 1 : 0);
  const local = atlasLocalPoint([p[0], p[1], 0], localFrame);
  positions.push3(p[0], p[1], shapeValue > 0 ? sample?.relief ?? 0 : 0);
  tileType.push1(typeValue);
  tileRing.push1(ring);
  tileOrient.push2(orient[0], orient[1]);
  tileCenter.push2(center[0], center[1]);
  tileRelief.push1(sample?.relief ?? 0);
  tileShape.push1(shapeValue);
  tileScale.push1(tileScaleValue);
  tileLocal.push2(local[0], local[1]);
  tileTopology.push4(topologyValue[0], topologyValue[1], topologyValue[2], topologyValue[3]);
  edgeSide.push1(side);
  edgeSlope.push2(sample?.slopeX ?? 0, sample?.slopeY ?? 0);
}

function pushOverlayStrip(
  positions: Float32Builder,
  tileType: Float32Builder,
  tileRing: Float32Builder,
  tileOrient: Float32Builder,
  tileCenter: Float32Builder,
  tileRelief: Float32Builder,
  tileShape: Float32Builder,
  tileScale: Float32Builder,
  tileLocal: Float32Builder,
  tileTopology: Float32Builder,
  edgeSide: Float32Builder,
  edgeSlope: Float32Builder,
  a: Point,
  b: Point,
  halfWidth: number,
  typeValue: number,
  ring: number,
  orient: Point,
  center: Point,
  tileScaleValue: number,
  localFrame: AtlasFrame,
  topologyValue: TopologyQuad,
  sampleA: SurfaceSample | null = null,
  sampleB: SurfaceSample | null = null,
  shapeOverride: number | null = null,
): void {
  const segmentNormal = (from: Point, to: Point): Point | null => {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const len = Math.hypot(dx, dy);
    if (len <= SEGMENT_EPS) return null;
    return [-dy / len, dx / len];
  };
  const normal = segmentNormal(a, b);
  if (!normal) return;
  const p0: Point = [a[0] + normal[0] * halfWidth, a[1] + normal[1] * halfWidth];
  const p1: Point = [b[0] + normal[0] * halfWidth, b[1] + normal[1] * halfWidth];
  const p2: Point = [b[0] - normal[0] * halfWidth, b[1] - normal[1] * halfWidth];
  const p3: Point = [a[0] - normal[0] * halfWidth, a[1] - normal[1] * halfWidth];
  pushOverlayQuad(
    positions,
    tileType,
    tileRing,
    tileOrient,
    tileCenter,
    tileRelief,
    tileShape,
    tileScale,
    tileLocal,
    tileTopology,
    edgeSide,
    edgeSlope,
    p0,
    p1,
    p2,
    p3,
    typeValue,
    ring,
    orient,
    center,
    tileScaleValue,
    localFrame,
    topologyValue,
    sampleA,
    sampleB,
    shapeOverride,
  );
}

function pushOverlayQuad(
  positions: Float32Builder,
  tileType: Float32Builder,
  tileRing: Float32Builder,
  tileOrient: Float32Builder,
  tileCenter: Float32Builder,
  tileRelief: Float32Builder,
  tileShape: Float32Builder,
  tileScale: Float32Builder,
  tileLocal: Float32Builder,
  tileTopology: Float32Builder,
  edgeSide: Float32Builder,
  edgeSlope: Float32Builder,
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  typeValue: number,
  ring: number,
  orient: Point,
  center: Point,
  tileScaleValue: number,
  localFrame: AtlasFrame,
  topologyValue: TopologyQuad,
  sampleA: SurfaceSample | null = null,
  sampleB: SurfaceSample | null = null,
  shapeOverride: number | null = null,
): void {
  pushOverlayVertex(positions, tileType, tileRing, tileOrient, tileCenter, tileRelief, tileShape, tileScale, tileLocal, tileTopology, edgeSide, edgeSlope, p0, typeValue, ring, orient, center, tileScaleValue, localFrame, topologyValue, sampleA, 1, shapeOverride);
  pushOverlayVertex(positions, tileType, tileRing, tileOrient, tileCenter, tileRelief, tileShape, tileScale, tileLocal, tileTopology, edgeSide, edgeSlope, p1, typeValue, ring, orient, center, tileScaleValue, localFrame, topologyValue, sampleB, 1, shapeOverride);
  pushOverlayVertex(positions, tileType, tileRing, tileOrient, tileCenter, tileRelief, tileShape, tileScale, tileLocal, tileTopology, edgeSide, edgeSlope, p2, typeValue, ring, orient, center, tileScaleValue, localFrame, topologyValue, sampleB, 1, shapeOverride);
  pushOverlayVertex(positions, tileType, tileRing, tileOrient, tileCenter, tileRelief, tileShape, tileScale, tileLocal, tileTopology, edgeSide, edgeSlope, p0, typeValue, ring, orient, center, tileScaleValue, localFrame, topologyValue, sampleA, 1, shapeOverride);
  pushOverlayVertex(positions, tileType, tileRing, tileOrient, tileCenter, tileRelief, tileShape, tileScale, tileLocal, tileTopology, edgeSide, edgeSlope, p2, typeValue, ring, orient, center, tileScaleValue, localFrame, topologyValue, sampleB, 1, shapeOverride);
  pushOverlayVertex(positions, tileType, tileRing, tileOrient, tileCenter, tileRelief, tileShape, tileScale, tileLocal, tileTopology, edgeSide, edgeSlope, p3, typeValue, ring, orient, center, tileScaleValue, localFrame, topologyValue, sampleA, 1, shapeOverride);
  pushOverlayVertex(positions, tileType, tileRing, tileOrient, tileCenter, tileRelief, tileShape, tileScale, tileLocal, tileTopology, edgeSide, edgeSlope, p0, typeValue, ring, orient, center, tileScaleValue, localFrame, topologyValue, sampleA, -1, shapeOverride);
  pushOverlayVertex(positions, tileType, tileRing, tileOrient, tileCenter, tileRelief, tileShape, tileScale, tileLocal, tileTopology, edgeSide, edgeSlope, p2, typeValue, ring, orient, center, tileScaleValue, localFrame, topologyValue, sampleB, -1, shapeOverride);
  pushOverlayVertex(positions, tileType, tileRing, tileOrient, tileCenter, tileRelief, tileShape, tileScale, tileLocal, tileTopology, edgeSide, edgeSlope, p1, typeValue, ring, orient, center, tileScaleValue, localFrame, topologyValue, sampleB, -1, shapeOverride);
  pushOverlayVertex(positions, tileType, tileRing, tileOrient, tileCenter, tileRelief, tileShape, tileScale, tileLocal, tileTopology, edgeSide, edgeSlope, p0, typeValue, ring, orient, center, tileScaleValue, localFrame, topologyValue, sampleA, -1, shapeOverride);
  pushOverlayVertex(positions, tileType, tileRing, tileOrient, tileCenter, tileRelief, tileShape, tileScale, tileLocal, tileTopology, edgeSide, edgeSlope, p3, typeValue, ring, orient, center, tileScaleValue, localFrame, topologyValue, sampleA, -1, shapeOverride);
  pushOverlayVertex(positions, tileType, tileRing, tileOrient, tileCenter, tileRelief, tileShape, tileScale, tileLocal, tileTopology, edgeSide, edgeSlope, p2, typeValue, ring, orient, center, tileScaleValue, localFrame, topologyValue, sampleB, -1, shapeOverride);
}

function pushOverlayTriangle(
  positions: Float32Builder,
  tileType: Float32Builder,
  tileRing: Float32Builder,
  tileOrient: Float32Builder,
  tileCenter: Float32Builder,
  tileRelief: Float32Builder,
  tileShape: Float32Builder,
  tileScale: Float32Builder,
  tileLocal: Float32Builder,
  tileTopology: Float32Builder,
  edgeSide: Float32Builder,
  edgeSlope: Float32Builder,
  p0: Point,
  p1: Point,
  p2: Point,
  typeValue: number,
  ring: number,
  orient: Point,
  center: Point,
  tileScaleValue: number,
  localFrame: AtlasFrame,
  topologyValue: TopologyQuad,
  sample0: SurfaceSample | null = null,
  sample1: SurfaceSample | null = null,
  sample2: SurfaceSample | null = null,
  shapeOverride: number | null = null,
): void {
  pushOverlayVertex(positions, tileType, tileRing, tileOrient, tileCenter, tileRelief, tileShape, tileScale, tileLocal, tileTopology, edgeSide, edgeSlope, p0, typeValue, ring, orient, center, tileScaleValue, localFrame, topologyValue, sample0, 1, shapeOverride);
  pushOverlayVertex(positions, tileType, tileRing, tileOrient, tileCenter, tileRelief, tileShape, tileScale, tileLocal, tileTopology, edgeSide, edgeSlope, p1, typeValue, ring, orient, center, tileScaleValue, localFrame, topologyValue, sample1, 1, shapeOverride);
  pushOverlayVertex(positions, tileType, tileRing, tileOrient, tileCenter, tileRelief, tileShape, tileScale, tileLocal, tileTopology, edgeSide, edgeSlope, p2, typeValue, ring, orient, center, tileScaleValue, localFrame, topologyValue, sample2, 1, shapeOverride);
  pushOverlayVertex(positions, tileType, tileRing, tileOrient, tileCenter, tileRelief, tileShape, tileScale, tileLocal, tileTopology, edgeSide, edgeSlope, p0, typeValue, ring, orient, center, tileScaleValue, localFrame, topologyValue, sample0, -1, shapeOverride);
  pushOverlayVertex(positions, tileType, tileRing, tileOrient, tileCenter, tileRelief, tileShape, tileScale, tileLocal, tileTopology, edgeSide, edgeSlope, p2, typeValue, ring, orient, center, tileScaleValue, localFrame, topologyValue, sample2, -1, shapeOverride);
  pushOverlayVertex(positions, tileType, tileRing, tileOrient, tileCenter, tileRelief, tileShape, tileScale, tileLocal, tileTopology, edgeSide, edgeSlope, p1, typeValue, ring, orient, center, tileScaleValue, localFrame, topologyValue, sample1, -1, shapeOverride);
}

function polylineMiterNormal(prev: Point | null, point: Point, next: Point | null, halfWidth: number): Point | null {
  const normalFor = (from: Point, to: Point): Point | null => {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const len = Math.hypot(dx, dy);
    if (len <= SEGMENT_EPS) return null;
    return [-dy / len, dx / len];
  };
  const prevNormal = prev ? normalFor(prev, point) : null;
  const nextNormal = next ? normalFor(point, next) : null;
  if (!prevNormal && !nextNormal) return null;
  if (!prevNormal) return [nextNormal![0] * halfWidth, nextNormal![1] * halfWidth];
  if (!nextNormal) return [prevNormal[0] * halfWidth, prevNormal[1] * halfWidth];
  const mx = prevNormal[0] + nextNormal[0];
  const my = prevNormal[1] + nextNormal[1];
  const mLen = Math.hypot(mx, my);
  if (mLen <= SEGMENT_EPS) return [nextNormal[0] * halfWidth, nextNormal[1] * halfWidth];
  const ux = mx / mLen;
  const uy = my / mLen;
  const dot = Math.max(0.35, Math.abs(ux * nextNormal[0] + uy * nextNormal[1]));
  const scale = Math.min(halfWidth / dot, halfWidth * 2.5);
  return [ux * scale, uy * scale];
}

function pushOverlayPolyline(
  positions: Float32Builder,
  tileType: Float32Builder,
  tileRing: Float32Builder,
  tileOrient: Float32Builder,
  tileCenter: Float32Builder,
  tileRelief: Float32Builder,
  tileShape: Float32Builder,
  tileScale: Float32Builder,
  tileLocal: Float32Builder,
  tileTopology: Float32Builder,
  edgeSide: Float32Builder,
  edgeSlope: Float32Builder,
  points: readonly Point[],
  halfWidth: number,
  typeValue: number,
  ring: number,
  orient: Point,
  center: Point,
  tileScaleValue: number,
  localFrame: AtlasFrame,
  topologyValue: TopologyQuad,
  samples: readonly (SurfaceSample | null)[] | null = null,
  shapeOverride: number | null = null,
): void {
  const offsets: (Point | null)[] = [];
  for (let i = 0; i < points.length; i++) {
    offsets.push(polylineMiterNormal(points[i - 1] ?? null, points[i]!, points[i + 1] ?? null, halfWidth));
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const offsetA = offsets[i];
    const offsetB = offsets[i + 1];
    if (!offsetA || !offsetB) {
      pushOverlayStrip(
        positions,
        tileType,
        tileRing,
        tileOrient,
        tileCenter,
        tileRelief,
        tileShape,
        tileScale,
        tileLocal,
        tileTopology,
        edgeSide,
        edgeSlope,
        a,
        b,
        halfWidth,
        typeValue,
        ring,
        orient,
        center,
        tileScaleValue,
        localFrame,
        topologyValue,
        samples?.[i] ?? null,
        samples?.[i + 1] ?? null,
        shapeOverride,
      );
      continue;
    }
    pushOverlayQuad(
      positions,
      tileType,
      tileRing,
      tileOrient,
      tileCenter,
      tileRelief,
      tileShape,
      tileScale,
      tileLocal,
      tileTopology,
      edgeSide,
      edgeSlope,
      [a[0] + offsetA[0], a[1] + offsetA[1]],
      [b[0] + offsetB[0], b[1] + offsetB[1]],
      [b[0] - offsetB[0], b[1] - offsetB[1]],
      [a[0] - offsetA[0], a[1] - offsetA[1]],
      typeValue,
      ring,
      orient,
      center,
      tileScaleValue,
      localFrame,
      topologyValue,
      samples?.[i] ?? null,
      samples?.[i + 1] ?? null,
      shapeOverride,
    );
  }
}

const GOLDEN_RATIO = (1 + Math.sqrt(5)) * 0.5;

function shortAngleSpan(thetaA: number, thetaB: number): [number, number] {
  const min = Math.min(thetaA, thetaB);
  const max = Math.max(thetaA, thetaB);
  return Math.abs(max - min) < Math.PI ? [min, max] : [max, min + Math.PI * 2];
}

function sampleCircleArc(center: Point, radius: number, startThrough: Point, endThrough: Point, steps: number): Point[] {
  const a0 = Math.atan2(startThrough[1] - center[1], startThrough[0] - center[0]);
  const a1 = Math.atan2(endThrough[1] - center[1], endThrough[0] - center[0]);
  const span = shortAngleSpan(a0, a1);
  const points: Point[] = [];
  const count = Math.max(2, steps);
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const angle = span[0] + (span[1] - span[0]) * t;
    points.push([
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius,
    ]);
  }
  return points;
}

function clipLineToConvexPolygon(mid: Point, dir: Point, verts: Point[]): [Point, Point] | null {
  const hits: number[] = [];
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]!;
    const b = verts[(i + 1) % verts.length]!;
    const edge: Point = [b[0] - a[0], b[1] - a[1]];
    const denom = dir[0] * edge[1] - dir[1] * edge[0];
    if (Math.abs(denom) <= SEGMENT_EPS) continue;
    const delta: Point = [a[0] - mid[0], a[1] - mid[1]];
    const t = (delta[0] * edge[1] - delta[1] * edge[0]) / denom;
    const u = (delta[0] * dir[1] - delta[1] * dir[0]) / denom;
    if (u >= -1e-5 && u <= 1 + 1e-5) hits.push(t);
  }
  const unique = hits
    .sort((a, b) => a - b)
    .filter((value, index, sorted) => index === 0 || Math.abs(value - sorted[index - 1]!) > 1e-5);
  if (unique.length < 2) return null;
  const start = unique[0]!;
  const end = unique[unique.length - 1]!;
  return [
    [mid[0] + dir[0] * start, mid[1] + dir[1] * start],
    [mid[0] + dir[0] * end, mid[1] + dir[1] * end],
  ];
}

export function buildOverlayGeometryForPatch(patch: Patch, settings: Settings, window: TilingWindow | null = null): BufferGeometry | null {
  const activePatch = windowPatchForView(patch, window);
  const overlayKind = sourceOverlayKindForFamily(activePatch.family);
  if (overlayKind === 'none') return null;
  const topology = collectEdgeTopology(activePatch);
  if (topology.edgesByKey.size === 0) return null;
  const projector = createProjector(settings);
  const snap = createVertexSnapper(projector.enabled ? 1e-5 : 1e-7);
  const spec = familySpec(activePatch.family);
  const maxType = Math.max(1, typeBucketCount(activePatch.tiles, activePatch.family, spec) - 1);
  const rings = tileRings(activePatch.tiles, spec);
  const topologyScalars = tileTopologyScalars(activePatch, rings);
  const radius = averageTileRadius(activePatch.tiles);
  const halfWidth = Math.max(radius * 0.006, 1e-5);
  const roofMap = familySupportsWieringaRoof(activePatch.family) && intSetting(settings, 'surface_relief_mode', 0, 1) === 1
    ? p3WieringaRoofMap(activePatch, radius * 0.34 * WIERINGA_ROOF_RELIEF_SCALE)
    : null;
  const positions = new Float32Builder();
  const tileType = new Float32Builder();
  const tileRing = new Float32Builder();
  const tileOrient = new Float32Builder();
  const tileCenter = new Float32Builder();
  const tileRelief = new Float32Builder();
  const tileShape = new Float32Builder();
  const tileScale = new Float32Builder();
  const tileLocal = new Float32Builder();
  const tileTopology = new Float32Builder();
  const edgeSide = new Float32Builder();
  const edgeSlope = new Float32Builder();

  const topologyForTile = (tileIndex: number): TopologyQuad => [
    topologyScalars.degree[tileIndex] ?? 0,
    topologyScalars.motif[tileIndex] ?? 0,
    topologyScalars.relaxed[tileIndex] ?? 0,
    topologyScalars.biharmonic[tileIndex] ?? 0,
  ];

  const projectedFrame = (verts: readonly Point[], center: Point, orient: Point): AtlasFrame => {
    const projectedVerts: Point[] = [];
    for (const vert of verts) projectedVerts.push(snap(projector.map(vert[0], vert[1])));
    return sourceAtlasFrame(projectedVerts, center, orient);
  };

  const projectOverlayPolyline = (
    sourcePoints: readonly Point[],
    sourceCenter: Point,
    typeValue: number,
    ring: number,
    orientSource: Point,
    scaleVerts: Point[],
    topologyValue: TopologyQuad,
    widthScale: number,
    sourceSampler: ((point: Point) => SurfaceSample | null) | null = null,
    shapeOverride: number | null = null,
  ): void => {
    const center = snap(projector.map(sourceCenter[0], sourceCenter[1]));
    const projected: Point[] = [];
    for (const point of sourcePoints) projected.push(snap(projector.map(point[0], point[1])));
    const samples = sourceSampler ? sourcePoints.map(point => sourceSampler(point)) : null;
    const orientA = snap(projector.map(sourceCenter[0], sourceCenter[1]));
    const orientB = snap(projector.map(sourceCenter[0] + orientSource[0], sourceCenter[1] + orientSource[1]));
    const odx = orientB[0] - orientA[0];
    const ody = orientB[1] - orientA[1];
    const olen = Math.hypot(odx, ody);
    const orient: Point = olen > SEGMENT_EPS ? [odx / olen, ody / olen] : [1, 0];
    const tileScaleValue = projectedTileRadius(scaleVerts, sourceCenter, projector, snap);
    const localFrame = projectedFrame(scaleVerts, center, orient);
    pushOverlayPolyline(
      positions,
      tileType,
      tileRing,
      tileOrient,
      tileCenter,
      tileRelief,
      tileShape,
      tileScale,
      tileLocal,
      tileTopology,
      edgeSide,
      edgeSlope,
      projected,
      halfWidth * widthScale,
      typeValue,
      ring,
      orient,
      center,
      tileScaleValue,
      localFrame,
      topologyValue,
      samples,
      shapeOverride,
    );
  };

  const projectOverlayTriangle = (
    sourcePoints: readonly [Point, Point, Point],
    sourceCenter: Point,
    typeValue: number,
    ring: number,
    orientSource: Point,
    scaleVerts: Point[],
    topologyValue: TopologyQuad,
    sourceSampler: ((point: Point) => SurfaceSample | null) | null = null,
    shapeOverride: number | null = null,
  ): void => {
    const center = snap(projector.map(sourceCenter[0], sourceCenter[1]));
    const p0 = snap(projector.map(sourcePoints[0][0], sourcePoints[0][1]));
    const p1 = snap(projector.map(sourcePoints[1][0], sourcePoints[1][1]));
    const p2 = snap(projector.map(sourcePoints[2][0], sourcePoints[2][1]));
    if (Math.abs(signedArea([p0, p1, p2])) <= AREA_EPS) return;
    const orientA = snap(projector.map(sourceCenter[0], sourceCenter[1]));
    const orientB = snap(projector.map(sourceCenter[0] + orientSource[0], sourceCenter[1] + orientSource[1]));
    const odx = orientB[0] - orientA[0];
    const ody = orientB[1] - orientA[1];
    const olen = Math.hypot(odx, ody);
    const orient: Point = olen > SEGMENT_EPS ? [odx / olen, ody / olen] : [1, 0];
    const tileScaleValue = projectedTileRadius(scaleVerts, sourceCenter, projector, snap);
    const localFrame = projectedFrame(scaleVerts, center, orient);
    pushOverlayTriangle(
      positions,
      tileType,
      tileRing,
      tileOrient,
      tileCenter,
      tileRelief,
      tileShape,
      tileScale,
      tileLocal,
      tileTopology,
      edgeSide,
      edgeSlope,
      p0,
      p1,
      p2,
      typeValue,
      ring,
      orient,
      center,
      tileScaleValue,
      localFrame,
      topologyValue,
      sourceSampler ? sourceSampler(sourcePoints[0]) : null,
      sourceSampler ? sourceSampler(sourcePoints[1]) : null,
      sourceSampler ? sourceSampler(sourcePoints[2]) : null,
      shapeOverride,
    );
  };

  const emitRobinsonMatchingCurves = (): void => {
    const sourceDetail = intSetting(settings, 'source_mark_detail', 0, 2);
    const showOutlines = true;
    const showCurves = sourceDetail === 1;
    const showFilled = sourceDetail === 2;
    for (let tileIndex = 0; tileIndex < activePatch.tiles.length; tileIndex++) {
      const tile = activePatch.tiles[tileIndex]!;
      if (tile.verts.length !== 3) continue;
      const x = tile.verts[0]!;
      const y = tile.verts[1]!;
      const z = tile.verts[2]!;
      const radius = Math.hypot(x[0] - z[0], x[1] - z[1]);
      if (radius <= SEGMENT_EPS) continue;
      const sourceCenter = centroid(tile.verts);
      const orientSource = orientation(tile, activePatch.family);
      const ring = rings[tileIndex] ?? 0;
      const topologyValue = topologyForTile(tileIndex);
      const acute = tile.type === 1;
      const attachment = sourceOverlayAttachment(tile, sourceCenter, ring, tile.type / maxType);
      if (showFilled) {
        projectOverlayTriangle(
          [y, z, x],
          sourceCenter,
          acute ? 3 : 4,
          ring,
          orientSource,
          tile.verts,
          topologyValue,
        );
      }
      if (showOutlines) {
        projectOverlayPolyline(
          [y, z, x],
          sourceCenter,
          2,
          ring,
          orientSource,
          tile.verts,
          topologyValue,
          0.68,
          attachment.sampler,
          attachment.shape,
        );
      }
      if (!showCurves) continue;
      const redPoints = acute
        ? sampleCircleArc(x, radius / GOLDEN_RATIO, z, y, 12)
        : sampleCircleArc(y, radius / (GOLDEN_RATIO * GOLDEN_RATIO * GOLDEN_RATIO), z, x, 12);
      const bluePoints = acute
        ? sampleCircleArc(y, radius, x, z, 12)
        : sampleCircleArc(x, radius / (GOLDEN_RATIO * GOLDEN_RATIO), y, z, 12);
      projectOverlayPolyline(
        redPoints,
        sourceCenter,
        0,
        ring,
        orientSource,
        tile.verts,
        topologyValue,
        0.85,
        attachment.sampler,
        attachment.shape,
      );
      projectOverlayPolyline(
        bluePoints,
        sourceCenter,
        1,
        ring,
        orientSource,
        tile.verts,
        topologyValue,
        0.85,
        attachment.sampler,
        attachment.shape,
      );
    }
  };

  const beattyBit = (n: number): number => {
    const value = Math.floor(Math.SQRT2 * (n - 0.5));
    return ((value % 2) + 2) % 2;
  };

  const sourceDetail = intSetting(settings, 'source_mark_detail', 0, 3);
  const spectreDetail = spectreMeshDetailForPatch(activePatch.tiles, activePatch.family);
  const sourceTriCount = roofMap ? roofSourceTriangleCount(activePatch.tiles, roofMap) : patchSourceTriangleCount(activePatch.tiles, activePatch.family, spectreDetail);
  const fillSub = clampQuadraticSubdivision(
    Math.max(intSetting(settings, 'hyp_fill_subdiv', 1, 8), minFillSubdivisionForFamily(activePatch.family), MIN_BORDER_SURFACE_SUBDIVISION),
    sourceTriCount,
    MAX_FILL_VERTEX_COUNT,
  );

  const sourceOverlayAttachment = (
    tile: Tile,
    sourceCenter: Point,
    ring: number,
    typeValue: number,
  ): { sampler: (point: Point) => SurfaceSample | null; shape: number } => {
    const roof = roofMap?.get(tile) ?? null;
    if (roof) {
      return {
        sampler: (point: Point): SurfaceSample => roofSampleAt(tile, roof, point),
        shape: 1,
      };
    }
    const surfaces = projectedFillSurfaceByEdge(
      tile,
      sourceCenter,
      projector,
      snap,
      fillSub,
      radius * 0.34 * (0.65 + ring * 0.35 + typeValue * 0.18),
      activePatch.family,
      spectreDetail,
      null,
    );
    const surface = buildSurfaceIndex(surfaces.all);
    return {
      sampler: (point: Point): SurfaceSample | null => {
        const projected = snap(projector.map(point[0], point[1]));
        const bounds: Bounds2 = {
          minX: projected[0] - SURFACE_BOUNDS_EPS,
          maxX: projected[0] + SURFACE_BOUNDS_EPS,
          minY: projected[1] - SURFACE_BOUNDS_EPS,
          maxY: projected[1] + SURFACE_BOUNDS_EPS,
        };
        let sample: SurfaceSample | null = null;
        forEachSurfaceCandidate(surface, bounds, candidate => {
          if (sample || !pointInSurfaceTri(projected, candidate)) return;
          sample = sampleSurfaceTri(projected, candidate);
        });
        if (sample) return sample;
        let nearestSurface: SurfaceTri | null = null;
        let nearestDistance = Infinity;
        for (const candidate of surface.surfaces) {
          const distance = distanceToSurfaceTri(projected, candidate);
          if (distance >= nearestDistance) continue;
          nearestDistance = distance;
          nearestSurface = candidate;
        }
        return nearestSurface ? sampleSurfaceTri(projected, nearestSurface) : null;
      },
      shape: 0,
    };
  };

  const overlayBounds = (): { minX: number; maxX: number; minY: number; maxY: number } => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const tile of activePatch.tiles) {
      for (const vert of tile.verts) {
        minX = Math.min(minX, vert[0]);
        maxX = Math.max(maxX, vert[0]);
        minY = Math.min(minY, vert[1]);
        maxY = Math.max(maxY, vert[1]);
      }
    }
    return { minX, maxX, minY, maxY };
  };

  const emitAmmannBeenkerGraditVanDongenModes = (): void => {
    for (let tileIndex = 0; tileIndex < activePatch.tiles.length; tileIndex++) {
      const tile = activePatch.tiles[tileIndex]!;
      if (tile.verts.length !== 4) continue;
      const lengths = tile.verts.map((a, i) => {
        const b = tile.verts[(i + 1) % tile.verts.length]!;
        return Math.hypot(b[0] - a[0], b[1] - a[1]);
      });
      const minLength = Math.min(...lengths);
      const maxLength = Math.max(...lengths);
      if (minLength <= SEGMENT_EPS || maxLength / minLength > 1.08) continue;
      const edgeA: Point = [tile.verts[1]![0] - tile.verts[0]![0], tile.verts[1]![1] - tile.verts[0]![1]];
      const edgeB: Point = [tile.verts[2]![0] - tile.verts[1]![0], tile.verts[2]![1] - tile.verts[1]![1]];
      const dot = Math.abs(edgeA[0] * edgeB[0] + edgeA[1] * edgeB[1]);
      const isSquare = dot / Math.max(lengths[0]! * lengths[1]!, SEGMENT_EPS) < 0.08;
      if (!isSquare) continue;
      const sourceCenter = centroid(tile.verts);
      const orientSource = orientation(tile, activePatch.family);
      const sideSource: Point = [-orientSource[1], orientSource[0]];
      const ring = rings[tileIndex] ?? 0;
      const topologyValue = topologyForTile(tileIndex);
      const attachment = sourceOverlayAttachment(tile, sourceCenter, ring, tile.type / maxType);
      const step = Math.max(minLength, SEGMENT_EPS);
      const gx = Math.round((sourceCenter[0] * orientSource[0] + sourceCenter[1] * orientSource[1]) / step);
      const gy = Math.round((sourceCenter[0] * sideSource[0] + sourceCenter[1] * sideSource[1]) / step);
      const rowBit = beattyBit(gx);
      const columnBit = beattyBit(gy);
      const cornerIndex = rowBit === 0
        ? (columnBit === 0 ? 0 : 3)
        : (columnBit === 0 ? 1 : 2);
      const leftIndex = (cornerIndex + 3) % 4;
      const rightIndex = (cornerIndex + 1) % 4;
      const oppositeIndex = (cornerIndex + 2) % 4;
      if (sourceDetail === 1) {
        const firstCorner = rowBit === columnBit ? 0 : 1;
        const secondCorner = (firstCorner + 2) % 4;
        const arcForCorner = (corner: number): Point[] => {
          const previous = (corner + 3) % 4;
          const next = (corner + 1) % 4;
          const start: Point = [
            (tile.verts[corner]![0] + tile.verts[previous]![0]) * 0.5,
            (tile.verts[corner]![1] + tile.verts[previous]![1]) * 0.5,
          ];
          const end: Point = [
            (tile.verts[corner]![0] + tile.verts[next]![0]) * 0.5,
            (tile.verts[corner]![1] + tile.verts[next]![1]) * 0.5,
          ];
          return sampleCircleArc(tile.verts[corner]!, step * 0.5, start, end, 12);
        };
        const arcA = arcForCorner(firstCorner);
        const arcB = arcForCorner(secondCorner);
        projectOverlayPolyline(arcA, sourceCenter, 0, ring, orientSource, tile.verts, topologyValue, 0.9, attachment.sampler, attachment.shape);
        projectOverlayPolyline(arcB, sourceCenter, 1, ring, orientSource, tile.verts, topologyValue, 0.9, attachment.sampler, attachment.shape);
        continue;
      }
      if (sourceDetail === 2) {
        projectOverlayTriangle(
          [tile.verts[cornerIndex]!, tile.verts[rightIndex]!, tile.verts[leftIndex]!],
          sourceCenter,
          5,
          ring,
          orientSource,
          tile.verts,
          topologyValue,
        );
        projectOverlayTriangle(
          [tile.verts[rightIndex]!, tile.verts[oppositeIndex]!, tile.verts[leftIndex]!],
          sourceCenter,
          6,
          ring,
          orientSource,
          tile.verts,
          topologyValue,
        );
      }
      projectOverlayPolyline(
        [tile.verts[leftIndex]!, tile.verts[rightIndex]!],
        sourceCenter,
        2,
        ring,
        orientSource,
        tile.verts,
        topologyValue,
        0.55,
        attachment.sampler,
        attachment.shape,
      );
    }
  };

  const emitAmmannBeenkerBars = (): void => {
    const bounds = overlayBounds();
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    const edgeLengths: number[] = [];
    for (const tile of activePatch.tiles) {
      for (let index = 0; index < tile.verts.length; index++) {
        const a = tile.verts[index]!;
        const b = tile.verts[(index + 1) % tile.verts.length]!;
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length > SEGMENT_EPS) edgeLengths.push(length);
      }
    }
    edgeLengths.sort((a, b) => a - b);
    const spacing = edgeLengths[Math.floor(edgeLengths.length * 0.5)] ?? span / 16;
    if (!Number.isFinite(spacing) || spacing <= SEGMENT_EPS) return;
    type AmmannTileSurface = {
      sourceVerts: Point[];
      sourceCenter: Point;
      projectedCenter: Point;
      orient: Point;
      scaleVerts: Point[];
      tileScale: number;
      typeValue: number;
      ring: number;
      localFrame: AtlasFrame;
      topology: TopologyQuad;
      surface: SurfaceIndex;
    };
    const spec = familySpec(activePatch.family);
    const maxType = Math.max(1, typeBucketCount(activePatch.tiles, activePatch.family, spec) - 1);
    const tileSurfaces: AmmannTileSurface[] = [];
    for (let tileIndex = 0; tileIndex < activePatch.tiles.length; tileIndex++) {
      const tile = activePatch.tiles[tileIndex]!;
      const sourceVerts = sourceBoundaryVerts(tile, activePatch.family, spectreDetail);
      const sourceCenter = centroid(sourceVerts);
      const projectedCenter = snap(projector.map(sourceCenter[0], sourceCenter[1]));
      const orientSource = orientation(tile, activePatch.family);
      const orientA = projectedCenter;
      const orientB = snap(projector.map(sourceCenter[0] + orientSource[0], sourceCenter[1] + orientSource[1]));
      const odx = orientB[0] - orientA[0];
      const ody = orientB[1] - orientA[1];
      const olen = Math.hypot(odx, ody);
      const orient: Point = olen > SEGMENT_EPS ? [odx / olen, ody / olen] : [1, 0];
      const typeValue = tile.type / maxType;
      const ring = rings[tileIndex] ?? 0;
      const reliefApex = radius * 0.34 * (0.65 + ring * 0.35 + typeValue * 0.18);
      const roof = roofMap?.get(tile) ?? null;
      const surfaces = projectedFillSurfaceByEdge(
        tile,
        sourceCenter,
        projector,
        snap,
        fillSub,
        reliefApex,
        activePatch.family,
        spectreDetail,
        roof,
      );
      if (surfaces.all.length === 0) continue;
      tileSurfaces.push({
        sourceVerts,
        sourceCenter,
        projectedCenter,
        orient,
        scaleVerts: sourceVerts,
        tileScale: projectedTileRadius(sourceVerts, sourceCenter, projector, snap),
        typeValue,
        ring,
        localFrame: projectedFrame(sourceVerts, projectedCenter, orient),
        topology: topologyForTile(tileIndex),
        surface: buildSurfaceIndex(surfaces.all),
      });
    }
    if (tileSurfaces.length === 0) return;
    const emitClippedStrip = (
      a: Point,
      b: Point,
      tile: AmmannTileSurface,
      typeValue: number,
      orient: Point,
    ): void => {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len <= SEGMENT_EPS) return;
      const halfWidth = radius * 0.006 * 0.34;
      const nx = -dy / len;
      const ny = dx / len;
      const strip: Point[] = [
        [a[0] + nx * halfWidth, a[1] + ny * halfWidth],
        [b[0] + nx * halfWidth, b[1] + ny * halfWidth],
        [b[0] - nx * halfWidth, b[1] - ny * halfWidth],
        [a[0] - nx * halfWidth, a[1] - ny * halfWidth],
      ];
      const stripBounds: Bounds2 = {
        minX: Math.min(strip[0]![0], strip[1]![0], strip[2]![0], strip[3]![0]) - SURFACE_BOUNDS_EPS,
        maxX: Math.max(strip[0]![0], strip[1]![0], strip[2]![0], strip[3]![0]) + SURFACE_BOUNDS_EPS,
        minY: Math.min(strip[0]![1], strip[1]![1], strip[2]![1], strip[3]![1]) - SURFACE_BOUNDS_EPS,
        maxY: Math.max(strip[0]![1], strip[1]![1], strip[2]![1], strip[3]![1]) + SURFACE_BOUNDS_EPS,
      };
      forEachSurfaceCandidate(tile.surface, stripBounds, surface => {
        const clipped = clipPolygonToSurfaceTri(strip, surface);
        if (clipped.length < 3) return;
        for (let i = 1; i < clipped.length - 1; i++) {
          const p0 = clipped[0]!;
          const p1 = clipped[i]!;
          const p2 = clipped[i + 1]!;
          pushOverlayTriangle(
            positions,
            tileType,
            tileRing,
            tileOrient,
            tileCenter,
            tileRelief,
            tileShape,
            tileScale,
            tileLocal,
            tileTopology,
            edgeSide,
            edgeSlope,
            p0,
            p1,
            p2,
            typeValue,
            tile.ring,
            orient,
            tile.projectedCenter,
            tile.tileScale,
            tile.localFrame,
            tile.topology,
            sampleSurfaceTri(p0, surface),
            sampleSurfaceTri(p1, surface),
            sampleSurfaceTri(p2, surface),
            0,
          );
        }
      });
    };
    const familyDirectionCount = activePatch.family === 3 ? 6 : activePatch.family === 5 ? 4 : 5;
    for (let family = 0; family < familyDirectionCount; family++) {
      const angle = family * Math.PI / familyDirectionCount;
      const normal: Point = [Math.cos(angle), Math.sin(angle)];
      const dir: Point = [-normal[1], normal[0]];
      const residues: number[] = [];
      for (const tile of activePatch.tiles) {
        for (const vert of tile.verts) {
          const raw = vert[0] * normal[0] + vert[1] * normal[1];
          residues.push(((raw % spacing) + spacing) % spacing);
        }
      }
      const binCount = 32;
      const bins = Array.from({ length: binCount }, () => ({ count: 0, sum: 0 }));
      for (const residue of residues) {
        const bin = Math.min(binCount - 1, Math.floor(residue / spacing * binCount));
        bins[bin]!.count += 1;
        bins[bin]!.sum += residue;
      }
      let bestBin = bins[0]!;
      for (const bin of bins) {
        if (bin.count > bestBin.count) bestBin = bin;
      }
      const phase = bestBin.count > 0 ? bestBin.sum / bestBin.count : spacing * 0.5;
      let minDot = Infinity;
      let maxDot = -Infinity;
      for (const tile of tileSurfaces) {
        for (const vert of tile.sourceVerts) {
          const d = vert[0] * normal[0] + vert[1] * normal[1];
          minDot = Math.min(minDot, d);
          maxDot = Math.max(maxDot, d);
        }
      }
      if (!Number.isFinite(minDot) || !Number.isFinite(maxDot)) continue;
      const first = Math.floor((minDot - phase) / spacing) - 1;
      const last = Math.ceil((maxDot - phase) / spacing) + 1;
      for (let line = first; line <= last; line++) {
        const offset = phase + line * spacing;
        const mid: Point = [normal[0] * offset, normal[1] * offset];
        for (const tile of tileSurfaces) {
          const segment = clipLineToConvexPolygon(mid, dir, tile.scaleVerts);
          if (!segment) continue;
          const a = snap(projector.map(segment[0]![0], segment[0]![1]));
          const b = snap(projector.map(segment[1]![0], segment[1]![1]));
          const orientA = tile.projectedCenter;
          const orientB = snap(projector.map(tile.sourceCenter[0] + dir[0], tile.sourceCenter[1] + dir[1]));
          const odx = orientB[0] - orientA[0];
          const ody = orientB[1] - orientA[1];
          const olen = Math.hypot(odx, ody);
          const projectedDir: Point = olen > SEGMENT_EPS ? [odx / olen, ody / olen] : tile.orient;
          emitClippedStrip(a, b, tile, 2, projectedDir);
        }
      }
    }
  };

  if (overlayKind === 'ammann-beenker-truchet') {
    if (sourceDetail === 3) {
      emitAmmannBeenkerBars();
    } else {
      emitAmmannBeenkerGraditVanDongenModes();
    }
  }

  if (overlayKind === 'penrose-robinson') {
    emitRobinsonMatchingCurves();
  }

  if (positions.length === 0) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions.view(), 3));
  setEdgeCustomAttributes(
    geometry,
    tileType.view(),
    tileRing.view(),
    tileOrient.view(),
    tileCenter.view(),
    tileRelief.view(),
    tileShape.view(),
    tileScale.view(),
    tileLocal.view(),
    tileTopology.view(),
    edgeSide.view(),
    edgeSlope.view(),
  );
  geometry.computeBoundingSphere();
  applyPatchBoundingSphere(geometry, patch);
  return geometry;
}

export function debugSpectreBorderLayoutForVerifier(patch: Patch, settings: Settings): SpectreBorderLayoutDebugEdge[] {
  if (patch.family !== SPECTRE_FAMILY_ID) return [];
  const radius = averageTileRadius(patch.tiles);
  const relief = radius * 0.34;
  const spectreDetail = spectreMeshDetailForPatch(patch.tiles, patch.family);
  const sourceTriCount = patchSourceTriangleCount(patch.tiles, patch.family, spectreDetail);
  const requestedFillSub = intSetting(settings, 'hyp_fill_subdiv', 1, 8);
  const fillSub = clampQuadraticSubdivision(
    Math.max(requestedFillSub, minFillSubdivisionForFamily(patch.family)),
    sourceTriCount,
    MAX_FILL_VERTEX_COUNT,
  );
  const borderSurfaceFillSub = clampQuadraticSubdivision(
    Math.max(requestedFillSub, MIN_BORDER_SURFACE_SUBDIVISION, minFillSubdivisionForFamily(patch.family)),
    sourceTriCount,
    MAX_FILL_VERTEX_COUNT,
  );
  const tileVertexCount = patchBorderSourceCount(patch.tiles, patch.family);
  const sub = clampLinearSubdivision(
    intSetting(settings, 'hyp_border_subdiv', 1, 32),
    tileVertexCount,
    MAX_BORDER_VERTEX_COUNT,
    Math.max(48, 32 * fillSub),
  );
  const projector = createProjector(settings);
  const snap = createVertexSnapper(projector.enabled ? 1e-5 : 1e-7);
  const layout = borderLayout(patch, projector, snap, sub, borderSurfaceFillSub, relief, spectreDetail, null);
  const rows: SpectreBorderLayoutDebugEdge[] = [];
  for (let tileIndex = 0; tileIndex < layout.length; tileIndex++) {
    const tile = layout[tileIndex]!;
    for (let edgeIndex = 0; edgeIndex < tile.edges.length; edgeIndex++) {
      const edge = tile.edges[edgeIndex]!;
      const first = edge.pts[0] ?? tile.centroid;
      const last = edge.pts[edge.pts.length - 1] ?? first;
      rows.push({
        tileIndex,
        edgeIndex,
        logicalEdgeCount: tile.edges.length,
        curved: edge.curved === true,
        sampleCount: edge.pts.length,
        first,
        last,
        maxChordDistance: maxDistanceFromChord(edge.pts),
        visible: edge.visible,
        surfaceHints: [(edgeIndex + tile.edges.length - 1) % tile.edges.length, edgeIndex, (edgeIndex + 1) % tile.edges.length],
      });
    }
  }
  return rows;
}

function borderLayoutCacheKey(
  settings: Settings,
  family: number,
  fillSub: number,
  surfaceFillSub: number,
  borderSub: number,
  relief: number,
  spectreDetail: SpectreMeshDetail,
): string {
  return [
    intSetting(settings, 'projection', 0, 1),
    numberSetting(settings, 'hyp_scale', 0, 100),
    fillSub,
    surfaceFillSub,
    borderSub,
    spectreDetail.key,
    relief,
    familySupportsWieringaRoof(family) ? intSetting(settings, 'surface_relief_mode', 0, 1) : 0,
  ].join(':');
}

function maxDistanceFromChord(points: readonly Point[]): number {
  if (points.length <= 2) return 0;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  const len = Math.hypot(dx, dy);
  if (len <= SEGMENT_EPS) return 0;
  let maxDistance = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    maxDistance = Math.max(maxDistance, Math.abs(dx * (first[1] - p[1]) - (first[0] - p[0]) * dy) / len);
  }
  return maxDistance;
}

function cachedBorderLayout(patch: Patch, key: string, build: () => BorderLayoutTile[]): BorderLayoutTile[] {
  const entries = borderLayoutCache.get(patch);
  const existingIndex = entries?.findIndex(entry => entry.key === key) ?? -1;
  if (entries && existingIndex >= 0) {
    const [entry] = entries.splice(existingIndex, 1);
    entries.unshift(entry!);
    return entry!.layout;
  }
  const layout = build();
  const next = entries ?? [];
  next.unshift({ key, layout });
  if (next.length > BORDER_LAYOUT_CACHE_LIMIT) next.length = BORDER_LAYOUT_CACHE_LIMIT;
  if (!entries) borderLayoutCache.set(patch, next);
  return layout;
}

function borderLayout(
  patch: Patch,
  projector: Projector,
  snap: Snapper,
  sub: number,
  fillSub: number,
  relief: number,
  spectreDetail: SpectreMeshDetail,
  roofMap: Map<Tile, WieringaRoofTile> | null,
): BorderLayoutTile[] {
  const visibleKeys = collectVisibleEdgeKeys(patch);
  const spec = familySpec(patch.family);
  const maxType = Math.max(1, typeBucketCount(patch.tiles, patch.family, spec) - 1);
  const rings = tileRings(patch.tiles, spec);
  const topologyScalars = tileTopologyScalars(patch, rings);
  const layout: BorderLayoutTile[] = [];
  for (let tileIndex = 0; tileIndex < patch.tiles.length; tileIndex++) {
    const tile = patch.tiles[tileIndex]!;
    const sourceVerts = sourceBoundaryVerts(tile, patch.family, spectreDetail);
    const spectreFrame = spectreFrameForTile(tile, patch.family, projector, snap);
    const cen = spectreFrame?.sourceCenter ?? centroid(sourceVerts);
    const projCentroid = spectreFrame?.center ?? snap(projector.map(cen[0], cen[1]));
    const outlineSource = isSpectreCurveTile(tile, patch.family)
      ? spectreCurvePolygon(tile, SPECTRE_BORDER_SAMPLES_PER_SIDE)
      : tile.verts;
    const outline = outlineSource.map(([x, y]) => snap(projector.map(x, y)));
    const tileEdges: TileBorder['edges'] = [];
    const edgeGroups = logicalBoundaryEdgeGroups(tile, patch.family);
    if (isSpectreCurveTile(tile, patch.family)) {
      const anchors = spectreAnchors(tile);
      const samples = Math.max(sub, SPECTRE_BORDER_SAMPLES_PER_SIDE);
      for (let side = 0; side < SPECTRE_LOGICAL_SIDE_COUNT; side++) {
        const pts: Point[] = [];
        for (let sample = 0; sample <= samples; sample++) {
          const p = spectreCurvePoint(anchors, side, sample / samples);
          pts.push(snap(projector.map(p[0], p[1])));
        }
        const a = anchors[side]!;
        const b = anchors[(side + 1) % SPECTRE_LOGICAL_SIDE_COUNT]!;
        tileEdges.push({ pts, visible: visibleKeys.has(edgeKey(a, b)), curved: true });
      }
    } else {
      for (const edgeGroup of edgeGroups) {
        const pts: Point[] = [];
        let visible = false;
        for (let groupIndex = 0; groupIndex < edgeGroup.length; groupIndex++) {
          const edgeIndex = edgeGroup[groupIndex]!;
          const a = tile.verts[edgeIndex]!;
          const b = tile.verts[(edgeIndex + 1) % tile.verts.length]!;
          visible = visible || visibleKeys.has(edgeKey(a, b));
          for (let k = groupIndex === 0 ? 0 : 1; k <= sub; k++) {
            const p = lerp2(a, b, k / sub);
            pts.push(snap(projector.map(p[0], p[1])));
          }
        }
        tileEdges.push({ pts, visible });
      }
    }
    const ring = rings[tileIndex] ?? 0;
    const typeValue = tile.type / maxType;
    const reliefApex = relief * (0.65 + ring * 0.35 + typeValue * 0.18);
    const tileScale = spectreFrame?.scale ?? projectedTileRadius(sourceVerts, cen, projector, snap);
    const roof = roofMap?.get(tile) ?? null;
    const surfaces = projectedFillSurfaceByEdge(tile, cen, projector, snap, fillSub, reliefApex, patch.family, spectreDetail, roof);
    const localSurfaceHints = projectedTileIsConvex(tileEdges, projCentroid);
    const surfaceIndexByEdge = edgeGroups.map((edgeGroup) => {
      const grouped: SurfaceTri[] = [];
      for (const edgeIndex of edgeGroup) grouped.push(...surfaces.byEdge[edgeIndex]!);
      return buildSurfaceIndex(grouped);
    });
    layout.push({
      edges: tileEdges,
      centroid: projCentroid,
      outline,
      surface: buildSurfaceIndex(surfaces.all),
      surfaceByEdge: surfaceIndexByEdge,
      localSurfaceHints,
      reliefApex,
      typeValue,
      shapeValue: roof || patch.family === SPECTRE_FAMILY_ID ? 1 : 0,
      tileScale,
      ring,
      orient: spectreFrame?.orient ?? orientation(tile, patch.family),
      center: projCentroid,
      localFrame: sourceAtlasFrame(outline, projCentroid, spectreFrame?.orient ?? orientation(tile, patch.family)),
      topology: [
        topologyScalars.degree[tileIndex] ?? 0,
        topologyScalars.motif[tileIndex] ?? 0,
        topologyScalars.relaxed[tileIndex] ?? 0,
        topologyScalars.biharmonic[tileIndex] ?? 0,
      ],
    });
  }
  return layout;
}

function buildSurfaceIndex(surfaces: SurfaceTri[]): SurfaceIndex {
  if (surfaces.length <= 8) {
    return { surfaces, axis: 0, min: 0, invBinSize: 0, bins: null };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const surface of surfaces) {
    minX = Math.min(minX, surface.minX);
    maxX = Math.max(maxX, surface.maxX);
    minY = Math.min(minY, surface.minY);
    maxY = Math.max(maxY, surface.maxY);
  }
  const xRange = maxX - minX;
  const yRange = maxY - minY;
  const axis: 0 | 1 = xRange >= yRange ? 0 : 1;
  const range = axis === 0 ? xRange : yRange;
  if (range <= SURFACE_BOUNDS_EPS) {
    return { surfaces, axis, min: axis === 0 ? minX : minY, invBinSize: 0, bins: null };
  }
  const binCount = Math.max(4, Math.min(16, Math.ceil(Math.sqrt(surfaces.length))));
  const min = axis === 0 ? minX : minY;
  const invBinSize = binCount / range;
  const bins: SurfaceTri[][] = Array.from({ length: binCount }, () => []);
  for (const surface of surfaces) {
    const lo = axis === 0 ? surface.minX : surface.minY;
    const hi = axis === 0 ? surface.maxX : surface.maxY;
    const first = clampSurfaceBin(Math.floor((lo - min) * invBinSize), binCount);
    const last = clampSurfaceBin(Math.floor((hi - min) * invBinSize), binCount);
    for (let bin = first; bin <= last; bin++) bins[bin]!.push(surface);
  }
  return { surfaces, axis, min, invBinSize, bins };
}

function forEachSurfaceCandidate(index: SurfaceIndex | undefined, bounds: Bounds2, visit: (surface: SurfaceTri) => void): void {
  if (!index) return;
  const bins = index.bins;
  if (!bins) {
    for (const surface of index.surfaces) {
      if (boundsOverlap(bounds, surface)) visit(surface);
    }
    return;
  }
  const mark = surfaceQueryMark++;
  const lo = index.axis === 0 ? bounds.minX : bounds.minY;
  const hi = index.axis === 0 ? bounds.maxX : bounds.maxY;
  const first = clampSurfaceBin(Math.floor((lo - index.min) * index.invBinSize), bins.length);
  const last = clampSurfaceBin(Math.floor((hi - index.min) * index.invBinSize), bins.length);
  for (let bin = first; bin <= last; bin++) {
    for (const surface of bins[bin]!) {
      if (surface.queryMark === mark) continue;
      surface.queryMark = mark;
      if (boundsOverlap(bounds, surface)) visit(surface);
    }
  }
}

function clampSurfaceBin(bin: number, binCount: number): number {
  return Math.max(0, Math.min(binCount - 1, bin));
}

function tileIntersectsBounds(tile: Tile, bounds: Bounds2): boolean {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of tile.verts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return maxX >= bounds.minX
    && minX <= bounds.maxX
    && maxY >= bounds.minY
    && minY <= bounds.maxY;
}

function patchBounds(tiles: readonly Tile[]): Bounds2 {
  if (tiles.length === 0) return { minX: -1, maxX: 1, minY: -1, maxY: 1 };
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const tile of tiles) {
    for (const [x, y] of tile.verts) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, maxX, minY, maxY };
}

function boundsSphere(bounds: Bounds2): Sphere {
  const cx = (bounds.minX + bounds.maxX) * 0.5;
  const cy = (bounds.minY + bounds.maxY) * 0.5;
  const radius = Math.max(Math.hypot(bounds.maxX - cx, bounds.maxY - cy), 1e-6);
  return new Sphere(new Vector3(cx, cy, 0), radius);
}

function applyPatchBoundingSphere(geometry: BufferGeometry, patch: Patch): void {
  geometry.boundingSphere = boundsSphere(patchBounds(patch.tiles));
}

function boundsOverlap(bounds: Bounds2, surface: SurfaceTri): boolean {
  return bounds.maxX >= surface.minX
    && bounds.minX <= surface.maxX
    && bounds.maxY >= surface.minY
    && bounds.minY <= surface.maxY;
}

function projectedFillSurfaceByEdge(
  tile: Tile,
  center: Point,
  projector: Projector,
  snap: Snapper,
  fillSub: number,
  reliefApex: number,
  family: number,
  spectreDetail: SpectreMeshDetail,
  roof: WieringaRoofTile | null,
): { byEdge: SurfaceTri[][]; all: SurfaceTri[] } {
  const sourceVerts = sourceBoundaryVerts(tile, family, spectreDetail);
  const sideCount = family === SPECTRE_FAMILY_ID ? SPECTRE_LOGICAL_SIDE_COUNT : tile.verts.length;
  const spectreReference = family === SPECTRE_FAMILY_ID
    ? spectreReliefReference(center, sourceVerts)
    : 1;
  const byEdge: SurfaceTri[][] = Array.from({ length: sideCount }, () => []);
  const all: SurfaceTri[] = [];
  const project = (p: Point3): SurfaceVertex => {
    const [x, y] = snap(projector.map(p[0], p[1]));
    return { p: [x, y], relief: p[2] };
  };
  const sampleRelief = (p: Point3): Point3 => {
    if (family !== SPECTRE_FAMILY_ID) return p;
    return [p[0], p[1], spectreReliefSampleAt([p[0], p[1]], sourceVerts, reliefApex, spectreReference).relief];
  };
  const pointInSourceTri = (a: Point3, b: Point3, c: Point3, i: number, j: number): Point3 => {
    const k = fillSub - i - j;
    const fa = i / fillSub;
    const fb = j / fillSub;
    const fc = k / fillSub;
    return [
      fa * a[0] + fb * b[0] + fc * c[0],
      fa * a[1] + fb * b[1] + fc * c[1],
      fa * a[2] + fb * b[2] + fc * c[2],
    ];
  };
  const push = (edges: readonly number[], a: Point3, b: Point3, c: Point3): void => {
    const va = project(sampleRelief(a));
    const vb = project(sampleRelief(b));
    const vc = project(sampleRelief(c));
    if (Math.abs(signedArea([va.p, vb.p, vc.p])) <= AREA_EPS) return;
    const surface = {
      a: va,
      b: vb,
      c: vc,
      minX: Math.min(va.p[0], vb.p[0], vc.p[0]) - SURFACE_BOUNDS_EPS,
      maxX: Math.max(va.p[0], vb.p[0], vc.p[0]) + SURFACE_BOUNDS_EPS,
      minY: Math.min(va.p[1], vb.p[1], vc.p[1]) - SURFACE_BOUNDS_EPS,
      maxY: Math.max(va.p[1], vb.p[1], vc.p[1]) + SURFACE_BOUNDS_EPS,
      queryMark: 0,
    };
    all.push(surface);
    for (const edgeIndex of edges) byEdge[edgeIndex]!.push(surface);
  };
  const sourceTriangles = roof ? roofSourceTriangles(tile, roof) : tileSourceTriangles(tile, center, reliefApex, family, spectreDetail);
  for (const source of sourceTriangles) {
    if (fillSub <= 1) {
      push(source.edges, source.a, source.b, source.c);
      continue;
    }
    for (let i = 0; i < fillSub; i++) {
      for (let j = 0; j < fillSub - i; j++) {
        const a0 = pointInSourceTri(source.a, source.b, source.c, i, j);
        const b0 = pointInSourceTri(source.a, source.b, source.c, i + 1, j);
        const c0 = pointInSourceTri(source.a, source.b, source.c, i, j + 1);
        push(source.edges, a0, b0, c0);
        if (j < fillSub - i - 1) {
          const a1 = pointInSourceTri(source.a, source.b, source.c, i + 1, j);
          const b1 = pointInSourceTri(source.a, source.b, source.c, i + 1, j + 1);
          const c1 = pointInSourceTri(source.a, source.b, source.c, i, j + 1);
          push(source.edges, a1, b1, c1);
        }
      }
    }
  }
  return { byEdge, all };
}

function projectedTileIsConvex(edges: TileBorder['edges'], center: Point): boolean {
  const outline: Point[] = [];
  for (const edge of edges) {
    for (let i = 0; i < edge.pts.length - 1; i++) outline.push(edge.pts[i]!);
  }
  const area = signedArea(outline);
  if (Math.abs(area) <= SEGMENT_EPS) return false;
  const ccw = area > 0;
  for (let i = 0; i < outline.length; i++) {
    const prev = outline[(i - 1 + outline.length) % outline.length]!;
    const curr = outline[i]!;
    const next = outline[(i + 1) % outline.length]!;
    const turn = (curr[0] - prev[0]) * (next[1] - curr[1]) - (curr[1] - prev[1]) * (next[0] - curr[0]);
    if (ccw ? turn < -SURFACE_BOUNDS_EPS : turn > SURFACE_BOUNDS_EPS) return false;
    const centerSide = (next[0] - curr[0]) * (center[1] - curr[1]) - (next[1] - curr[1]) * (center[0] - curr[0]);
    if (ccw ? centerSide < -SURFACE_BOUNDS_EPS : centerSide > SURFACE_BOUNDS_EPS) return false;
  }
  return true;
}

function clipPolygonToSurfaceTri(poly: Point[], surface: SurfaceTri): Point[] {
  let output = removeNearDuplicatePoints(poly);
  const clip = [surface.a.p, surface.b.p, surface.c.p];
  if (Math.abs(signedArea(clip)) <= AREA_EPS) return [];
  const ccw = signedArea(clip) >= 0;
  for (let i = 0; i < 3; i++) {
    const a = clip[i]!;
    const b = clip[(i + 1) % 3]!;
    const input = output;
    output = [];
    if (input.length === 0) break;
    let prev = input[input.length - 1]!;
    let prevDistance = halfPlaneDistance(prev, a, b, ccw);
    let prevInside = prevDistance >= -CLIP_DISTANCE_EPS;
    for (const curr of input) {
      const currDistance = halfPlaneDistance(curr, a, b, ccw);
      const currInside = currDistance >= -CLIP_DISTANCE_EPS;
      if (currInside) {
        if (!prevInside) output.push(halfPlaneIntersection(prev, curr, prevDistance, currDistance));
        output.push(curr);
      } else if (prevInside) {
        output.push(halfPlaneIntersection(prev, curr, prevDistance, currDistance));
      }
      prev = curr;
      prevDistance = currDistance;
      prevInside = currInside;
    }
    output = removeNearDuplicatePoints(output);
  }
  return Math.abs(signedArea(output)) > AREA_EPS ? output : [];
}

function pointInSurfaceTri(p: Point, surface: SurfaceTri): boolean {
  const tri = [surface.a.p, surface.b.p, surface.c.p];
  if (Math.abs(signedArea(tri)) <= AREA_EPS) return false;
  const ccw = signedArea(tri) >= 0;
  for (let i = 0; i < 3; i++) {
    if (halfPlaneDistance(p, tri[i]!, tri[(i + 1) % 3]!, ccw) < -CLIP_DISTANCE_EPS) return false;
  }
  return true;
}

function distanceToSurfaceTri(p: Point, surface: SurfaceTri): number {
  if (pointInSurfaceTri(p, surface)) return 0;
  return Math.min(
    distanceToSegment(p, surface.a.p, surface.b.p),
    distanceToSegment(p, surface.b.p, surface.c.p),
    distanceToSegment(p, surface.c.p, surface.a.p),
  );
}

function sampleSurfaceTri(p: Point, surface: SurfaceTri): SurfaceSample {
  const a = surface.a;
  const b = surface.b;
  const c = surface.c;
  const v0x = b.p[0] - a.p[0];
  const v0y = b.p[1] - a.p[1];
  const v1x = c.p[0] - a.p[0];
  const v1y = c.p[1] - a.p[1];
  const v2x = p[0] - a.p[0];
  const v2y = p[1] - a.p[1];
  const denom = v0x * v1y - v1x * v0y;
  if (Math.abs(denom) <= AREA_EPS) return { relief: a.relief, slopeX: 0, slopeY: 0 };
  const u = (v2x * v1y - v1x * v2y) / denom;
  const v = (v0x * v2y - v2x * v0y) / denom;
  const relief = a.relief * (1 - u - v) + b.relief * u + c.relief * v;
  const duDx = v1y / denom;
  const duDy = -v1x / denom;
  const dvDx = -v0y / denom;
  const dvDy = v0x / denom;
  const db = b.relief - a.relief;
  const dc = c.relief - a.relief;
  return {
    relief,
    slopeX: -(db * duDx + dc * dvDx),
    slopeY: -(db * duDy + dc * dvDy),
  };
}

function halfPlaneDistance(p: Point, a: Point, b: Point, ccw: boolean): number {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  return ccw ? cross : -cross;
}

function halfPlaneIntersection(p0: Point, p1: Point, d0: number, d1: number): Point {
  const rx = p1[0] - p0[0];
  const ry = p1[1] - p0[1];
  const denom = d0 - d1;
  if (Math.abs(denom) <= AREA_EPS) return d0 >= d1 ? p0 : p1;
  const t = Math.max(0, Math.min(1, d0 / denom));
  return [p0[0] + rx * t, p0[1] + ry * t];
}

function removeNearDuplicatePoints(points: Point[]): Point[] {
  const cleaned: Point[] = [];
  for (const p of points) {
    const prev = cleaned[cleaned.length - 1];
    if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > SURFACE_BOUNDS_EPS) cleaned.push(p);
  }
  if (cleaned.length > 1) {
    const first = cleaned[0]!;
    const last = cleaned[cleaned.length - 1]!;
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= SURFACE_BOUNDS_EPS) cleaned.pop();
  }
  return cleaned;
}

function emptyNumberLists(count: number): number[][] {
  const lists: number[][] = [];
  for (let i = 0; i < count; i++) lists.push([]);
  return lists;
}

function relaxScalarField(source: Float32Array, neighbors: number[][], boundary: Uint8Array, iterations: number): Float32Array {
  let current = new Float32Array(source);
  let next = new Float32Array(source.length);
  for (let iteration = 0; iteration < iterations; iteration++) {
    for (let i = 0; i < source.length; i++) {
      const list = neighbors[i] ?? [];
      if (boundary[i] || list.length === 0) {
        next[i] = source[i] ?? 0;
        continue;
      }
      let sum = 0;
      for (const neighbor of list) sum += current[neighbor] ?? 0;
      next[i] = sum / list.length;
    }
    const swap = current;
    current = next;
    next = swap;
  }
  return current;
}

function tileTopologyScalars(
  patch: Patch,
  rings: readonly number[],
): { degree: Float32Array; motif: Float32Array; relaxed: Float32Array; biharmonic: Float32Array } {
  const topology = collectEdgeTopology(patch);
  const tileCount = patch.tiles.length;
  const neighborTypes = emptyNumberLists(tileCount);
  const neighborIndices = emptyNumberLists(tileCount);
  const degree = new Float32Array(tileCount);
  const motif = new Float32Array(tileCount);
  const source = new Float32Array(tileCount);
  const boundary = new Uint8Array(tileCount);
  for (const edge of topology.edgesByKey.values()) {
    if (!topology.visibleKeys.has(edgeKey(edge.a, edge.b)) || edge.sides.length < 2) continue;
    for (const side of edge.sides) {
      const neighbors = neighborTypes[side.tileIndex];
      const indices = neighborIndices[side.tileIndex];
      if (!neighbors) continue;
      if (!indices) continue;
      for (const other of edge.sides) {
        if (other.tileIndex === side.tileIndex || indices.includes(other.tileIndex)) continue;
        neighbors.push(other.type);
        indices.push(other.tileIndex);
      }
    }
  }
  for (let tileIndex = 0; tileIndex < tileCount; tileIndex++) {
    const tile = patch.tiles[tileIndex];
    const neighbors = neighborTypes[tileIndex] ?? [];
    const maxDegree = Math.max(1, tile?.verts.length ?? 1);
    degree[tileIndex] = Math.max(0, Math.min(1, neighbors.length / maxDegree));
    boundary[tileIndex] = neighbors.length < maxDegree ? 1 : 0;
    let hash = ((tile?.type ?? 0) + 1) * 2166136261;
    for (const type of neighbors.sort((a, b) => a - b)) {
      hash = Math.imul(hash ^ (type + 31), 16777619);
    }
    const motifValue = ((hash >>> 0) % 997) / 996;
    motif[tileIndex] = motifValue;
    source[tileIndex] = Math.max(0, Math.min(1, (rings[tileIndex] ?? 0) * 0.62 + motifValue * 0.38));
  }
  const relaxed = relaxScalarField(source, neighborIndices, boundary, 28);
  const biharmonic = relaxScalarField(relaxed, neighborIndices, boundary, 28);
  return { degree, motif, relaxed, biharmonic };
}

function collectEdgeTopology(patch: Patch): EdgeTopology {
  const edgesByKey = new Map<string, EdgeEntry>();
  for (let tileIndex = 0; tileIndex < patch.tiles.length; tileIndex++) {
    const tile = patch.tiles[tileIndex]!;
    for (let i = 0; i < tile.verts.length; i++) {
      const j = (i + 1) % tile.verts.length;
      const a = tile.verts[i]!;
      const b = tile.verts[j]!;
      const key = edgeKey(a, b);
      const entry = edgesByKey.get(key);
      const kind = edgeKind(patch.family, tile, i);
      const side = { tileIndex, edgeIndex: i, type: tile.type, kind, a, b };
      if (entry) {
        entry.sides.push(side);
      } else {
        edgesByKey.set(key, { a, b, sides: [side] });
      }
    }
  }
  const keys = new Set<string>();
  for (const edge of edgesByKey.values()) {
    if (
      edge.sides.length === 2
      && edge.sides[0]!.type === edge.sides[1]!.type
      && isComposedRobinsonEdge(patch.family, edge.sides[0]!.kind, edge.sides[1]!.kind)
    ) {
      continue;
    }
    keys.add(edgeKey(edge.a, edge.b));
  }
  return { edgesByKey, visibleKeys: keys };
}

function collectVisibleEdgeKeys(patch: Patch): Set<string> {
  return collectEdgeTopology(patch).visibleKeys;
}

function edgeKind(family: number, tile: Tile, edgeIndex: number): EdgeKind {
  if (penroseCompositionEdgeRuleForFamily(family) === 'none' || tile.verts.length !== 3) return 'edge';
  return edgeIndex === 2 ? 'base' : 'leg';
}

function isComposedRobinsonEdge(family: number, first: EdgeKind, second: EdgeKind): boolean {
  const rule = penroseCompositionEdgeRuleForFamily(family);
  if (rule === 'base-base') return first === 'base' && second === 'base';
  if (rule === 'leg-leg') return first === 'leg' && second === 'leg';
  return false;
}

function edgeKey(a: Point, b: Point): string {
  const ka = pointKey(a);
  const kb = pointKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function pointKey([x, y]: Point): string {
  return `${Math.round(x * SOURCE_EDGE_KEY_SCALE)},${Math.round(y * SOURCE_EDGE_KEY_SCALE)}`;
}

function createVertexSnapper(epsilon: number): Snapper {
  const seen = new Map<string, Point>();
  return ([x, y]) => {
    const key = `${Math.round(x / epsilon)},${Math.round(y / epsilon)}`;
    const existing = seen.get(key);
    if (existing) return existing;
    const snapped: Point = [x, y];
    seen.set(key, snapped);
    return snapped;
  };
}

function createProjector(settings: Settings): Projector {
  if (intSetting(settings, 'projection', 0, 1) !== 1) {
    return { enabled: false, map: (x: number, y: number) => [x, y] };
  }
  const scale = 0.05 + numberSetting(settings, 'hyp_scale', 0, 100) / 100 * 2.95;
  return {
    enabled: true,
    map: (x: number, y: number) => projectHyp(x, y, 0, 0, scale),
  };
}

function projectHyp(x: number, y: number, bx: number, by: number, scale: number): Point {
  const r = Math.hypot(x, y);
  const d = Math.tanh(r * scale * 0.5);
  const zx = r > 1e-6 ? x / r * d : 0;
  const zy = r > 1e-6 ? y / r * d : 0;
  const bb = bx * bx + by * by;
  const zz = zx * zx + zy * zy;
  const zb = zx * bx + zy * by;
  let denom = bb * zz + 2 * zb + 1;
  if (Math.abs(denom) < 1e-6) denom = 1e-6;
  return [
    ((1 - bb) * zx + (zz + 2 * zb + 1) * bx) / denom,
    ((1 - bb) * zy + (zz + 2 * zb + 1) * by) / denom,
  ];
}

function classify(tiles: Tile[], family: number, mode: number, colorCount: number): TileClasses {
  const spec = familySpec(family);
  const bucket = new Float32Array(tiles.length);
  if (mode === 0) {
    const n = typeBucketCount(tiles, family, spec);
    for (let i = 0; i < tiles.length; i++) bucket[i] = tiles[i]!.type % n;
    return { bucket, numBuckets: n };
  }
  if (mode === 3) return classifyPhase(tiles, family, spec);
  if (mode === 1) {
    const n = Math.max(1, spec.orientBuckets);
    if (spec.orientFromType) {
      for (let i = 0; i < tiles.length; i++) bucket[i] = tiles[i]!.type % n;
      return { bucket, numBuckets: n };
    }
    const span = spec.orientHalfTurn ? Math.PI : Math.PI * 2;
    const denom = span / n;
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i]!;
      const a = tile.verts[Math.min(spec.angA, tile.verts.length - 1)]!;
      const b = tile.verts[Math.min(spec.angB, tile.verts.length - 1)]!;
      let angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      if (angle < 0) angle += Math.PI * 2;
      if (spec.orientHalfTurn && angle >= Math.PI) angle -= Math.PI;
      bucket[i] = ((Math.floor((angle + denom * 0.5) / denom) % n) + n) % n;
    }
    return { bucket, numBuckets: n };
  }
  const rings = tileRings(tiles, spec);
  const n = Math.max(1, colorCount);
  for (let i = 0; i < tiles.length; i++) bucket[i] = Math.max(0, Math.min(n - 1, Math.floor((rings[i] ?? 0) * n)));
  return { bucket, numBuckets: n };
}

function classifyPhase(tiles: Tile[], family: number, spec: FamilySpec): TileClasses {
  const classCount = typeBucketCount(tiles, family, spec);
  const rings = tileRings(tiles, spec);
  if (family === 15) return classifyGailiunasPhase(tiles, classCount);

  // Phase mode is a continuous colour coordinate, not another discrete bucket
  // mode. Each natural tile class owns one equal segment of the palette span, and
  // ring depth inside that class moves through the segment. For Gailiunas spirals
  // below, the same idea uses arm as the class and construction order along the
  // arm as progress, because that is the canonical spiral coordinate.
  const minRing = new Array<number>(classCount).fill(Number.POSITIVE_INFINITY);
  const maxRing = new Array<number>(classCount).fill(Number.NEGATIVE_INFINITY);
  for (let i = 0; i < tiles.length; i++) {
    const cls = Math.max(0, Math.min(classCount - 1, tiles[i]!.type));
    const ring = rings[i] ?? 0;
    minRing[cls] = Math.min(minRing[cls]!, ring);
    maxRing[cls] = Math.max(maxRing[cls]!, ring);
  }
  const bucket = new Float32Array(tiles.length);
  const denom = Math.max(1, classCount);
  for (let i = 0; i < tiles.length; i++) {
    const cls = Math.max(0, Math.min(classCount - 1, tiles[i]!.type));
    const lo = Number.isFinite(minRing[cls]!) ? minRing[cls]! : 0;
    const hi = Number.isFinite(maxRing[cls]!) ? maxRing[cls]! : lo;
    const span = Math.max(1e-6, hi - lo);
    const progress = Math.max(0, Math.min(1, ((rings[i] ?? 0) - lo) / span));
    bucket[i] = (cls + progress) / denom;
  }
  return { bucket, numBuckets: 0 };
}

function classifyGailiunasPhase(tiles: Tile[], armCount: number): TileClasses {
  const perArmCounts = new Array<number>(armCount).fill(0);
  for (const tile of tiles) {
    const arm = Math.max(0, Math.min(armCount - 1, tile.type));
    perArmCounts[arm] = (perArmCounts[arm] ?? 0) + 1;
  }
  const seen = new Array<number>(armCount).fill(0);
  const bucket = new Float32Array(tiles.length);
  const denom = Math.max(1, armCount);
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]!;
    const arm = Math.max(0, Math.min(armCount - 1, tile.type));
    const count = perArmCounts[arm] ?? 1;
    const progress = count > 1 ? (seen[arm] ?? 0) / (count - 1) : 0;
    seen[arm] = (seen[arm] ?? 0) + 1;
    bucket[i] = (arm + progress) / denom;
  }
  return { bucket, numBuckets: 0 };
}

function bucketToPaletteIdx(bucket: number, numBuckets: number, colorCount: number, spreadPercent: number): number {
  if (colorCount <= 1) return 0;
  const span = 1 + Math.round((colorCount - 1) * Math.max(0, Math.min(100, spreadPercent)) / 100);
  if (span <= 1) return 0;
  if (numBuckets <= 0) return Math.max(0, Math.min(span - 1, bucket * (span - 1)));
  if (numBuckets <= 1) return 0;
  if (numBuckets > span) return Math.min(span - 1, Math.floor(bucket / (numBuckets / span)));
  return Math.max(0, Math.min(span - 1, Math.round(bucket * (span - 1) / (numBuckets - 1))));
}

function paletteLinearRgbAt(palette: Palette, slot: number): Point3 {
  return clampRgb(oklchToLinearSrgb(paletteColorAt(palette.colors, slot)));
}

function tileRings(tiles: Tile[], spec: FamilySpec): number[] {
  const c = tiles.map(tile => centroid(tile.verts));
  let maxX = 0;
  let maxY = 0;
  let maxR = 0;
  for (const [x, y] of c) {
    maxX = Math.max(maxX, Math.abs(x));
    maxY = Math.max(maxY, Math.abs(y));
    maxR = Math.max(maxR, Math.hypot(x, y));
  }
  return c.map(([x, y]) => {
    if (spec.ringChebyshev) {
      return Math.max(maxX > 0 ? Math.abs(x) / maxX : 0, maxY > 0 ? Math.abs(y) / maxY : 0);
    }
    return maxR > 0 ? Math.hypot(x, y) / maxR : 0;
  });
}

function averageTileRadius(tiles: Tile[]): number {
  let sum = 0;
  let count = 0;
  for (const tile of tiles) {
    const [cx, cy] = centroid(tile.verts);
    for (const [x, y] of tile.verts) {
      sum += Math.hypot(x - cx, y - cy);
      count += 1;
    }
  }
  return count > 0 ? sum / count : 1;
}

function centroid(verts: Point[]): Point {
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]!;
    const b = verts[(i + 1) % verts.length]!;
    const cross = a[0] * b[1] - b[0] * a[1];
    twiceArea += cross;
    cx += (a[0] + b[0]) * cross;
    cy += (a[1] + b[1]) * cross;
  }
  if (Math.abs(twiceArea) > SEGMENT_EPS) {
    const scale = 1 / (3 * twiceArea);
    return [cx * scale, cy * scale];
  }
  let x = 0;
  let y = 0;
  for (const v of verts) {
    x += v[0];
    y += v[1];
  }
  return [x / verts.length, y / verts.length];
}

function orientation(tile: Tile, family: number): Point {
  if (family === 18) {
    const state = ((tile.type % 8) + 8) % 8;
    if (state === 1) return [0, 1];
    if (state === 2) return [-1, 0];
    if (state === 3) return [0, -1];
    if (state === 4) return [-1, 0];
    if (state === 5) return [1, 0];
    if (state === 6) return [0, 1];
    if (state === 7) return [0, -1];
    return [1, 0];
  }
  const spec = familySpec(family);
  const a = tile.verts[Math.min(spec.angA, tile.verts.length - 1)]!;
  const b = tile.verts[Math.min(spec.angB, tile.verts.length - 1)]!;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
}
