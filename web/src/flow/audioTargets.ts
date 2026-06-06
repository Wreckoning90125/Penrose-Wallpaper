// Pure modulation-target schema: which graph handles are audio-modulatable and
// the [min, max] range each one maps into (graphValue * (max - min) + baseline).
// No React, no three — shared by the control graph today and the graph-contract
// check later, so "what is a valid signal target" lives in one place.
import { MAX_COLORS } from '../color/palette';

export const AUDIO_TARGET_RANGES: Record<string, readonly [number, number]> = {
  brightness: [0, 100],
  border_l: [0, 100],
  border_c: [0, 37],
  border_h: [0, 359],
  border_a: [0, 100],
  border_width: [0, 600],
  border_fill: [0, 100],
  border_point: [0, 100],
  border_gap: [0, 100],
  color_count: [2, MAX_COLORS],
  color_spread: [0, 100],
  color_spectral: [0, 100],
  field_displace: [0, 100],
  field_relief: [0, 100],
  field_color: [0, 100],
  field_undulate: [0, 100],
  field_freq: [0, 100],
  field_undulate_freq: [0, 100],
  field_speed: [0, 200],
  hyp_boost_x: [0, 100],
  hyp_boost_y: [0, 100],
  hyp_scale: [0, 100],
  proj_blend: [0, 100],
  light_ambient: [0, 100],
  light_angle: [0, 360],
  light_elevation: [0, 90],
  light_intensity: [0, 200],
  light_warmth: [0, 100],
  luminance: [0, 1],
  mat_clearcoat: [0, 100],
  mat_emissive: [0, 100],
  mat_iridescence: [0, 100],
  mat_metal_mod: [0, 100],
  mat_metalness: [0, 100],
  mat_relief: [0, 200],
  mat_rough_mod: [0, 100],
  mat_roughness: [0, 100],
  mat_sheen: [0, 100],
};

export function audioTargetRange(handle: string | null | undefined): readonly [number, number] | null {
  if (!handle) return null;
  const value = Object.getOwnPropertyDescriptor(AUDIO_TARGET_RANGES, handle)?.value;
  return Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number'
    ? [value[0], value[1]]
    : null;
}
