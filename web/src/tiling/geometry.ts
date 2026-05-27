import { BufferAttribute, BufferGeometry } from 'three/webgpu';
import { intSetting, numberSetting, type Settings } from '../settings/androidSettings';
import { buildPalette, oklchToLinearSrgb, type Oklch } from '../color/palette';
import type { AtlasItem, GeometryBuild, Patch, Point, Point3, Tile } from '../types';

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
  bucket: Uint8Array;
  numBuckets: number;
};

type Projector = {
  enabled: boolean;
  map: (x: number, y: number) => Point;
};

type MeshBuffers = {
  position: Float32Array;
  color: Float32Array;
  tileType: Float32Array;
  tileRing: Float32Array;
  tileOrient: Float32Array;
};

type VisibleEdge = {
  a: Point;
  b: Point;
};

type Snapper = (point: Point) => Point;
type EdgeKind = 'base' | 'leg' | 'edge';
type EdgeSide = {
  type: number;
  kind: EdgeKind;
};
type EdgeEntry = VisibleEdge & {
  first: EdgeSide;
  second: EdgeSide | null;
};

const FAMILY: FamilySpec[] = [
  { typeBuckets: 2, orientBuckets: 10, orientFromType: false, angA: 0, angB: 2, orientHalfTurn: false, ringChebyshev: false },
  { typeBuckets: 2, orientBuckets: 10, orientFromType: false, angA: 0, angB: 2, orientHalfTurn: false, ringChebyshev: false },
  { typeBuckets: 4, orientBuckets: 4, orientFromType: true, angA: 0, angB: 0, orientHalfTurn: false, ringChebyshev: true },
  { typeBuckets: 3, orientBuckets: 6, orientFromType: false, angA: 0, angB: 1, orientHalfTurn: true, ringChebyshev: false },
  { typeBuckets: 2, orientBuckets: 10, orientFromType: false, angA: 0, angB: 2, orientHalfTurn: false, ringChebyshev: false },
  { typeBuckets: 2, orientBuckets: 4, orientFromType: false, angA: 0, angB: 1, orientHalfTurn: true, ringChebyshev: false },
  { typeBuckets: 3, orientBuckets: 7, orientFromType: false, angA: 0, angB: 1, orientHalfTurn: true, ringChebyshev: false },
  { typeBuckets: 2, orientBuckets: 5, orientFromType: false, angA: 0, angB: 1, orientHalfTurn: true, ringChebyshev: false },
  { typeBuckets: 2, orientBuckets: 10, orientFromType: false, angA: 0, angB: 2, orientHalfTurn: false, ringChebyshev: false },
  { typeBuckets: 4, orientBuckets: 10, orientFromType: false, angA: 0, angB: 1, orientHalfTurn: false, ringChebyshev: false },
  { typeBuckets: 4, orientBuckets: 14, orientFromType: false, angA: 0, angB: 2, orientHalfTurn: false, ringChebyshev: false },
  { typeBuckets: 5, orientBuckets: 12, orientFromType: false, angA: 0, angB: 1, orientHalfTurn: false, ringChebyshev: false },
  { typeBuckets: 10, orientBuckets: 12, orientFromType: false, angA: 0, angB: 1, orientHalfTurn: false, ringChebyshev: false },
];

export async function loadPatch(item: AtlasItem): Promise<Patch> {
  if (!item.geometry) throw new Error(`atlas target has no geometry: ${item.id}`);
  const response = await fetch(`/generated/atlas/${item.geometry}`, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`geometry HTTP ${response.status}: ${item.geometry}`);
  return parsePatch(await response.arrayBuffer());
}

export async function loadPatchForSettings(settings: Settings, item: AtlasItem | null = null): Promise<Patch> {
  const family = intSetting(settings, 'family', 0, 12);
  const seed = intSetting(settings, 'seed', 0, 8);
  const generation = intSetting(settings, 'generation', 0, 8);
  const expected = { family, seed, generation };
  if (
    item?.geometry
    && intSetting(item.settings ?? {}, 'family', -1, 12) === family
    && intSetting(item.settings ?? {}, 'seed', -1, 8) === seed
    && intSetting(item.settings ?? {}, 'generation', -1, 8) === generation
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
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'PTG1') throw new Error('bad tiling geometry magic');
  let offset = 4;
  const family = view.getUint32(offset, true); offset += 4;
  const seed = view.getUint32(offset, true); offset += 4;
  const generation = view.getUint32(offset, true); offset += 4;
  const tileCount = view.getUint32(offset, true); offset += 4;
  const tiles: Tile[] = new Array<Tile>(tileCount);
  for (let i = 0; i < tileCount; i++) {
    const vcount = view.getUint8(offset++);
    const type = view.getUint8(offset++);
    const verts: Point[] = new Array<Point>(vcount);
    for (let j = 0; j < vcount; j++) {
      verts[j] = [view.getFloat32(offset, true), view.getFloat32(offset + 4, true)];
      offset += 8;
    }
    tiles[i] = { type, verts };
  }
  return { family, seed, generation, tiles };
}

export function buildMeshGeometry(patch: Patch, settings: Settings, customColors: Oklch[] | null = null): GeometryBuild {
  const colorMode = intSetting(settings, 'color_mode', 0, 2);
  const colorCount = intSetting(settings, 'color_count', 2, 16);
  const preset = intSetting(settings, 'preset', 0, 11);
  const palette = buildPalette(preset, colorCount, customColors);
  const classes = classify(patch.tiles, patch.family, colorMode, colorCount);
  const relief = averageTileRadius(patch.tiles) * intSetting(settings, 'mat_relief', 0, 200) / 200 * 0.34;
  const maxType = Math.max(1, familySpec(patch.family).typeBuckets - 1);
  const rings = tileRings(patch.tiles, familySpec(patch.family));
  const projector = createProjector(settings);
  const snap = createVertexSnapper(projector.enabled ? 1e-5 : 1e-7);
  const fillSub = projector.enabled ? intSetting(settings, 'hyp_fill_subdiv', 1, 8) : 1;

  let triCount = 0;
  for (const tile of patch.tiles) triCount += tile.verts.length * fillSub * fillSub;
  const vertexCount = triCount * 3;
  const position = new Float32Array(vertexCount * 3);
  const color = new Float32Array(vertexCount * 3);
  const tileType = new Float32Array(vertexCount);
  const tileRing = new Float32Array(vertexCount);
  const tileOrient = new Float32Array(vertexCount * 2);

  let cursor = 0;
  for (let tileIndex = 0; tileIndex < patch.tiles.length; tileIndex++) {
    const tile = patch.tiles[tileIndex]!;
    const center = centroid(tile.verts);
    const orient = orientation(tile, patch.family);
    const typeValue = tile.type / maxType;
    const ringValue = rings[tileIndex] ?? 0;
    const paletteIndex = bucketToPaletteIdx(classes.bucket[tileIndex] ?? 0, classes.numBuckets, colorCount);
    const rgb = clampRgb(oklchToLinearSrgb(palette.colors[paletteIndex] ?? palette.colors[0]!));
    const centerZ = relief * (0.65 + ringValue * 0.35 + typeValue * 0.18);
    for (let i = 0; i < tile.verts.length; i++) {
      const a = tile.verts[i]!;
      const b = tile.verts[(i + 1) % tile.verts.length]!;
      cursor = emitTriangle(
        cursor,
        { position, color, tileType, tileRing, tileOrient },
        projector,
        snap,
        fillSub,
        [center[0], center[1], centerZ],
        [a[0], a[1], 0],
        [b[0], b[1], 0],
        rgb,
        typeValue,
        ringValue,
        orient,
      );
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('color', new BufferAttribute(color, 3));
  geometry.setAttribute('uv', new BufferAttribute(buildUv(position), 2));
  geometry.setAttribute('tileType', new BufferAttribute(tileType, 1));
  geometry.setAttribute('tileRing', new BufferAttribute(tileRing, 1));
  geometry.setAttribute('tileOrient', new BufferAttribute(tileOrient, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const edgeGeometry = buildEdgeGeometry(patch, settings, projector, snap, relief);
  return { geometry, edgeGeometry, palette };
}

function familySpec(family: number): FamilySpec {
  return FAMILY[family] ?? FAMILY[0]!;
}

function clampRgb(rgb: Point3): Point3 {
  return [
    Math.max(0, Math.min(1, rgb[0])),
    Math.max(0, Math.min(1, rgb[1])),
    Math.max(0, Math.min(1, rgb[2])),
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
  typeValue: number,
  ringValue: number,
  orient: Point,
): number {
  if (fillSub <= 1) {
    cursor = emitProjectedVertex(cursor, buffers, projector, snap, a, rgb, typeValue, ringValue, orient);
    cursor = emitProjectedVertex(cursor, buffers, projector, snap, b, rgb, typeValue, ringValue, orient);
    cursor = emitProjectedVertex(cursor, buffers, projector, snap, c, rgb, typeValue, ringValue, orient);
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
      cursor = emitProjectedVertex(cursor, buffers, projector, snap, point(i, j), rgb, typeValue, ringValue, orient);
      cursor = emitProjectedVertex(cursor, buffers, projector, snap, point(i + 1, j), rgb, typeValue, ringValue, orient);
      cursor = emitProjectedVertex(cursor, buffers, projector, snap, point(i, j + 1), rgb, typeValue, ringValue, orient);
      if (j < fillSub - i - 1) {
        cursor = emitProjectedVertex(cursor, buffers, projector, snap, point(i + 1, j), rgb, typeValue, ringValue, orient);
        cursor = emitProjectedVertex(cursor, buffers, projector, snap, point(i + 1, j + 1), rgb, typeValue, ringValue, orient);
        cursor = emitProjectedVertex(cursor, buffers, projector, snap, point(i, j + 1), rgb, typeValue, ringValue, orient);
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
): number {
  const [x, y] = snap(projector.map(vertex[0], vertex[1]));
  return emitVertex(
    cursor,
    buffers.position,
    buffers.color,
    buffers.tileType,
    buffers.tileRing,
    buffers.tileOrient,
    x,
    y,
    vertex[2],
    rgb,
    typeValue,
    ringValue,
    orient,
  );
}

function emitVertex(
  cursor: number,
  position: Float32Array,
  color: Float32Array,
  tileType: Float32Array,
  tileRing: Float32Array,
  tileOrient: Float32Array,
  x: number,
  y: number,
  z: number,
  rgb: Point3,
  typeValue: number,
  ringValue: number,
  orient: Point,
): number {
  const p = cursor * 3;
  position[p] = x;
  position[p + 1] = y;
  position[p + 2] = z;
  color[p] = rgb[0];
  color[p + 1] = rgb[1];
  color[p + 2] = rgb[2];
  tileType[cursor] = typeValue;
  tileRing[cursor] = ringValue;
  const o = cursor * 2;
  tileOrient[o] = orient[0];
  tileOrient[o + 1] = orient[1];
  return cursor + 1;
}

function buildEdgeGeometry(
  patch: Patch,
  settings: Settings,
  projector: Projector,
  snap: Snapper,
  relief: number,
): BufferGeometry | null {
  const borderOn = String(settings.border_on) !== 'false';
  const borderAlpha = intSetting(settings, 'border_a', 0, 100) / 100;
  const radius = averageTileRadius(patch.tiles);
  const width = radius * intSetting(settings, 'border_width', 0, 600) / 600 * 0.16;
  if (!borderOn || borderAlpha <= 0 || width <= 1e-7) return null;

  const edges = collectVisibleEdges(patch);
  const sub = projector.enabled ? intSetting(settings, 'hyp_border_subdiv', 1, 32) : 1;
  const halfWidth = width * 0.5;
  const edgeZ = relief * 0.08 + radius * 0.002;
  const positions: number[] = [];

  for (const edge of edges) {
    for (let i = 0; i < sub; i++) {
      const a = i / sub;
      const b = (i + 1) / sub;
      const p1 = lerp2(edge.a, edge.b, a);
      const p2 = lerp2(edge.a, edge.b, b);
      const [x1, y1] = snap(projector.map(p1[0], p1[1]));
      const [x2, y2] = snap(projector.map(p2[0], p2[1]));
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (len <= 1e-8) continue;
      const tx = dx / len;
      const ty = dy / len;
      const nx = -ty * halfWidth;
      const ny = tx * halfWidth;
      const ex = tx * halfWidth;
      const ey = ty * halfWidth;
      const ax = x1 - ex;
      const ay = y1 - ey;
      const bx = x2 + ex;
      const by = y2 + ey;
      pushQuad(positions, [ax + nx, ay + ny, edgeZ], [ax - nx, ay - ny, edgeZ], [bx + nx, by + ny, edgeZ], [bx - nx, by - ny, edgeZ]);
    }
  }

  if (positions.length === 0) return null;
  const geometry = new BufferGeometry();
  const position = new Float32Array(positions);
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('uv', new BufferAttribute(buildUv(position), 2));
  geometry.computeBoundingSphere();
  return geometry;
}

function buildUv(position: Float32Array): Float32Array {
  const count = position.length / 3;
  const uv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    uv[i * 2] = position[i * 3] ?? 0;
    uv[i * 2 + 1] = position[i * 3 + 1] ?? 0;
  }
  return uv;
}

function collectVisibleEdges(patch: Patch): VisibleEdge[] {
  const map = new Map<string, EdgeEntry>();
  for (const tile of patch.tiles) {
    for (let i = 0; i < tile.verts.length; i++) {
      const j = (i + 1) % tile.verts.length;
      const a = tile.verts[i]!;
      const b = tile.verts[j]!;
      const key = edgeKey(a, b);
      const entry = map.get(key);
      const kind = edgeKind(patch.family, tile, i);
      if (entry) {
        entry.second = { type: tile.type, kind };
      } else {
        map.set(key, { a, b, first: { type: tile.type, kind }, second: null });
      }
    }
  }
  const edges: VisibleEdge[] = [];
  for (const edge of map.values()) {
    if (edge.second && edge.first.type === edge.second.type && hiddenEdge(patch.family, edge.first.kind, edge.second.kind)) {
      continue;
    }
    edges.push(edge);
  }
  return edges;
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
  return `${Math.round(x * 1e5)},${Math.round(y * 1e5)}`;
}

function lerp2(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function pushQuad(out: number[], a: Point3, b: Point3, c: Point3, d: Point3): void {
  out.push(...a, ...b, ...c, ...b, ...d, ...c);
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
  let bx = (numberSetting(settings, 'hyp_boost_x', 0, 100) - 50) / 50 * 0.9;
  let by = (numberSetting(settings, 'hyp_boost_y', 0, 100) - 50) / 50 * 0.9;
  const bMag = Math.hypot(bx, by);
  if (bMag > 0.92) {
    const s = 0.92 / bMag;
    bx *= s;
    by *= s;
  }
  return {
    enabled: true,
    map: (x: number, y: number) => projectHyp(x, y, bx, by, scale),
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
  const bucket = new Uint8Array(tiles.length);
  if (mode === 0) {
    const n = Math.max(1, spec.typeBuckets);
    for (let i = 0; i < tiles.length; i++) bucket[i] = tiles[i]!.type % n;
    return { bucket, numBuckets: n };
  }
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

function bucketToPaletteIdx(bucket: number, numBuckets: number, colorCount: number): number {
  if (colorCount <= 1) return 0;
  if (numBuckets > colorCount) return Math.min(colorCount - 1, Math.floor(bucket / (numBuckets / colorCount)));
  return bucket % colorCount;
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
