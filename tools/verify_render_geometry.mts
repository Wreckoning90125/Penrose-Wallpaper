// Headless render-geometry contract checks. This inspects the actual Three
// BufferGeometry emitted by web/src/tiling/geometry.ts so Spectre fan winding,
// relief slope, logical curved-edge grouping, and WebGPU backing-buffer budgets
// fail before a browser launch.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { BufferAttribute, InterleavedBufferAttribute, type BufferGeometry } from 'three/webgpu';
import { DEFAULT_SETTINGS, normalizeSettings, type SettingValue, type Settings } from '../web/src/settings/androidSettings.ts';
import type { Patch, Point, Tile } from '../web/src/types.ts';
import {
  buildEdgeGeometryForPatch,
  buildMeshGeometry,
  buildOverlayGeometryForPatch,
  debugSpectreBorderLayoutForVerifier,
} from '../web/src/tiling/geometry.ts';

type AttributeName =
  | 'position'
  | 'color'
  | 'paletteSlot'
  | 'tileType'
  | 'tileRing'
  | 'tileOrient'
  | 'tileCenter'
  | 'tileRelief'
  | 'tileReliefSlope'
  | 'tileLocal'
  | 'uv'
  | 'tileEdgeBary'
  | 'tileEdgeDistance'
  | 'tileTopology'
  | 'topologyPaletteColor'
  | 'tileShape'
  | 'tileScale'
  | 'edgeSide'
  | 'edgeSlope';

type Pt = [number, number];

type CheckCase = {
  name: string;
  kind: 'hat' | 'spectre';
  patch: Patch;
  settings: Settings;
};

const MAX_VERTEX_BUFFERS = 8;
const HAT_FAMILY = 11;
const SPECTRE_FAMILY = 12;
const SPECTRE_LOGICAL_SIDES = 14;
const SPECTRE_BORDER_SAMPLES_PER_SIDE = 12;
const PROJECTED_AREA_EPS = 2e-9;
const WINDING_AREA_EPS = 1e-8;
const SOURCE_MARK_RELIEF_TOLERANCE = 0.018;
const SOURCE_MARK_SLOPE_TOLERANCE = 0.12;
const CACHE_DIR = '.cache/render-geometry-check';
const ATLAS_DIR = 'web/public/generated/atlas';
const failures: string[] = [];

type SurfaceVertex = {
  x: number;
  y: number;
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
  slopeX: number;
  slopeY: number;
};

type SurfaceSample = {
  relief: number;
  slopeX: number;
  slopeY: number;
};

function fail(message: string): void {
  failures.push(message);
}

function parsePatch(buffer: Buffer): Patch {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (buffer.byteLength < 20) throw new Error(`PTG truncated: ${buffer.byteLength} bytes`);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'PTG1') throw new Error(`bad PTG magic ${magic}`);
  let offset = 4;
  const family = view.getUint32(offset, true); offset += 4;
  const seed = view.getUint32(offset, true); offset += 4;
  const generation = view.getUint32(offset, true); offset += 4;
  const tileCount = view.getUint32(offset, true); offset += 4;
  const tiles: Tile[] = [];
  for (let tileIndex = 0; tileIndex < tileCount; tileIndex++) {
    const vcount = view.getUint8(offset); offset += 1;
    const type = view.getUint8(offset); offset += 1;
    const verts: Point[] = [];
    for (let vertex = 0; vertex < vcount; vertex++) {
      verts.push([view.getFloat32(offset, true), view.getFloat32(offset + 4, true)]);
      offset += 8;
    }
    tiles.push({ type, verts });
  }
  if (offset !== buffer.byteLength) throw new Error(`PTG parse ended at ${offset}, expected ${buffer.byteLength}`);
  return { family, seed, generation, tiles };
}

function loadAtlasPatch(file: string): Patch {
  return parsePatch(readFileSync(`${ATLAS_DIR}/${file}`));
}

function generateLivePatch(family: number, seed: number, generation: number): Patch {
  mkdirSync(CACHE_DIR, { recursive: true });
  const path = `${CACHE_DIR}/${family}-${seed}-${generation}.ptg`;
  const result = spawnSync('python3', ['tools/generate_web_geometry.py', '--live', String(family), String(seed), String(generation), path], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`generate_web_geometry.py --live failed for ${family}/${seed}/${generation}\n${result.stderr}${result.stdout}`);
  }
  return parsePatch(readFileSync(path));
}

function settings(overrides: Partial<Record<keyof Settings, SettingValue>>): Settings {
  return normalizeSettings({
    family: '12',
    seed: '0',
    generation: 3,
    preset: '9',
    color_mode: '0',
    border_on: true,
    border_width: 120,
    border_join: '0',
    border_fill: 0,
    border_point: 0,
    border_gap: 0,
    mat_relief: 200,
    hyp_border_subdiv: 12,
    hyp_fill_subdiv: 3,
    ...overrides,
  });
}

function cases(): CheckCase[] {
  const out: CheckCase[] = [];
  const atlasCases = [
    ['ein-spectre-gamma.ptg', { seed: '0', generation: 3, projection: '0', border_join: '0' }],
    ['ein-spectre-disk.ptg', { seed: '8', generation: 3, projection: '1', hyp_scale: 58, border_join: '2' }],
  ] satisfies readonly [string, Partial<Record<keyof Settings, SettingValue>>][];
  for (const [file, overrides] of atlasCases) {
    if (existsSync(`${ATLAS_DIR}/${file}`)) {
      out.push({ name: file, kind: 'spectre', patch: loadAtlasPatch(file), settings: settings(overrides) });
    }
  }
  const hatPatch = generateLivePatch(HAT_FAMILY, 0, 0);
  out.push({
    name: 'live-hat-0-0-euclid',
    kind: 'hat',
    patch: hatPatch,
    settings: settings({
      family: '11',
      seed: '0',
      generation: 0,
      projection: '0',
      border_join: '1',
      hyp_fill_subdiv: 2,
    }),
  });
  for (const spec of [
    { seed: 4, projection: '0', border_join: '1' },
    { seed: 8, projection: '1', border_join: '2' },
  ] satisfies readonly { seed: number; projection: string; border_join: string }[]) {
    const patch = generateLivePatch(SPECTRE_FAMILY, spec.seed, 0);
    out.push({
      name: `live-spectre-${spec.seed}-0-${spec.projection === '1' ? 'poincare' : 'euclid'}`,
      kind: 'spectre',
      patch,
      settings: settings({
        seed: String(spec.seed),
        generation: 0,
        projection: spec.projection,
        border_join: spec.border_join,
        hyp_fill_subdiv: 1,
      }),
    });
  }
  return out;
}

function attribute(geometry: BufferGeometry, name: AttributeName): BufferAttribute | InterleavedBufferAttribute | null {
  return geometry.hasAttribute(name) ? geometry.getAttribute(name) : null;
}

function requireAttribute(geometry: BufferGeometry, name: AttributeName, context: string): BufferAttribute | InterleavedBufferAttribute | null {
  const attr = attribute(geometry, name);
  if (!attr) fail(`${context}: missing ${name} attribute`);
  return attr;
}

function backingBufferCount(geometry: BufferGeometry): number {
  const backings = new Set<object>();
  for (const key of Object.keys(geometry.attributes)) {
    const attr = geometry.getAttribute(key);
    backings.add(attr instanceof InterleavedBufferAttribute ? attr.data : attr);
  }
  return backings.size;
}

function sharedInterleavedBacking(geometry: BufferGeometry, names: readonly AttributeName[], context: string): void {
  let backing: object | null = null;
  for (const name of names) {
    const attr = requireAttribute(geometry, name, context);
    if (!attr) continue;
    if (!(attr instanceof InterleavedBufferAttribute)) {
      fail(`${context}: ${name} is not packed into the interleaved custom buffer`);
      continue;
    }
    if (!backing) {
      backing = attr.data;
    } else if (backing !== attr.data) {
      fail(`${context}: ${name} uses a separate custom interleaved backing buffer`);
    }
  }
}

function checkBackings(fill: BufferGeometry, edge: BufferGeometry | null, context: string): void {
  const fillBuffers = backingBufferCount(fill);
  if (fillBuffers > MAX_VERTEX_BUFFERS) fail(`${context}: fill uses ${fillBuffers} vertex buffers`);
  if (fill.hasAttribute('normal')) fail(`${context}: fill unexpectedly emits a normal attribute`);
  sharedInterleavedBacking(
    fill,
    ['tileType', 'tileRing', 'tileOrient', 'tileCenter', 'tileRelief', 'tileShape', 'tileScale', 'tileReliefSlope', 'tileLocal', 'uv', 'tileEdgeBary', 'tileEdgeDistance', 'tileTopology', 'topologyPaletteColor'],
    `${context}/fill`,
  );
  if (!edge) return;
  const edgeBuffers = backingBufferCount(edge);
  if (edgeBuffers > MAX_VERTEX_BUFFERS) fail(`${context}: edge uses ${edgeBuffers} vertex buffers`);
  if (edge.hasAttribute('normal')) fail(`${context}: edge unexpectedly emits a normal attribute`);
  sharedInterleavedBacking(
    edge,
    ['tileType', 'tileRing', 'tileOrient', 'tileCenter', 'tileRelief', 'tileShape', 'tileScale', 'tileLocal', 'tileTopology', 'edgeSide', 'edgeSlope'],
    `${context}/edge`,
  );
}

function checkOverlayBackings(overlay: BufferGeometry, context: string): void {
  const buffers = backingBufferCount(overlay);
  if (buffers > MAX_VERTEX_BUFFERS) fail(`${context}: overlay uses ${buffers} vertex buffers`);
  if (overlay.hasAttribute('normal')) fail(`${context}: overlay unexpectedly emits a normal attribute`);
  sharedInterleavedBacking(
    overlay,
    ['tileType', 'tileRing', 'tileOrient', 'tileCenter', 'tileRelief', 'tileShape', 'tileScale', 'tileLocal', 'tileTopology', 'edgeSide', 'edgeSlope'],
    context,
  );
}

function triArea(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function checkFillTriangles(geometry: BufferGeometry, context: string): void {
  const position = requireAttribute(geometry, 'position', context);
  if (!position) return;
  if (position.count % 3 !== 0) fail(`${context}: position count ${position.count} is not triangles`);
  let negative = 0;
  let degenerate = 0;
  let totalArea = 0;
  let degenerateArea = 0;
  for (let i = 0; i + 2 < position.count; i += 3) {
    const ax = position.getX(i);
    const ay = position.getY(i);
    const bx = position.getX(i + 1);
    const by = position.getY(i + 1);
    const cx = position.getX(i + 2);
    const cy = position.getY(i + 2);
    if (![ax, ay, bx, by, cx, cy].every(Number.isFinite)) fail(`${context}: non-finite triangle coordinate at vertex ${i}`);
    const area = triArea(ax, ay, bx, by, cx, cy);
    const absArea = Math.abs(area);
    totalArea += absArea;
    if (absArea <= PROJECTED_AREA_EPS) {
      degenerate++;
      degenerateArea += absArea;
    }
    else if (area < -WINDING_AREA_EPS) negative++;
  }
  const degenerateLimit = Math.max(32, Math.floor(position.count / 6000));
  const degenerateAreaRatio = totalArea > 0 ? degenerateArea / totalArea : 1;
  if (degenerate > degenerateLimit && degenerateAreaRatio > 1e-5) {
    fail(`${context}: ${degenerate} near-degenerate fill triangle(s), area ratio ${degenerateAreaRatio}`);
  }
  if (negative > 0) fail(`${context}: ${negative} clockwise fill triangle(s) after winding normalization`);
}

function checkFiniteAttribute(geometry: BufferGeometry, name: AttributeName, maxAbs: number, context: string): { count: number; nonzero: number } {
  const attr = requireAttribute(geometry, name, context);
  if (!attr) return { count: 0, nonzero: 0 };
  let nonzero = 0;
  for (let index = 0; index < attr.count; index++) {
    for (let component = 0; component < attr.itemSize; component++) {
      const value = attr.getComponent(index, component);
      if (!Number.isFinite(value)) fail(`${context}: ${name}[${index},${component}] is not finite`);
      if (Math.abs(value) > maxAbs) fail(`${context}: ${name}[${index},${component}] exceeds ${maxAbs}: ${value}`);
      if (Math.abs(value) > 1e-8) nonzero++;
    }
  }
  return { count: attr.count, nonzero };
}

function checkEdgeBaryAttribute(geometry: BufferGeometry, context: string): void {
  const position = requireAttribute(geometry, 'position', context);
  const bary = requireAttribute(geometry, 'tileEdgeBary', `${context}/fill`);
  if (!position || !bary) return;
  if (bary.count !== position.count) {
    fail(`${context}: tileEdgeBary count ${bary.count} != position count ${position.count}`);
    return;
  }
  if (bary.itemSize !== 3) fail(`${context}: tileEdgeBary itemSize ${bary.itemSize} != 3`);
  let realBoundaryTriangles = 0;
  let pinnedInteriorTriangles = 0;
  for (let i = 0; i + 2 < bary.count; i += 3) {
    let zeroComponents = 0;
    let pinnedComponents = 0;
    for (let component = 0; component < 3; component++) {
      const a = bary.getComponent(i, component);
      const b = bary.getComponent(i + 1, component);
      const c = bary.getComponent(i + 2, component);
      if (![a, b, c].every(Number.isFinite)) {
        fail(`${context}: tileEdgeBary triangle ${i / 3} component ${component} is not finite`);
      }
      if (a < -1e-6 || a > 1 + 1e-6 || b < -1e-6 || b > 1 + 1e-6 || c < -1e-6 || c > 1 + 1e-6) {
        fail(`${context}: tileEdgeBary triangle ${i / 3} component ${component} is outside [0,1]`);
      }
      const zeros = [a, b, c].filter(value => Math.abs(value) <= 1e-6).length;
      if (zeros === 2) zeroComponents++;
      if (Math.abs(a - 1) <= 1e-6 && Math.abs(b - 1) <= 1e-6 && Math.abs(c - 1) <= 1e-6) pinnedComponents++;
    }
    if (zeroComponents > 0) realBoundaryTriangles++;
    if (pinnedComponents === 3) pinnedInteriorTriangles++;
  }
  if (realBoundaryTriangles === 0) fail(`${context}: tileEdgeBary never exposes a real tile boundary`);
  if (pinnedInteriorTriangles === 0) fail(`${context}: tileEdgeBary never pins interior triangulation seams`);
}

function checkEdgeDistanceAttribute(geometry: BufferGeometry, context: string): void {
  const position = requireAttribute(geometry, 'position', context);
  const edgeDistance = requireAttribute(geometry, 'tileEdgeDistance', `${context}/fill`);
  const bary = requireAttribute(geometry, 'tileEdgeBary', `${context}/fill`);
  if (!position || !edgeDistance || !bary) return;
  if (edgeDistance.count !== position.count) {
    fail(`${context}: tileEdgeDistance count ${edgeDistance.count} != position count ${position.count}`);
    return;
  }
  if (edgeDistance.itemSize !== 3) fail(`${context}: tileEdgeDistance itemSize ${edgeDistance.itemSize} != 3`);
  let activeTriangles = 0;
  for (let index = 0; index < edgeDistance.count; index++) {
    for (let component = 0; component < 3; component++) {
      const value = edgeDistance.getComponent(index, component);
      if (!Number.isFinite(value)) fail(`${context}: tileEdgeDistance[${index},${component}] is not finite`);
      if (value < -1e-6 || value > 1 + 1e-6) fail(`${context}: tileEdgeDistance[${index},${component}] is outside [0,1]: ${value}`);
    }
  }
  for (let i = 0; i + 2 < edgeDistance.count; i += 3) {
    let activeComponents = 0;
    for (let component = 0; component < 3; component++) {
      const ba = bary.getComponent(i, component);
      const bb = bary.getComponent(i + 1, component);
      const bc = bary.getComponent(i + 2, component);
      const pinned = Math.abs(ba - 1) <= 1e-6 && Math.abs(bb - 1) <= 1e-6 && Math.abs(bc - 1) <= 1e-6;
      if (pinned) continue;
      const value = edgeDistance.getComponent(i, component);
      if (value > 1e-6) activeComponents++;
    }
    if (activeComponents > 0) activeTriangles++;
  }
  if (activeTriangles === 0) fail(`${context}: tileEdgeDistance has no active metric edge scales`);
}

function checkTopologyPaletteAttribute(geometry: BufferGeometry, context: string): void {
  const position = requireAttribute(geometry, 'position', context);
  const color = requireAttribute(geometry, 'topologyPaletteColor', `${context}/fill`);
  if (!position || !color) return;
  if (color.count !== position.count) {
    fail(`${context}: topologyPaletteColor count ${color.count} != position count ${position.count}`);
    return;
  }
  if (color.itemSize !== 3) fail(`${context}: topologyPaletteColor itemSize ${color.itemSize} != 3`);
  for (let index = 0; index < color.count; index++) {
    for (let component = 0; component < 3; component++) {
      const value = color.getComponent(index, component);
      if (!Number.isFinite(value)) fail(`${context}: topologyPaletteColor[${index},${component}] is not finite`);
      if (value < -1e-6 || value > 1 + 1e-6) {
        fail(`${context}: topologyPaletteColor[${index},${component}] is outside [0,1]: ${value}`);
      }
    }
  }
}

function checkOverlaySidedness(geometry: BufferGeometry, context: string): void {
  const edgeSide = requireAttribute(geometry, 'edgeSide', context);
  if (!edgeSide) return;
  let positive = 0;
  let negative = 0;
  for (let index = 0; index < edgeSide.count; index++) {
    const value = edgeSide.getX(index);
    if (value > 0.5) positive++;
    if (value < -0.5) negative++;
  }
  if (positive === 0 || negative === 0) {
    fail(`${context}: source overlay must emit both positive and negative edgeSide decal copies`);
  }
}

type OverlayChannelExpectation = {
  expectLine: boolean;
  expectCurves: boolean;
  expectPenroseFilled: boolean;
  expectAmmannBeenkerFilled: boolean;
};

function checkOverlayTypeChannels(geometry: BufferGeometry, context: string, expectation: OverlayChannelExpectation): void {
  const tileType = requireAttribute(geometry, 'tileType', context);
  if (!tileType) return;
  let red = 0;
  let blue = 0;
  let line = 0;
  let kite = 0;
  let dart = 0;
  let ink = 0;
  let paper = 0;
  for (let index = 0; index < tileType.count; index++) {
    const value = tileType.getX(index);
    if (Math.abs(value) < 0.25) red++;
    if (Math.abs(value - 1) < 0.25) blue++;
    if (Math.abs(value - 2) < 0.25) line++;
    if (Math.abs(value - 3) < 0.25) kite++;
    if (Math.abs(value - 4) < 0.25) dart++;
    if (Math.abs(value - 5) < 0.25) ink++;
    if (Math.abs(value - 6) < 0.25) paper++;
  }
  if (expectation.expectCurves && (red === 0 || blue === 0)) fail(`${context}: source overlay is missing red/blue curve channels`);
  if (!expectation.expectCurves && (red > 0 || blue > 0)) fail(`${context}: source overlay emitted curve channels when curves are disabled`);
  if (expectation.expectLine && line === 0) fail(`${context}: source overlay is missing construction-line channel`);
  if (!expectation.expectLine && line > 0) fail(`${context}: source overlay emitted construction lines when lines are disabled`);
  if (expectation.expectPenroseFilled && (kite === 0 || dart === 0)) fail(`${context}: source overlay is missing filled Penrose kite/dart channels`);
  if (!expectation.expectPenroseFilled && (kite > 0 || dart > 0)) fail(`${context}: source overlay emitted Penrose filled channels when filled mode is disabled`);
  if (expectation.expectAmmannBeenkerFilled && (ink === 0 || paper === 0)) fail(`${context}: source overlay is missing Ammann-Beenker Truchet ink/paper channels`);
  if (!expectation.expectAmmannBeenkerFilled && (ink > 0 || paper > 0)) fail(`${context}: source overlay emitted Ammann-Beenker filled channels when disabled`);
}

function countOverlayChannelVertices(geometry: BufferGeometry, channel: number, context: string): number {
  const tileType = requireAttribute(geometry, 'tileType', context);
  if (!tileType) return 0;
  let count = 0;
  for (let index = 0; index < tileType.count; index++) {
    if (Math.abs(tileType.getX(index) - channel) < 0.25) count++;
  }
  return count;
}

function checkAmmannBeenkerSquareOnlySourceOverlay(patch: Patch, overlay: BufferGeometry, context: string): void {
  const squareCount = patch.tiles.filter(tile => tile.type === 1 && tile.verts.length === 4).length;
  const rhombCount = patch.tiles.filter(tile => tile.type !== 1 && tile.verts.length === 4).length;
  if (squareCount === 0 || rhombCount === 0) fail(`${context}: fixture must contain both squares and rhombs`);
  const inkVertices = countOverlayChannelVertices(overlay, 5, context);
  const paperVertices = countOverlayChannelVertices(overlay, 6, context);
  const lineVertices = countOverlayChannelVertices(overlay, 2, context);
  const expectedFilledVertices = squareCount * 6;
  const expectedLineVertices = squareCount * 12;
  if (inkVertices !== expectedFilledVertices || paperVertices !== expectedFilledVertices) {
    fail(`${context}: Ammann-Beenker source overlay must emit one dual-sided split triangle per square half (${inkVertices}/${paperVertices}, expected ${expectedFilledVertices})`);
  }
  if (lineVertices !== expectedLineVertices) {
    fail(`${context}: Ammann-Beenker source overlay must emit one dual-sided separator per square (${lineVertices}, expected ${expectedLineVertices})`);
  }
}

function checkReliefAndSlopes(fill: BufferGeometry, edge: BufferGeometry | null, context: string): void {
  const fillPosition = requireAttribute(fill, 'position', context);
  const fillSlope = checkFiniteAttribute(fill, 'tileReliefSlope', 1e4, `${context}/fill`);
  const tileShape = checkFiniteAttribute(fill, 'tileShape', 1e4, `${context}/fill`);
  if (fillPosition && fillSlope.count !== fillPosition.count) {
    fail(`${context}: tileReliefSlope count ${fillSlope.count} != position count ${fillPosition.count}`);
  }
  if (tileShape.nonzero === 0) fail(`${context}: Spectre tileShape is all zero`);
  if (fillSlope.nonzero === 0) fail(`${context}: Spectre tileReliefSlope is all zero`);
  if (!edge) {
    fail(`${context}: expected edge geometry`);
    return;
  }
  const edgePosition = requireAttribute(edge, 'position', context);
  const edgeSlope = checkFiniteAttribute(edge, 'edgeSlope', 1e4, `${context}/edge`);
  if (edgePosition && edgeSlope.count !== edgePosition.count) {
    fail(`${context}: edgeSlope count ${edgeSlope.count} != edge position count ${edgePosition.count}`);
  }
  if (edgeSlope.nonzero === 0) fail(`${context}: Spectre edgeSlope is all zero`);
}

function checkDebugLayout(test: CheckCase): void {
  const rows = debugSpectreBorderLayoutForVerifier(test.patch, test.settings);
  if (rows.length !== test.patch.tiles.length * SPECTRE_LOGICAL_SIDES) {
    fail(`${test.name}: debug layout rows ${rows.length} != tiles*14 ${test.patch.tiles.length * SPECTRE_LOGICAL_SIDES}`);
    return;
  }
  const expectedSamples = Math.max(Number(test.settings.hyp_border_subdiv), SPECTRE_BORDER_SAMPLES_PER_SIDE) + 1;
  for (const row of rows) {
    if (row.logicalEdgeCount !== SPECTRE_LOGICAL_SIDES) fail(`${test.name}: tile ${row.tileIndex} has ${row.logicalEdgeCount} logical edges`);
    if (!row.curved) fail(`${test.name}: tile ${row.tileIndex} edge ${row.edgeIndex} is not marked curved`);
    if (row.sampleCount !== expectedSamples) {
      fail(`${test.name}: tile ${row.tileIndex} edge ${row.edgeIndex} sample count ${row.sampleCount} != ${expectedSamples}`);
    }
    if (row.maxChordDistance <= 1e-5) fail(`${test.name}: tile ${row.tileIndex} edge ${row.edgeIndex} has no measurable curve`);
    for (const hint of row.surfaceHints) {
      if (!Number.isInteger(hint) || hint < 0 || hint >= SPECTRE_LOGICAL_SIDES) {
        fail(`${test.name}: tile ${row.tileIndex} edge ${row.edgeIndex} bad surface hint ${hint}`);
      }
    }
  }
}

function checkPatchIdentity(test: CheckCase): void {
  if (test.kind === 'hat') {
    if (test.patch.family !== HAT_FAMILY) fail(`${test.name}: family ${test.patch.family} is not Hat`);
    for (let i = 0; i < test.patch.tiles.length; i++) {
      const tile = test.patch.tiles[i]!;
      if (tile.verts.length !== 13) fail(`${test.name}: tile ${i} has ${tile.verts.length} Hat vertices`);
      if (tile.type < 0 || tile.type > 4) fail(`${test.name}: tile ${i} has unexpected Hat type ${tile.type}`);
    }
    return;
  }
  if (test.patch.family !== SPECTRE_FAMILY) fail(`${test.name}: family ${test.patch.family} is not Spectre`);
  for (let i = 0; i < test.patch.tiles.length; i++) {
    const tile = test.patch.tiles[i]!;
    if (tile.verts.length !== SPECTRE_LOGICAL_SIDES) fail(`${test.name}: tile ${i} has ${tile.verts.length} anchors`);
    if (tile.type < 0 || tile.type > 9) fail(`${test.name}: tile ${i} has unexpected type ${tile.type}`);
  }
}

function bboxArea(points: readonly Pt[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  }
  return Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
}

function checkBorderGeometryNotCollapsed(edge: BufferGeometry | null, context: string): void {
  if (!edge) return;
  const position = requireAttribute(edge, 'position', context);
  if (!position) return;
  const points: Pt[] = [];
  for (let i = 0; i < position.count; i++) points.push([position.getX(i), position.getY(i)]);
  if (bboxArea(points) <= 1e-10) fail(`${context}: edge geometry has collapsed 2D bounds`);
}

// Canonical equal-edge Penrose P3 (rhomb) rule — the Robinson-triangle substitution
// MLD to the Penrose Rhomb tiling (GS87) — in the internal role convention
// (verts [A(apex), B, C], type = colour 0 acute / 1 obtuse). notebookFinalize()
// reorders to the renderer convention (base at edge index 2, type acute = 1 /
// obtuse = 0) so this reference matches the C++ generator's finalized output. This
// is the independent TS reimplementation that cross-checks the C++ port.
function notebookSunSeed(): Tile[] {
  const tiles: Tile[] = [];
  for (let i = 0; i < 10; i++) {
    const a1 = 2 * Math.PI * i / 10;
    const a2 = 2 * Math.PI * (i + 1) / 10;
    let b: Point = [Math.cos(a1), Math.sin(a1)];
    let c: Point = [Math.cos(a2), Math.sin(a2)];
    if ((i & 1) === 0) { const t = b; b = c; c = t; }
    tiles.push({ type: 0, verts: [[0, 0], b, c] });
  }
  return tiles;
}

function notebookDeflate(tile: Tile): Tile[] {
  const a = tile.verts[0]!;
  const b = tile.verts[1]!;
  const c = tile.verts[2]!;
  const psi = (Math.sqrt(5) - 1) * 0.5; // 1/phi
  const psi2 = 1 - psi;                 // 1/phi^2
  const combine = (p: Point, pw: number, q: Point, qw: number): Point => [p[0] * pw + q[0] * qw, p[1] * pw + q[1] * qw];
  if (tile.type === 0) {
    const P = combine(a, psi2, b, psi);
    return [
      { type: 0, verts: [c, P, b] },
      { type: 1, verts: [P, c, a] },
    ];
  }
  const Q = combine(b, psi2, a, psi);
  const R = combine(b, psi2, c, psi);
  return [
    { type: 1, verts: [R, c, a] },
    { type: 1, verts: [Q, R, b] },
    { type: 0, verts: [R, Q, a] },
  ];
}

function notebookFinalize(tile: Tile): Tile {
  const a = tile.verts[0]!;
  const b = tile.verts[1]!;
  const c = tile.verts[2]!;
  const eab = Math.hypot(a[0] - b[0], a[1] - b[1]);
  const ebc = Math.hypot(b[0] - c[0], b[1] - c[1]);
  const eca = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const type = tile.type === 0 ? 1 : 0;
  const dAbBc = Math.abs(eab - ebc);
  const dBcCa = Math.abs(ebc - eca);
  const dCaAb = Math.abs(eca - eab);
  if (dAbBc <= dBcCa && dAbBc <= dCaAb) return { type, verts: [c, b, a] };
  if (dBcCa <= dCaAb) return { type, verts: [a, c, b] };
  return { type, verts: [b, a, c] };
}

function checkNotebookTileTuples(actual: readonly Tile[], expected: readonly Tile[], context: string): void {
  if (actual.length !== expected.length) {
    fail(`${context}: expected ${expected.length} notebook source triangles, got ${actual.length}`);
    return;
  }
  for (let tileIndex = 0; tileIndex < expected.length; tileIndex++) {
    const actualTile = actual[tileIndex]!;
    const expectedTile = expected[tileIndex]!;
    if (actualTile.type !== expectedTile.type) fail(`${context}: tile ${tileIndex} type ${actualTile.type} != notebook ${expectedTile.type}`);
    if (actualTile.verts.length !== expectedTile.verts.length) {
      fail(`${context}: tile ${tileIndex} vertex count ${actualTile.verts.length} != notebook ${expectedTile.verts.length}`);
      continue;
    }
    for (let vertex = 0; vertex < expectedTile.verts.length; vertex++) {
      const actualPoint = actualTile.verts[vertex]!;
      const expectedPoint = expectedTile.verts[vertex]!;
      const dx = Math.abs(actualPoint[0] - expectedPoint[0]);
      const dy = Math.abs(actualPoint[1] - expectedPoint[1]);
      if (dx > 2e-6 || dy > 2e-6) {
        fail(`${context}: tile ${tileIndex} vertex ${vertex} [${actualPoint[0]},${actualPoint[1]}] != notebook [${expectedPoint[0]},${expectedPoint[1]}]`);
      }
    }
  }
}

// P2 kite/dart reference: the "Penrose Tiles" notebook Deflate (type 1 = acute a[],
// type 0 = obtuse o[]; c1 = 1/phi, c2 = 1/phi^2). These tiles are already in the
// renderer convention (apex at vert 1, base at edge 2), so — unlike P3 — the live
// generator applies NO finalize, and neither does this reference.
function kiteDartSunSeed(): Tile[] {
  const tiles: Tile[] = [];
  for (let i = 0; i < 5; i++) {
    const a0 = 2 * Math.PI * i / 5;
    const ap = a0 + Math.PI / 5;
    const am = a0 - Math.PI / 5;
    const ax = Math.cos(a0);
    const ay = Math.sin(a0);
    tiles.push({ type: 1, verts: [[ax, ay], [0, 0], [Math.cos(ap), Math.sin(ap)]] });
    tiles.push({ type: 1, verts: [[ax, ay], [0, 0], [Math.cos(am), Math.sin(am)]] });
  }
  return tiles;
}

function kiteDartDeflate(tile: Tile): Tile[] {
  const x = tile.verts[0]!;
  const y = tile.verts[1]!;
  const z = tile.verts[2]!;
  const psi = (Math.sqrt(5) - 1) * 0.5; // 1/phi
  const psi2 = 1 - psi;                 // 1/phi^2
  const combine = (p: Point, pw: number, q: Point, qw: number): Point => [p[0] * pw + q[0] * qw, p[1] * pw + q[1] * qw];
  if (tile.type === 1) {
    const d = combine(x, psi, y, psi2);
    const e = combine(y, psi, z, psi2);
    return [
      { type: 1, verts: [d, z, x] },
      { type: 1, verts: [d, z, e] },
      { type: 0, verts: [y, e, d] },
    ];
  }
  const d = combine(x, psi2, z, psi);
  return [
    { type: 0, verts: [z, d, y] },
    { type: 1, verts: [y, x, d] },
  ];
}

function checkPenroseNotebookSourceRules(family: number, context: string): void {
  if (family === 1) {
    // P2: notebook kite/dart rule, no finalize (tiles are already renderer-convention).
    const seed = kiteDartSunSeed();
    checkNotebookTileTuples(generateLivePatch(family, 0, 0).tiles, seed, `${context}/Sun`);
    checkNotebookTileTuples(generateLivePatch(family, 0, 1).tiles, seed.flatMap(tile => kiteDartDeflate(tile)), `${context}/Deflate[Sun]`);
    return;
  }
  // P3: the generator subdivides in the internal (Robinson-triangle role) convention and reorders
  // to the renderer convention at the end, so the notebook mirrors that: deflate
  // first, then notebookFinalize each tile before comparing against the live output.
  const seed = notebookSunSeed();
  checkNotebookTileTuples(generateLivePatch(family, 0, 0).tiles, seed.map(notebookFinalize), `${context}/Sun`);
  checkNotebookTileTuples(generateLivePatch(family, 0, 1).tiles, seed.flatMap(tile => notebookDeflate(tile)).map(notebookFinalize), `${context}/Deflate[Sun]`);
}

function checkSourceOverlay(
  family: number,
  seed: number,
  generation: number,
  context: string,
  sourceDetail = 2,
  overlayExpectation: OverlayChannelExpectation | null = null,
): void {
  const patch = generateLivePatch(family, seed, generation);
  const activeSettings = settings({
    family: String(family),
    seed: String(seed),
    generation,
    ornament_style: 4,
    ornament_amount: 100,
    ornament_density: 100,
    source_mark_detail: sourceDetail,
    hyp_fill_subdiv: 2,
  });
  const overlay = buildOverlayGeometryForPatch(patch, activeSettings);
  if (!overlay) {
    fail(`${context}: source overlay geometry is missing`);
    return;
  }
  checkOverlayBackings(overlay, `${context}/source-overlay`);
  checkFiniteAttribute(overlay, 'position', 1e7, `${context}/source-overlay`);
  checkFiniteAttribute(overlay, 'edgeSlope', 1e4, `${context}/source-overlay`);
  checkOverlaySidedness(overlay, `${context}/source-overlay`);
  if (overlayExpectation) {
    checkOverlayTypeChannels(overlay, `${context}/source-overlay`, overlayExpectation);
  }
  if (family === 5 && sourceDetail === 2) {
    checkAmmannBeenkerSquareOnlySourceOverlay(patch, overlay, `${context}/source-overlay`);
  }
  checkBorderGeometryNotCollapsed(overlay, `${context}/source-overlay`);
  const position = requireAttribute(overlay, 'position', `${context}/source-overlay`);
  if (position && position.count < 6) fail(`${context}: source overlay has too few vertices (${position.count})`);
  overlay.dispose();
}

for (const test of cases()) {
  checkPatchIdentity(test);
  const build = buildMeshGeometry(test.patch, test.settings);
  const edge = build.edgeGeometry ?? buildEdgeGeometryForPatch(test.patch, test.settings);
  checkBackings(build.geometry, edge, test.name);
  checkFillTriangles(build.geometry, test.name);
  checkEdgeBaryAttribute(build.geometry, test.name);
  checkEdgeDistanceAttribute(build.geometry, test.name);
  checkTopologyPaletteAttribute(build.geometry, test.name);
  if (test.kind === 'spectre') {
    checkReliefAndSlopes(build.geometry, edge, test.name);
    checkDebugLayout(test);
  } else {
    checkFiniteAttribute(build.geometry, 'tileShape', 1e4, `${test.name}/fill`);
    checkFiniteAttribute(build.geometry, 'tileReliefSlope', 1e4, `${test.name}/fill`);
  }
  checkBorderGeometryNotCollapsed(edge, test.name);
  build.geometry.dispose();
  edge?.dispose();
}

checkPenroseNotebookSourceRules(0, 'P3 notebook source rules');
checkPenroseNotebookSourceRules(1, 'P2 notebook source rules');
checkSourceOverlay(0, 0, 3, 'P3 source markings / outlines', 0, { expectLine: true, expectCurves: false, expectPenroseFilled: false, expectAmmannBeenkerFilled: false });
checkSourceOverlay(0, 0, 3, 'P3 source markings / outlines+arcs', 1, { expectLine: true, expectCurves: true, expectPenroseFilled: false, expectAmmannBeenkerFilled: false });
checkSourceOverlay(0, 0, 3, 'P3 source markings / filled tiles', 2, { expectLine: true, expectCurves: false, expectPenroseFilled: true, expectAmmannBeenkerFilled: false });
checkSourceOverlay(1, 0, 1, 'P2 source markings / outlines+arcs', 1, { expectLine: true, expectCurves: true, expectPenroseFilled: false, expectAmmannBeenkerFilled: false });
checkSourceOverlay(5, 0, 2, 'Ammann-Beenker Beatty diagonal graph', 0, { expectLine: true, expectCurves: false, expectPenroseFilled: false, expectAmmannBeenkerFilled: false });
checkSourceOverlay(5, 0, 2, 'Ammann-Beenker Smith curve avatar', 1, { expectLine: false, expectCurves: true, expectPenroseFilled: false, expectAmmannBeenkerFilled: false });
checkSourceOverlay(5, 0, 2, 'Ammann-Beenker dipped-corner square fill', 2, { expectLine: true, expectCurves: false, expectPenroseFilled: false, expectAmmannBeenkerFilled: true });
checkSourceOverlay(5, 0, 1, 'Ammann-Beenker Ammann bars', 3, { expectLine: true, expectCurves: false, expectPenroseFilled: false, expectAmmannBeenkerFilled: false });

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`[render-geometry] ${failure}\n`);
  process.stderr.write(`[render-geometry] ${failures.length} failure(s)\n`);
  process.exit(1);
}

process.stdout.write(`[render-geometry] OK: Spectre curves/slopes and Hat/Spectre buffer backings verified\n`);
