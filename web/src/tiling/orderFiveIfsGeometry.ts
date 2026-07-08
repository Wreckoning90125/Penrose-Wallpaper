// BufferGeometry wrapper around the pure orderFiveIfs point builder. Kept in
// its own module so `three/webgpu` stays out of the entry chunk: App.tsx loads
// this dynamically alongside the renderer (see the renderer-init effect).
import { BufferAttribute, BufferGeometry } from 'three/webgpu';
import type { Settings } from '../settings/androidSettings';
import type { Oklch } from '../color/palette';
import { buildOrderFiveIfsPoints } from './orderFiveIfs';

export function buildOrderFiveIfsGeometry(settings: Settings, customColors: Oklch[] | null = null): BufferGeometry {
  const { positions, colors } = buildOrderFiveIfsPoints(settings, customColors);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}
