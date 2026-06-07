import { BufferAttribute, BufferGeometry, InterleavedBuffer, InterleavedBufferAttribute } from 'three/webgpu';
import { intSetting, numberSetting, type Settings } from '../settings/androidSettings';
import {
  buildPalette,
  MAX_COLORS,
  MAX_PALETTE_PRESET,
  oklchToLinearSrgb,
  paletteColorAt,
  type Oklch,
  type Palette,
} from '../color/palette';
import type { AtlasItem, GeometryBuild, Patch, Point, Point3, Tile } from '../types';
import { buildTileRing, type TileBorder } from './borderJoin';

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
  tileType: Float32Array;
  tileRing: Float32Array;
  tileOrient: Float32Array;
  tileCenter: Float32Array;
  tileRelief: Float32Array;
};

type Snapper = (point: Point) => Point;
type EdgeKind = 'base' | 'leg' | 'edge';
type EdgeSide = {
  type: number;
  kind: EdgeKind;
};
type EdgeEntry = {
  a: Point;
  b: Point;
  sides: EdgeSide[];
};
type BorderLayoutTile = {
  edges: TileBorder['edges'];
  centroid: Point;
  outline: Point[];
  surface: SurfaceIndex | null;
  surfaceByEdge: SurfaceIndex[];
  localSurfaceHints: boolean;
  reliefApex: number;
  ring: number;
  orient: Point;
  center: Point;
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
type TileTriangulationPlan = {
  centroidFan: boolean;
  ears: [number, number, number][];
};
type TileSourceTriangle = {
  a: Point3;
  b: Point3;
  c: Point3;
  edges: number[];
};
type BorderLayoutCacheEntry = {
  key: string;
  layout: BorderLayoutTile[];
};
const BORDER_LAYOUT_CACHE_LIMIT = 4;
const borderLayoutCache = new WeakMap<Patch, BorderLayoutCacheEntry[]>();
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
];
const MAX_FAMILY_ID = FAMILY_SPECS_BY_ID.length - 1;
const FAMILY_MAX_SEED_BY_ID = new Map<number, number>([
  [0, 3], [1, 1], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 1],
  [8, 1], [9, 0], [10, 1], [11, 3], [12, 8], [13, 1], [14, 3], [15, 51], [16, 0], [17, 1],
]);
const FAMILY_MAX_GENERATION_BY_ID = new Map<number, number>([
  [2, 7], [4, 6], [9, 7], [10, 7], [11, 5], [12, 5], [13, 10], [14, 5], [15, 8], [16, 8], [17, 7],
]);
// Subdivision detail is useful on sparse patches and pathological on dense
// live-generated patches. These caps keep allocations bounded without changing
// normal atlas presets; dense patches still render, just with less per-tile
// tessellation where the extra vertices would be visually redundant.
const MAX_FILL_VERTEX_COUNT = 3_200_000;
const MAX_BORDER_VERTEX_COUNT = 2_400_000;
const MIN_BORDER_SURFACE_SUBDIVISION = 3;
const MAX_TILE_VERTEX_COUNT = 32;
const AREA_EPS = 1e-14;
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

  view(): Float32Array {
    return this.data.subarray(0, this.length);
  }
}

function patchVertexCount(tiles: readonly Tile[]): number {
  let count = 0;
  for (const tile of tiles) count += tile.verts.length;
  return count;
}

function clampQuadraticSubdivision(requested: number, edgeFanCount: number, maxVertices: number): number {
  if (edgeFanCount <= 0) return requested;
  const maxSub = Math.max(1, Math.floor(Math.sqrt(maxVertices / (edgeFanCount * 3))));
  return Math.max(1, Math.min(requested, maxSub));
}

function clampLinearSubdivision(requested: number, edgeFanCount: number, maxVertices: number, verticesPerSegment: number): number {
  if (edgeFanCount <= 0) return requested;
  const maxSub = Math.max(1, Math.floor(maxVertices / (edgeFanCount * verticesPerSegment)));
  return Math.max(1, Math.min(requested, maxSub));
}

function lerp2(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
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

export async function loadPatchForSettings(settings: Settings, item: AtlasItem | null = null): Promise<Patch> {
  const family = intSetting(settings, 'family', 0, MAX_FAMILY_ID);
  const seed = intSetting(settings, 'seed', 0, maxSeedForFamily(family));
  const generation = intSetting(settings, 'generation', 0, maxGenerationForFamilyId(family));
  const expected = { family, seed, generation };
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

export function buildMeshGeometry(patch: Patch, settings: Settings, customColors: Oklch[] | null = null): GeometryBuild {
  const colorMode = intSetting(settings, 'color_mode', 0, 3);
  const colorCount = intSetting(settings, 'color_count', 2, MAX_COLORS);
  // color_spread is a 0..100% span control over the already-defined palette
  // slots. It never changes slot colors; it only controls how far bucket mapping
  // reaches across the available Slots range.
  const colorSpread = intSetting(settings, 'color_spread', 0, 100);
  const preset = intSetting(settings, 'preset', 0, MAX_PALETTE_PRESET);
  const colorSpectral = intSetting(settings, 'color_spectral', 0, 100) / 100;
  const palette = buildPalette(preset, colorCount, customColors, colorSpectral);
  const classes = classify(patch.tiles, patch.family, colorMode, colorCount);
  const relief = averageTileRadius(patch.tiles) * 0.34;
  const spec = familySpec(patch.family);
  const maxType = Math.max(1, typeBucketCount(patch.tiles, patch.family, spec) - 1);
  const rings = tileRings(patch.tiles, spec);
  const projector = createProjector(settings);
  const snap = createVertexSnapper(projector.enabled ? 1e-5 : 1e-7);
  // Subdivision applies in BOTH projections. It was originally gated to Poincaré
  // (only the curved projection needed it), but the per-vertex surface displacement
  // (undulate/relief/field) needs the extra vertices to bend smoothly in Euclidean
  // too — gating it there left flat-mode undulation coarse no matter the setting.
  const tileVertexCount = patchVertexCount(patch.tiles);
  const fillSub = clampQuadraticSubdivision(
    intSetting(settings, 'hyp_fill_subdiv', 1, 8),
    tileVertexCount,
    MAX_FILL_VERTEX_COUNT,
  );

  let triCount = 0;
  for (const tile of patch.tiles) triCount += sourceTriangleCount(tile, centroid(tile.verts)) * fillSub * fillSub;
  const vertexCount = triCount * 3;
  const position = new Float32Array(vertexCount * 3);
  const color = new Float32Array(vertexCount * 3);
  const paletteSlot = new Float32Array(vertexCount);
  const tileType = new Float32Array(vertexCount);
  const tileRing = new Float32Array(vertexCount);
  const tileOrient = new Float32Array(vertexCount * 2);
  const tileCenter = new Float32Array(vertexCount * 2);
  const tileRelief = new Float32Array(vertexCount);

  let cursor = 0;
  for (let tileIndex = 0; tileIndex < patch.tiles.length; tileIndex++) {
    const tile = patch.tiles[tileIndex]!;
    const center = centroid(tile.verts);
    const projectedCenter = snap(projector.map(center[0], center[1]));
    const orient = orientation(tile, patch.family);
    const typeValue = tile.type / maxType;
    const ringValue = rings[tileIndex] ?? 0;
    const paletteIndex = bucketToPaletteIdx(classes.bucket[tileIndex] ?? 0, classes.numBuckets, colorCount, colorSpread);
    const rgb = paletteLinearRgbAt(palette, paletteIndex);
    const centerZ = relief * (0.65 + ringValue * 0.35 + typeValue * 0.18);
    // Normalize this tile's fan winding to CCW. Tiles come in both orientations,
    // so without this the mesh has mixed winding and faceDirection can't tell front
    // from back. DoubleSide means reversing the order is visually a no-op.
    const flip = signedArea(tile.verts) < 0;
    for (const tri of tileSourceTriangles(tile, center, centerZ)) {
      cursor = emitTriangle(
        cursor,
        { position, color, paletteSlot, tileType, tileRing, tileOrient, tileCenter, tileRelief },
        projector,
        snap,
        fillSub,
        tri.a,
        tri.b,
        tri.c,
        rgb,
        typeValue,
        ringValue,
        orient,
        projectedCenter,
        paletteIndex,
        flip,
      );
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('color', new BufferAttribute(color, 3));
  geometry.setAttribute('paletteSlot', new BufferAttribute(paletteSlot, 1));
  setFillCustomAttributes(geometry, tileType, tileRing, tileOrient, tileCenter, tileRelief);
  // The WebGPU material supplies its own normalNode. Do not emit geometry normals:
  // they would only feed Three's geometry-roughness path and consume another
  // WebGPU vertex-buffer slot.
  geometry.computeBoundingSphere();
  const edgeGeometry = buildEdgeGeometryForPatch(patch, settings);
  return { geometry, edgeGeometry, palette };
}

export function buildPaletteSlotsForPatch(
  patch: Patch,
  settings: Settings,
  customColors: Oklch[] | null = null,
): { paletteSlot: Float32Array; palette: Palette } {
  const colorMode = intSetting(settings, 'color_mode', 0, 3);
  const colorCount = intSetting(settings, 'color_count', 2, MAX_COLORS);
  const colorSpread = intSetting(settings, 'color_spread', 0, 100);
  const preset = intSetting(settings, 'preset', 0, MAX_PALETTE_PRESET);
  const colorSpectral = intSetting(settings, 'color_spectral', 0, 100) / 100;
  const palette = buildPalette(preset, colorCount, customColors, colorSpectral);
  const classes = classify(patch.tiles, patch.family, colorMode, colorCount);
  const tileVertexCount = patchVertexCount(patch.tiles);
  const fillSub = clampQuadraticSubdivision(
    intSetting(settings, 'hyp_fill_subdiv', 1, 8),
    tileVertexCount,
    MAX_FILL_VERTEX_COUNT,
  );
  let vertexCount = 0;
  for (const tile of patch.tiles) vertexCount += sourceTriangleCount(tile, centroid(tile.verts)) * fillSub * fillSub * 3;
  const paletteSlot = new Float32Array(vertexCount);
  let cursor = 0;
  for (let tileIndex = 0; tileIndex < patch.tiles.length; tileIndex++) {
    const tile = patch.tiles[tileIndex]!;
    const count = sourceTriangleCount(tile, centroid(tile.verts)) * fillSub * fillSub * 3;
    const paletteIndex = bucketToPaletteIdx(classes.bucket[tileIndex] ?? 0, classes.numBuckets, colorCount, colorSpread);
    paletteSlot.fill(paletteIndex, cursor, cursor + count);
    cursor += count;
  }
  return { paletteSlot, palette };
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
): void {
  const count = tileType.length;
  const stride = 7;
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
  }
  const data = new InterleavedBuffer(packed, stride);
  geometry.setAttribute('tileType', new InterleavedBufferAttribute(data, 1, 0));
  geometry.setAttribute('tileRing', new InterleavedBufferAttribute(data, 1, 1));
  geometry.setAttribute('tileOrient', new InterleavedBufferAttribute(data, 2, 2));
  geometry.setAttribute('tileCenter', new InterleavedBufferAttribute(data, 2, 4));
  geometry.setAttribute('tileRelief', new InterleavedBufferAttribute(data, 1, 6));
}

function setEdgeCustomAttributes(
  geometry: BufferGeometry,
  tileRing: Float32Array,
  tileOrient: Float32Array,
  tileCenter: Float32Array,
  tileRelief: Float32Array,
  edgeSide: Float32Array,
  edgeSlope: Float32Array,
): void {
  const count = tileRing.length;
  const stride = 9;
  const packed = new Float32Array(count * stride);
  for (let i = 0; i < count; i++) {
    const base = i * stride;
    const pair = i * 2;
    packed[base] = tileRing[i] ?? 0;
    packed[base + 1] = tileOrient[pair] ?? 1;
    packed[base + 2] = tileOrient[pair + 1] ?? 0;
    packed[base + 3] = tileCenter[pair] ?? 0;
    packed[base + 4] = tileCenter[pair + 1] ?? 0;
    packed[base + 5] = tileRelief[i] ?? 0;
    packed[base + 6] = edgeSide[i] ?? 1;
    packed[base + 7] = edgeSlope[pair] ?? 0;
    packed[base + 8] = edgeSlope[pair + 1] ?? 0;
  }
  const data = new InterleavedBuffer(packed, stride);
  geometry.setAttribute('tileRing', new InterleavedBufferAttribute(data, 1, 0));
  geometry.setAttribute('tileOrient', new InterleavedBufferAttribute(data, 2, 1));
  geometry.setAttribute('tileCenter', new InterleavedBufferAttribute(data, 2, 3));
  geometry.setAttribute('tileRelief', new InterleavedBufferAttribute(data, 1, 5));
  geometry.setAttribute('edgeSide', new InterleavedBufferAttribute(data, 1, 6));
  geometry.setAttribute('edgeSlope', new InterleavedBufferAttribute(data, 2, 7));
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

function sourceTriangleCount(tile: Tile, center: Point): number {
  const plan = tileTriangulationPlan(tile, center);
  if (plan.centroidFan) return tile.verts.length;
  let count = 0;
  for (const [ia, ib, ic] of plan.ears) {
    count += boundaryEdgeIndex(ia, ib, tile.verts.length) >= 0 ? 1 : 2;
    count += boundaryEdgeIndex(ib, ic, tile.verts.length) >= 0 ? 1 : 2;
    count += boundaryEdgeIndex(ic, ia, tile.verts.length) >= 0 ? 1 : 2;
  }
  return count;
}

function tileSourceTriangles(tile: Tile, center: Point, reliefApex: number): TileSourceTriangle[] {
  const verts = tile.verts;
  const plan = tileTriangulationPlan(tile, center);
  if (plan.centroidFan) {
    return verts.map((_, edgeIndex) => {
      const edgeStart = verts[edgeIndex]!;
      const edgeEnd = verts[(edgeIndex + 1) % verts.length]!;
      return {
        a: [center[0], center[1], reliefApex],
        b: [edgeStart[0], edgeStart[1], 0],
        c: [edgeEnd[0], edgeEnd[1], 0],
        edges: [edgeIndex],
      };
    });
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
    const localRelief = tileReliefAt(localCenter, center, verts, reliefApex);
    const hub: Point3 = [localCenter[0], localCenter[1], localRelief];
    const add = (first: number, second: number): void => {
      const edge = boundaryEdgeIndex(first, second, verts.length);
      const a: Point3 = [verts[first]![0], verts[first]![1], 0];
      const b: Point3 = [verts[second]![0], verts[second]![1], 0];
      if (edge >= 0) {
        triangles.push({ a: hub, b: a, c: b, edges: [edge] });
        return;
      }
      const mid: Point = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
      const mid3: Point3 = [mid[0], mid[1], tileReliefAt(mid, center, verts, reliefApex)];
      triangles.push({ a: hub, b: a, c: mid3, edges: [] });
      triangles.push({ a: hub, b: mid3, c: b, edges: [] });
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
  const plan: TileTriangulationPlan = fanTriangulationContained(tile.verts, center)
    ? { centroidFan: true, ears: [] }
    : { centroidFan: false, ears: triangulatePolygonIndices(tile.verts) };
  tileTriangulationCache.set(tile, plan);
  return plan;
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

function distanceToPolygonBoundary(p: Point, verts: Point[]): number {
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
  typeValue: number,
  ringValue: number,
  orient: Point,
  center: Point,
  paletteIndex: number,
  // When true, every emitted triangle's winding is reversed (2nd/3rd vertex
  // swapped) WITHOUT changing any per-vertex data (position, edge distance). This
  // normalizes CW tiles to CCW so the whole mesh has consistent winding — required
  // for faceDirection to reliably tell front from back (the DoubleSide normal flip).
  flip: boolean,
): number {
  const emitTri = (
    p0: Point3,
    p1: Point3,
    p2: Point3,
  ): void => {
    if (flip) {
      cursor = emitProjectedVertex(cursor, buffers, projector, snap, p0, rgb, typeValue, ringValue, orient, center, paletteIndex);
      cursor = emitProjectedVertex(cursor, buffers, projector, snap, p2, rgb, typeValue, ringValue, orient, center, paletteIndex);
      cursor = emitProjectedVertex(cursor, buffers, projector, snap, p1, rgb, typeValue, ringValue, orient, center, paletteIndex);
    } else {
      cursor = emitProjectedVertex(cursor, buffers, projector, snap, p0, rgb, typeValue, ringValue, orient, center, paletteIndex);
      cursor = emitProjectedVertex(cursor, buffers, projector, snap, p1, rgb, typeValue, ringValue, orient, center, paletteIndex);
      cursor = emitProjectedVertex(cursor, buffers, projector, snap, p2, rgb, typeValue, ringValue, orient, center, paletteIndex);
    }
  };
  if (fillSub <= 1) {
    emitTri(a, b, c);
    return cursor;
  }
  const invN = 1 / fillSub;
  const point = (i: number, j: number): Point3 => {
    const k = fillSub - i - j;
    const fa = i * invN;
    const fb = j * invN;
    const fc = k * invN;
    return [
      fa * a[0] + fb * b[0] + fc * c[0],
      fa * a[1] + fb * b[1] + fc * c[1],
      fa * a[2] + fb * b[2] + fc * c[2],
    ];
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
  typeValue: number,
  ringValue: number,
  orient: Point,
  center: Point,
  paletteIndex: number,
): number {
  const [x, y] = snap(projector.map(vertex[0], vertex[1]));
  return emitVertex(
    cursor,
    buffers.position,
    buffers.color,
    buffers.paletteSlot,
    buffers.tileType,
    buffers.tileRing,
    buffers.tileOrient,
    buffers.tileCenter,
    buffers.tileRelief,
    x,
    y,
    vertex[2],
    rgb,
    typeValue,
    ringValue,
    orient,
    center,
    paletteIndex,
  );
}

function emitVertex(
  cursor: number,
  position: Float32Array,
  color: Float32Array,
  paletteSlot: Float32Array,
  tileType: Float32Array,
  tileRing: Float32Array,
  tileOrient: Float32Array,
  tileCenter: Float32Array,
  tileRelief: Float32Array,
  x: number,
  y: number,
  z: number,
  rgb: Point3,
  typeValue: number,
  ringValue: number,
  orient: Point,
  center: Point,
  paletteIndex: number,
): number {
  const p = cursor * 3;
  position[p] = x;
  position[p + 1] = y;
  position[p + 2] = 0;
  color[p] = rgb[0];
  color[p + 1] = rgb[1];
  color[p + 2] = rgb[2];
  paletteSlot[cursor] = paletteIndex;
  tileType[cursor] = typeValue;
  tileRing[cursor] = ringValue;
  tileRelief[cursor] = z;
  const o = cursor * 2;
  tileOrient[o] = orient[0];
  tileOrient[o + 1] = orient[1];
  tileCenter[o] = center[0];
  tileCenter[o + 1] = center[1];
  return cursor + 1;
}

export function buildEdgeGeometryForPatch(patch: Patch, settings: Settings): BufferGeometry | null {
  const borderOn = String(settings.border_on) !== 'false';
  const radius = averageTileRadius(patch.tiles);
  const relief = radius * 0.34;
  const width = radius * intSetting(settings, 'border_width', 0, 600) / 600 * 0.16;
  if (!borderOn || width <= 1e-7) return null;

  const tileVertexCount = patchVertexCount(patch.tiles);
  const requestedFillSub = intSetting(settings, 'hyp_fill_subdiv', 1, 8);
  const fillSub = clampQuadraticSubdivision(
    requestedFillSub,
    tileVertexCount,
    MAX_FILL_VERTEX_COUNT,
  );
  const borderSurfaceFillSub = clampQuadraticSubdivision(
    Math.max(requestedFillSub, MIN_BORDER_SURFACE_SUBDIVISION),
    tileVertexCount,
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
  const tileRing = new Float32Builder();
  const tileOrient = new Float32Builder();
  const tileCenter = new Float32Builder();
  const tileRelief = new Float32Builder();
  const edgeSide = new Float32Builder();
  const edgeSlope = new Float32Builder();
  const pushSampledVertex = (p: Point, ring: number, orient: Point, center: Point, sample: SurfaceSample, side: number): void => {
    positions.push3(p[0], p[1], 0);
    tileRing.push1(ring);
    tileOrient.push2(orient[0], orient[1]);
    tileCenter.push2(center[0], center[1]);
    tileRelief.push1(sample.relief);
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
      pushSampledVertex(a, border.ring, border.orient, border.center, sampleA, 1);
      pushSampledVertex(b, border.ring, border.orient, border.center, sampleB, 1);
      pushSampledVertex(c, border.ring, border.orient, border.center, sampleC, 1);
      pushSampledVertex(a, border.ring, border.orient, border.center, sampleA, -1);
      pushSampledVertex(c, border.ring, border.orient, border.center, sampleC, -1);
      pushSampledVertex(b, border.ring, border.orient, border.center, sampleB, -1);
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
    patch,
    borderLayoutCacheKey(settings, fillSub, borderSurfaceFillSub, sub, relief),
    () => borderLayout(patch, projector, snap, sub, borderSurfaceFillSub, relief),
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
    tileRing.view(),
    tileOrient.view(),
    tileCenter.view(),
    tileRelief.view(),
    edgeSide.view(),
    edgeSlope.view(),
  );
  geometry.computeBoundingSphere();
  return geometry;
}

function borderLayoutCacheKey(settings: Settings, fillSub: number, surfaceFillSub: number, borderSub: number, relief: number): string {
  return [
    intSetting(settings, 'projection', 0, 1),
    numberSetting(settings, 'hyp_scale', 0, 100),
    fillSub,
    surfaceFillSub,
    borderSub,
    relief,
  ].join(':');
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
): BorderLayoutTile[] {
  const visibleKeys = collectVisibleEdgeKeys(patch);
  const spec = familySpec(patch.family);
  const maxType = Math.max(1, typeBucketCount(patch.tiles, patch.family, spec) - 1);
  const rings = tileRings(patch.tiles, spec);
  const layout: BorderLayoutTile[] = [];
  for (let tileIndex = 0; tileIndex < patch.tiles.length; tileIndex++) {
    const tile = patch.tiles[tileIndex]!;
    const cen = centroid(tile.verts);
    const projCentroid = snap(projector.map(cen[0], cen[1]));
    const outline = tile.verts.map(([x, y]) => snap(projector.map(x, y)));
    const tileEdges: TileBorder['edges'] = [];
    for (let i = 0; i < tile.verts.length; i++) {
      const a = tile.verts[i]!;
      const b = tile.verts[(i + 1) % tile.verts.length]!;
      const pts: Point[] = [];
      for (let k = 0; k <= sub; k++) {
        const p = lerp2(a, b, k / sub);
        pts.push(snap(projector.map(p[0], p[1])));
      }
      tileEdges.push({ pts, visible: visibleKeys.has(edgeKey(a, b)) });
    }
    const ring = rings[tileIndex] ?? 0;
    const typeValue = tile.type / maxType;
    const reliefApex = relief * (0.65 + ring * 0.35 + typeValue * 0.18);
    const surfaces = projectedFillSurfaceByEdge(tile, cen, projector, snap, fillSub, reliefApex);
    const localSurfaceHints = projectedTileIsConvex(tileEdges, projCentroid);
    const surfaceIndexByEdge = surfaces.byEdge.map(buildSurfaceIndex);
    layout.push({
      edges: tileEdges,
      centroid: projCentroid,
      outline,
      surface: buildSurfaceIndex(surfaces.all),
      surfaceByEdge: surfaceIndexByEdge,
      localSurfaceHints,
      reliefApex,
      ring,
      orient: orientation(tile, patch.family),
      center: projCentroid,
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
): { byEdge: SurfaceTri[][]; all: SurfaceTri[] } {
  const byEdge: SurfaceTri[][] = Array.from({ length: tile.verts.length }, () => []);
  const all: SurfaceTri[] = [];
  const project = (p: Point3): SurfaceVertex => {
    const [x, y] = snap(projector.map(p[0], p[1]));
    return { p: [x, y], relief: p[2] };
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
    const va = project(a);
    const vb = project(b);
    const vc = project(c);
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
  for (const source of tileSourceTriangles(tile, center, reliefApex)) {
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

function collectVisibleEdgeKeys(patch: Patch): Set<string> {
  const map = new Map<string, EdgeEntry>();
  for (let tileIndex = 0; tileIndex < patch.tiles.length; tileIndex++) {
    const tile = patch.tiles[tileIndex]!;
    for (let i = 0; i < tile.verts.length; i++) {
      const j = (i + 1) % tile.verts.length;
      const a = tile.verts[i]!;
      const b = tile.verts[j]!;
      const key = edgeKey(a, b);
      const entry = map.get(key);
      const kind = edgeKind(patch.family, tile, i);
      const side = { type: tile.type, kind };
      if (entry) {
        entry.sides.push(side);
      } else {
        map.set(key, { a, b, sides: [side] });
      }
    }
  }
  const keys = new Set<string>();
  for (const edge of map.values()) {
    if (
      edge.sides.length === 2
      && edge.sides[0]!.type === edge.sides[1]!.type
      && hiddenEdge(patch.family, edge.sides[0]!.kind, edge.sides[1]!.kind)
    ) {
      continue;
    }
    keys.add(edgeKey(edge.a, edge.b));
  }
  return keys;
}

function edgeKind(family: number, tile: Tile, edgeIndex: number): EdgeKind {
  if ((family !== 0 && family !== 1) || tile.verts.length !== 3) return 'edge';
  return edgeIndex === 2 ? 'base' : 'leg';
}

function hiddenEdge(family: number, first: EdgeKind, second: EdgeKind): boolean {
  if (family === 0) return first === 'base' && second === 'base';
  if (family === 1) return first === 'leg' && second === 'leg';
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
  const spec = familySpec(family);
  const a = tile.verts[Math.min(spec.angA, tile.verts.length - 1)]!;
  const b = tile.verts[Math.min(spec.angB, tile.verts.length - 1)]!;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
}
