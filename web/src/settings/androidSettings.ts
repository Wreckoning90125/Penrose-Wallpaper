export type SettingValue = string | number | boolean;
export type Settings = {
  family: SettingValue;
  seed: SettingValue;
  generation: SettingValue;
  preset: SettingValue;
  color_mode: SettingValue;
  color_count: SettingValue;
  color_spread: SettingValue;
  color_spectral: SettingValue;
  border_on: SettingValue;
  border_join: SettingValue;
  border_width: SettingValue;
  border_l: SettingValue;
  border_c: SettingValue;
  border_h: SettingValue;
  border_a: SettingValue;
  border_fill: SettingValue;
  border_point: SettingValue;
  border_gap: SettingValue;
  edge_profile_width: SettingValue;
  edge_profile_glow: SettingValue;
  edge_profile_l: SettingValue;
  edge_profile_c: SettingValue;
  edge_profile_h: SettingValue;
  bg_mode: SettingValue;
  bg_l: SettingValue;
  bg_c: SettingValue;
  bg_h: SettingValue;
  field_relief: SettingValue;
  field_color: SettingValue;
  field_undulate: SettingValue;
  field_freq: SettingValue;
  field_undulate_freq: SettingValue;
  field_speed: SettingValue;
  field_pattern: SettingValue;
  brightness: SettingValue;
  field_displace: SettingValue;
  clock_enabled: SettingValue;
  clock_rate: SettingValue;
  clock_waveform: SettingValue;
  mat_roughness: SettingValue;
  mat_metalness: SettingValue;
  mat_sheen: SettingValue;
  mat_clearcoat: SettingValue;
  mat_anisotropy: SettingValue;
  mat_iridescence: SettingValue;
  mat_emissive: SettingValue;
  mat_relief: SettingValue;
  mat_facet_curve: SettingValue;
  mat_relief_guide: SettingValue;
  mat_ring_relief: SettingValue;
  mat_lattice_spline: SettingValue;
  mat_harnack: SettingValue;
  facet_refine: SettingValue;
  surface_relief_mode: SettingValue;
  surface_contour_amount: SettingValue;
  surface_contour_source: SettingValue;
  surface_contour_spacing: SettingValue;
  surface_contour_width: SettingValue;
  surface_contour_feature: SettingValue;
  surface_stripe: SettingValue;
  surface_contour_phase: SettingValue;
  surface_contour_l: SettingValue;
  surface_contour_c: SettingValue;
  surface_contour_h: SettingValue;
  ornament_style: SettingValue;
  ornament_amount: SettingValue;
  ornament_width: SettingValue;
  ornament_density: SettingValue;
  ornament_phase: SettingValue;
  ornament_twist: SettingValue;
  source_mark_a_l: SettingValue;
  source_mark_a_c: SettingValue;
  source_mark_a_h: SettingValue;
  source_mark_b_l: SettingValue;
  source_mark_b_c: SettingValue;
  source_mark_b_h: SettingValue;
  source_mark_c_l: SettingValue;
  source_mark_c_c: SettingValue;
  source_mark_c_h: SettingValue;
  source_mark_detail: SettingValue;
  light_angle: SettingValue;
  light_elevation: SettingValue;
  light_intensity: SettingValue;
  light_warmth: SettingValue;
  light_ambient: SettingValue;
  light_choreo_amount: SettingValue;
  light_choreo_speed: SettingValue;
  light_choreo_source: SettingValue;
  mat_sheen_color_r: SettingValue;
  mat_sheen_color_g: SettingValue;
  mat_sheen_color_b: SettingValue;
  mat_irid_thick_min: SettingValue;
  mat_irid_thick_max: SettingValue;
  mat_rough_mod: SettingValue;
  mat_metal_mod: SettingValue;
  projection: SettingValue;
  proj_blend: SettingValue;
  poincare_scope: SettingValue;
  hyp_scale: SettingValue;
  hyp_boost_x: SettingValue;
  hyp_boost_y: SettingValue;
  hyp_border_subdiv: SettingValue;
  hyp_fill_subdiv: SettingValue;
  adapt_tess: SettingValue;
};
export type SettingKey = keyof Settings;

export const DEFAULT_SETTINGS: Settings = {
  family: '0',
  seed: '0',
  generation: 4,
  preset: '4',
  color_mode: '0',
  color_count: 8,
  color_spread: 100,
  color_spectral: 0,
  border_on: true,
  border_join: '0',
  border_width: 65,
  border_l: 95,
  border_c: 0,
  border_h: 0,
  border_a: 42,
  border_fill: 0,
  border_point: 0,
  border_gap: 0,
  edge_profile_width: 0,
  edge_profile_glow: 0,
  edge_profile_l: 100,
  edge_profile_c: 0,
  edge_profile_h: 0,
  bg_mode: '1',
  bg_l: 4,
  bg_c: 1,
  bg_h: 280,
  field_relief: 24,
  field_color: 24,
  field_undulate: 24,
  field_freq: 65,
  field_undulate_freq: 25,
  field_speed: 40,
  field_pattern: 0,
  brightness: 100,
  field_displace: 0,
  clock_enabled: '1',
  clock_rate: 100,
  // 0=saw (identity/legacy), 1=sine, 2=triangle, 3=square
  clock_waveform: '0',
  mat_roughness: 38,
  mat_metalness: 35,
  mat_sheen: 12,
  mat_clearcoat: 62,
  mat_anisotropy: 28,
  mat_iridescence: 44,
  mat_emissive: 0,
  mat_relief: 110,
  mat_facet_curve: 0,
  mat_relief_guide: 0,
  mat_ring_relief: 0,
  mat_lattice_spline: 0,
  mat_harnack: 0,
  facet_refine: 0,
  surface_relief_mode: 0,
  surface_contour_amount: 0,
  surface_contour_source: 0,
  surface_contour_spacing: 16,
  surface_contour_width: 18,
  surface_contour_feature: 0,
  surface_stripe: 0,
  surface_contour_phase: 0,
  surface_contour_l: 92,
  surface_contour_c: 6,
  surface_contour_h: 85,
  ornament_style: 0,
  ornament_amount: 0,
  ornament_width: 45,
  ornament_density: 100,
  ornament_phase: 0,
  ornament_twist: 50,
  source_mark_a_l: 62,
  source_mark_a_c: 28,
  source_mark_a_h: 30,
  source_mark_b_l: 58,
  source_mark_b_c: 24,
  source_mark_b_h: 265,
  source_mark_c_l: 72,
  source_mark_c_c: 4,
  source_mark_c_h: 85,
  source_mark_detail: 1,
  light_angle: 315,
  light_elevation: 48,
  light_intensity: 120,
  light_warmth: 54,
  light_ambient: 26,
  light_choreo_amount: 18,
  // Android-only legacy keys: the web choreography is wire-driven (any signal
  // into lighting:phase is the source; the clock's rate/waveform set speed and
  // shape), so the web renderer ignores speed/source.
  light_choreo_speed: 100,
  light_choreo_source: 3,
  mat_sheen_color_r: 255,
  mat_sheen_color_g: 232,
  mat_sheen_color_b: 190,
  mat_irid_thick_min: 120,
  mat_irid_thick_max: 420,
  mat_rough_mod: 20,
  mat_metal_mod: 20,
  projection: '0',
  proj_blend: 0,
  poincare_scope: 0,
  hyp_scale: 50,
  hyp_boost_x: 50,
  hyp_boost_y: 50,
  hyp_border_subdiv: 16,
  hyp_fill_subdiv: 4,
  adapt_tess: 0,
};

export function normalizeSettings(settings: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...settings };
}

export function intSetting(settings: Settings | Partial<Settings>, key: SettingKey, min: number, max: number): number {
  const value = Number.parseInt(String(settings[key] ?? ''), 10);
  const n = Number.isFinite(value) ? value : (DEFAULT_SETTINGS[key] ?? min);
  return Math.max(min, Math.min(max, Number(n)));
}

export function unitSetting(settings: Settings | Partial<Settings>, key: SettingKey): number {
  return intSetting(settings, key, 0, 100) / 100;
}

export function numberSetting(settings: Settings | Partial<Settings>, key: SettingKey, min: number, max: number): number {
  const value = Number.parseFloat(String(settings[key] ?? ''));
  const defaultValue = DEFAULT_SETTINGS[key] ?? min;
  const n = Number.isFinite(value) ? value : Number(defaultValue);
  return Math.max(min, Math.min(max, n));
}

export type MaterialSettings = {
  roughness: number;
  roughMod: number;
  metalness: number;
  metalMod: number;
  clearcoat: number;
  anisotropy: number;
  iridescence: number;
  emissive: number;
  sheen: number;
};

export function materialSettings(settings: Settings | Partial<Settings>): MaterialSettings {
  return {
    roughness: unitSetting(settings, 'mat_roughness'),
    roughMod: unitSetting(settings, 'mat_rough_mod'),
    metalness: unitSetting(settings, 'mat_metalness'),
    metalMod: unitSetting(settings, 'mat_metal_mod'),
    clearcoat: unitSetting(settings, 'mat_clearcoat'),
    anisotropy: unitSetting(settings, 'mat_anisotropy'),
    iridescence: unitSetting(settings, 'mat_iridescence'),
    emissive: unitSetting(settings, 'mat_emissive'),
    sheen: unitSetting(settings, 'mat_sheen'),
  };
}

export type LightSettings = {
  angle: number;
  elevation: number;
  intensity: number;
  ambient: number;
  warmth: number;
  choreoAmount: number;
};

export function lightSettings(settings: Settings | Partial<Settings>): LightSettings {
  const angle = intSetting(settings, 'light_angle', 0, 360) * Math.PI / 180;
  const elevation = intSetting(settings, 'light_elevation', 0, 90) * Math.PI / 180;
  return {
    angle,
    elevation,
    intensity: intSetting(settings, 'light_intensity', 0, 200) / 100,
    ambient: intSetting(settings, 'light_ambient', 0, 100) / 100,
    warmth: intSetting(settings, 'light_warmth', 0, 100) / 100,
    choreoAmount: intSetting(settings, 'light_choreo_amount', 0, 100) / 100,
  };
}
