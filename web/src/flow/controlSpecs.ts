// Pure control-spec data for the control-graph nodes: [settingKey, label, min,
// max, step] tuples per node. No React/three — shared by the node components and
// reusable by the graph-contract check (every control here should map to an
// inlet and, where modulatable, an AUDIO_TARGET_RANGES entry).
import type { SettingKey } from '../settings/androidSettings';

export type ControlSpec = readonly [SettingKey, string, number, number, number];

export const MATERIAL_CONTROLS: ControlSpec[] = [
  ['mat_relief', 'Relief', 0, 200, 1],
  ['mat_roughness', 'Roughness', 0, 100, 1],
  ['mat_rough_mod', 'Worn edges', 0, 100, 1],
  ['mat_metalness', 'Metalness', 0, 100, 1],
  ['mat_metal_mod', 'Metal variation', 0, 100, 1],
  ['mat_clearcoat', 'Clearcoat', 0, 100, 1],
  ['mat_iridescence', 'Iridescence', 0, 100, 1],
  ['mat_sheen', 'Sheen', 0, 200, 1],
  ['mat_anisotropy', 'Anisotropy', 0, 100, 1],
  ['mat_emissive', 'Emissive glow', 0, 200, 1],
];

export const LIGHT_CONTROLS: ControlSpec[] = [
  ['light_angle', 'Angle', 0, 360, 1],
  ['light_elevation', 'Elevation', 0, 90, 1],
  ['light_intensity', 'Intensity', 0, 200, 1],
  ['light_warmth', 'Warmth', 0, 100, 1],
  ['light_ambient', 'Ambient', 0, 100, 1],
];

export const PROJECTION_CONTROLS: ControlSpec[] = [
  ['proj_blend', 'Euclid↔Poincaré', 0, 100, 1],
  ['hyp_scale', 'Scale', 0, 100, 1],
  ['hyp_boost_x', 'Boost X', 0, 100, 1],
  ['hyp_boost_y', 'Boost Y', 0, 100, 1],
  ['hyp_fill_subdiv', 'Fill subdiv', 1, 8, 1],
  ['hyp_border_subdiv', 'Edge subdiv', 1, 32, 1],
];

export const CLOCK_CONTROLS: ControlSpec[] = [
  ['clock_rate', 'Rate', 0, 240, 1],
];

export const RIPPLE_TARGET_CONTROLS: ControlSpec[] = [
  ['brightness', 'Brightness', 40, 180, 1],
  ['field_displace', 'Displace', 0, 100, 1],
  ['field_relief', 'Relief', 0, 100, 1],
  ['field_color', 'Color', 0, 100, 1],
  ['field_speed', 'Speed', 0, 200, 1],
];

// The actual tile border (the edgeMesh): width is baked into the edge geometry,
// L/C/H/opacity drive the edgeMaterial live. `border_on` is the on/off toggle,
// rendered via a segmented control in the node, not a slider.
export const BORDER_CONTROLS: ControlSpec[] = [
  ['border_width', 'Width', 0, 600, 1],
  ['border_l', 'Light', 0, 100, 1],
  ['border_c', 'Chroma', 0, 37, 1],
  ['border_h', 'Hue', 0, 359, 1],
  ['border_a', 'Opacity', 0, 100, 1],
];
