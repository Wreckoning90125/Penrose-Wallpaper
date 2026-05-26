import * as THREE from 'three/webgpu';
import { intSetting } from '../settings/androidSettings.js';
import { buildPalette, oklchToLinearSrgb } from '../color/palette.js';

const FAMILY = [
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

export async function loadPatch(item) {
  const response = await fetch(`/generated/atlas/${item.geometry}`, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`geometry HTTP ${response.status}: ${item.geometry}`);
  return parsePatch(await response.arrayBuffer());
}

function parsePatch(buffer) {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'PTG1') throw new Error('bad tiling geometry magic');
  let offset = 4;
  const family = view.getUint32(offset, true); offset += 4;
  const seed = view.getUint32(offset, true); offset += 4;
  const generation = view.getUint32(offset, true); offset += 4;
  const tileCount = view.getUint32(offset, true); offset += 4;
  const tiles = new Array(tileCount);
  for (let i = 0; i < tileCount; i++) {
    const vcount = view.getUint8(offset++);
    const type = view.getUint8(offset++);
    const verts = new Array(vcount);
    for (let j = 0; j < vcount; j++) {
      verts[j] = [view.getFloat32(offset, true), view.getFloat32(offset + 4, true)];
      offset += 8;
    }
    tiles[i] = { type, verts };
  }
  return { family, seed, generation, tiles };
}

export function buildMeshGeometry(patch, settings, customColors = null) {
  const colorMode = intSetting(settings, 'color_mode', 0, 2);
  const colorCount = intSetting(settings, 'color_count', 2, 16);
  const preset = intSetting(settings, 'preset', 0, 11);
  const palette = buildPalette(preset, colorCount, customColors);
  const classes = classify(patch.tiles, patch.family, colorMode, colorCount);
  const relief = intSetting(settings, 'mat_relief', 0, 160) / 100 * 0.075;
  const maxType = Math.max(1, FAMILY[patch.family]?.typeBuckets - 1 || 1);
  const rings = tileRings(patch.tiles, FAMILY[patch.family]);
  const projector = createProjector(settings);
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
    const tile = patch.tiles[tileIndex];
    const center = centroid(tile.verts);
    const orient = orientation(tile, patch.family);
    const typeValue = tile.type / maxType;
    const ringValue = rings[tileIndex];
    const paletteIndex = bucketToPaletteIdx(classes.bucket[tileIndex], classes.numBuckets, colorCount);
    const rgb = oklchToLinearSrgb(palette.colors[paletteIndex]);
    const centerZ = relief * (0.65 + ringValue * 0.35 + typeValue * 0.18);
    for (let i = 0; i < tile.verts.length; i++) {
      const a = tile.verts[i];
      const b = tile.verts[(i + 1) % tile.verts.length];
      cursor = emitTriangle(
        cursor,
        { position, color, tileType, tileRing, tileOrient },
        projector,
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

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geometry.setAttribute('tileType', new THREE.BufferAttribute(tileType, 1));
  geometry.setAttribute('tileRing', new THREE.BufferAttribute(tileRing, 1));
  geometry.setAttribute('tileOrient', new THREE.BufferAttribute(tileOrient, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, palette };
}

function emitTriangle(cursor, buffers, projector, fillSub, a, b, c, rgb, typeValue, ringValue, orient) {
  if (fillSub <= 1) {
    cursor = emitProjectedVertex(cursor, buffers, projector, a, rgb, typeValue, ringValue, orient);
    cursor = emitProjectedVertex(cursor, buffers, projector, b, rgb, typeValue, ringValue, orient);
    cursor = emitProjectedVertex(cursor, buffers, projector, c, rgb, typeValue, ringValue, orient);
    return cursor;
  }
  const invN = 1 / fillSub;
  const point = (i, j) => {
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
      cursor = emitProjectedVertex(cursor, buffers, projector, point(i, j), rgb, typeValue, ringValue, orient);
      cursor = emitProjectedVertex(cursor, buffers, projector, point(i + 1, j), rgb, typeValue, ringValue, orient);
      cursor = emitProjectedVertex(cursor, buffers, projector, point(i, j + 1), rgb, typeValue, ringValue, orient);
      if (j < fillSub - i - 1) {
        cursor = emitProjectedVertex(cursor, buffers, projector, point(i + 1, j), rgb, typeValue, ringValue, orient);
        cursor = emitProjectedVertex(cursor, buffers, projector, point(i + 1, j + 1), rgb, typeValue, ringValue, orient);
        cursor = emitProjectedVertex(cursor, buffers, projector, point(i, j + 1), rgb, typeValue, ringValue, orient);
      }
    }
  }
  return cursor;
}

function emitProjectedVertex(cursor, buffers, projector, vertex, rgb, typeValue, ringValue, orient) {
  const [x, y] = projector.map(vertex[0], vertex[1]);
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

function emitVertex(cursor, position, color, tileType, tileRing, tileOrient, x, y, z, rgb, typeValue, ringValue, orient) {
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

function createProjector(settings) {
  if (intSetting(settings, 'projection', 0, 1) !== 1) {
    return { enabled: false, map: (x, y) => [x, y] };
  }
  const scale = 0.05 + intSetting(settings, 'hyp_scale', 0, 100) / 100 * 2.95;
  let bx = (intSetting(settings, 'hyp_boost_x', 0, 100) - 50) / 50 * 0.9;
  let by = (intSetting(settings, 'hyp_boost_y', 0, 100) - 50) / 50 * 0.9;
  const bMag = Math.hypot(bx, by);
  if (bMag > 0.92) {
    const s = 0.92 / bMag;
    bx *= s;
    by *= s;
  }
  return {
    enabled: true,
    map: (x, y) => projectHyp(x, y, bx, by, scale),
  };
}

function projectHyp(x, y, bx, by, scale) {
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

function classify(tiles, family, mode, colorCount) {
  const spec = FAMILY[family] ?? FAMILY[0];
  const bucket = new Uint8Array(tiles.length);
  if (mode === 0) {
    const n = Math.max(1, spec.typeBuckets);
    for (let i = 0; i < tiles.length; i++) bucket[i] = tiles[i].type % n;
    return { bucket, numBuckets: n };
  }
  if (mode === 1) {
    const n = Math.max(1, spec.orientBuckets);
    if (spec.orientFromType) {
      for (let i = 0; i < tiles.length; i++) bucket[i] = tiles[i].type % n;
      return { bucket, numBuckets: n };
    }
    const span = spec.orientHalfTurn ? Math.PI : Math.PI * 2;
    const denom = span / n;
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      const a = tile.verts[Math.min(spec.angA, tile.verts.length - 1)];
      const b = tile.verts[Math.min(spec.angB, tile.verts.length - 1)];
      let angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      if (angle < 0) angle += Math.PI * 2;
      if (spec.orientHalfTurn && angle >= Math.PI) angle -= Math.PI;
      bucket[i] = ((Math.floor((angle + denom * 0.5) / denom) % n) + n) % n;
    }
    return { bucket, numBuckets: n };
  }
  const rings = tileRings(tiles, spec);
  const n = Math.max(1, colorCount);
  for (let i = 0; i < tiles.length; i++) bucket[i] = Math.max(0, Math.min(n - 1, Math.floor(rings[i] * n)));
  return { bucket, numBuckets: n };
}

function bucketToPaletteIdx(bucket, numBuckets, colorCount) {
  if (colorCount <= 1) return 0;
  if (numBuckets > colorCount) return Math.min(colorCount - 1, Math.floor(bucket / (numBuckets / colorCount)));
  return bucket % colorCount;
}

function tileRings(tiles, spec) {
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
    if (spec?.ringChebyshev) {
      return Math.max(maxX > 0 ? Math.abs(x) / maxX : 0, maxY > 0 ? Math.abs(y) / maxY : 0);
    }
    return maxR > 0 ? Math.hypot(x, y) / maxR : 0;
  });
}

function centroid(verts) {
  let x = 0;
  let y = 0;
  for (const v of verts) {
    x += v[0];
    y += v[1];
  }
  return [x / verts.length, y / verts.length];
}

function orientation(tile, family) {
  const spec = FAMILY[family] ?? FAMILY[0];
  const a = tile.verts[Math.min(spec.angA, tile.verts.length - 1)];
  const b = tile.verts[Math.min(spec.angB, tile.verts.length - 1)];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
}
