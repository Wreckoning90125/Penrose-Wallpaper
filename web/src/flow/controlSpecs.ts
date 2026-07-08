// Pure control-spec data for the control-graph nodes: [settingKey, label, min,
// max, step] tuples per node. No React/three — shared by the node components and
// reusable by the graph-contract check (every control here should map to an
// inlet and, where modulatable, an AUDIO_TARGET_RANGES entry).
import type { SettingKey } from '../settings/androidSettings';

export type ControlSpec = readonly [SettingKey, string, number, number, number];

export const MATERIAL_CONTROLS: ControlSpec[] = [
  ['brightness', 'Brightness', 0, 100, 1],
  ['mat_relief', 'Relief', 0, 200, 1],
  ['mat_facet_curve', 'Facet dome', 0, 100, 1],
  ['mat_relief_guide', 'Guided C²', 0, 100, 1],
  ['mat_ring_relief', 'Concentric rings', 0, 100, 1],
  ['mat_lattice_spline', 'Lattice field', 0, 100, 1],
  ['mat_harnack', 'Harnack relief', 0, 100, 1],
  ['mat_roughness', 'Roughness', 0, 100, 1],
  ['mat_rough_mod', 'Worn edges', 0, 100, 1],
  ['mat_metalness', 'Metalness', 0, 100, 1],
  ['mat_metal_mod', 'Metal variation', 0, 100, 1],
  ['mat_anisotropy', 'Brushed grain', 0, 100, 1],
  ['mat_clearcoat', 'Clearcoat', 0, 100, 1],
  ['mat_iridescence', 'Iridescence', 0, 100, 1],
  ['mat_sheen', 'Sheen', 0, 100, 1],
  ['mat_emissive', 'Emissive glow', 0, 100, 1],
  ['surface_contour_amount', 'Contours', 0, 100, 1],
  ['surface_contour_source', 'Contour source', 0, 7, 1],
  ['surface_contour_spacing', 'Contour spacing', 1, 64, 1],
  ['surface_contour_width', 'Contour width', 1, 50, 1],
  ['surface_contour_feature', 'Contour edge', 0, 100, 1],
  ['surface_stripe', 'Stripe field', 0, 100, 1],
  ['surface_contour_phase', 'Contour phase', 0, 100, 1],
  ['surface_contour_l', 'Contour light', 0, 100, 1],
  ['surface_contour_c', 'Contour color', 0, 40, 1],
  ['surface_contour_h', 'Contour hue', 0, 360, 1],
  ['ornament_style', 'Overlay type', 0, 4, 1],
  ['ornament_amount', 'Overlay amount', 0, 100, 1],
  ['ornament_width', 'Stroke width', 0, 100, 1],
  ['ornament_density', 'Stroke coverage', 0, 100, 1],
  ['ornament_phase', 'Graph transform', 0, 100, 1],
  ['ornament_twist', 'Axis swap', 0, 100, 1],
];

// Choreography has no source dropdown and no speed slider: its phase is a
// signal inlet, so the wire into `lighting:phase` (clock — whose rate and
// waveform set speed and shape — an audio feature, or any operator blend) IS
// the source. Cut the wire and the choreography stops.
export const LIGHT_CHOREO_PHASE_INLET = { id: 'phase', label: 'Phase' } as const;

export const LIGHT_CONTROLS: ControlSpec[] = [
  ['light_angle', 'Angle', 0, 360, 1],
  ['light_elevation', 'Elevation', 0, 90, 1],
  ['light_intensity', 'Intensity', 0, 200, 1],
  ['light_warmth', 'Warmth', 0, 100, 1],
  ['light_ambient', 'Ambient', 0, 100, 1],
  ['light_choreo_amount', 'Choreography', 0, 100, 1],
];

export const PROJECTION_CONTROLS: ControlSpec[] = [
  // Signed: 0 = Euclidean (identity), + = Poincaré compression (crowd toward rim),
  // − = inverse/expansion (bulge outward). Default 0 keeps current output.
  ['proj_blend', 'Poincaré ±', -100, 100, 1],
  ['hyp_scale', 'Scale', 0, 100, 1],
  ['hyp_boost_x', 'Boost X', 0, 100, 1],
  ['hyp_boost_y', 'Boost Y', 0, 100, 1],
  ['hyp_fill_subdiv', 'Fill subdiv', 1, 8, 1],
  // #4 iPASS adaptive tessellation: 0 = fixed budget (default), >0 raises fill
  // density where the relief surface curves, screen-error bounded.
  ['adapt_tess', 'Adaptive detail', 0, 100, 1],
];

export const CLOCK_CONTROLS: ControlSpec[] = [
  ['clock_rate', 'Rate', 0, 240, 1],
];

export const RIPPLE_TARGET_CONTROLS: ControlSpec[] = [
  ['field_displace', 'Displace', 0, 100, 1],
  ['field_relief', 'Relief', 0, 100, 1],
  ['field_color', 'Color', 0, 100, 1],
  ['field_undulate', 'Undulate', 0, 100, 1],
  ['field_freq', 'Freq', 0, 100, 1],
  ['field_undulate_freq', 'Undul.freq', 0, 100, 1],
  ['field_speed', 'Speed', 0, 200, 1],
  ['field_pattern', 'Pattern', 0, 7, 1],
];

// The border is a real edge mesh. Width/fill/point/gap/join rebuild that mesh;
// L/C/H/opacity update its material live. `border_on` is the on/off toggle,
// rendered via a segmented control in the node, not a slider.
export const BORDER_CONTROLS: ControlSpec[] = [
  ['border_width', 'Width', 0, 600, 1],
  ['border_l', 'Light', 0, 100, 1],
  ['border_c', 'Chroma', 0, 37, 1],
  ['border_h', 'Hue', 0, 359, 1],
  ['border_a', 'Opacity', 0, 100, 1],
  ['border_fill', 'Fill', 0, 100, 1],
  ['border_point', 'Point', 0, 100, 1],
  ['border_gap', 'Close gap', 0, 100, 1],
  ['edge_profile_width', 'Edge profile', 0, 100, 1],
  ['edge_profile_glow', 'Edge glow', 0, 100, 1],
  ['edge_profile_l', 'Edge light', 0, 100, 1],
  ['edge_profile_c', 'Edge chroma', 0, 37, 1],
  ['edge_profile_h', 'Edge hue', 0, 359, 1],
];
