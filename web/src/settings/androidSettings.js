export const DEFAULT_SETTINGS = {
  family: '0',
  seed: '0',
  generation: 7,
  preset: '4',
  color_mode: '0',
  color_count: 8,
  border_on: true,
  border_width: 65,
  border_a: 42,
  bg_mode: '0',
  bg_l: 4,
  bg_c: 1,
  bg_h: 280,
  ripple_amount: 24,
  ripple_speed: 40,
  ripple_kind: '2',
  brightness: 100,
  depth_amount: 42,
  mat_roughness: 38,
  mat_metalness: 35,
  mat_sheen: 12,
  mat_clearcoat: 62,
  mat_anisotropy: 28,
  mat_iridescence: 44,
  mat_emissive: 0,
  mat_relief: 110,
  light_angle: 315,
  light_elevation: 48,
  light_intensity: 120,
  light_warmth: 54,
  light_ambient: 26,
  mat_sheen_color_r: 255,
  mat_sheen_color_g: 232,
  mat_sheen_color_b: 190,
  mat_irid_thick_min: 120,
  mat_irid_thick_max: 420,
  mat_rough_mod: 20,
  mat_metal_mod: 20,
  projection: '0',
  hyp_scale: 50,
  hyp_boost_x: 50,
  hyp_boost_y: 50,
  hyp_border_subdiv: 1,
  hyp_fill_subdiv: 1,
};

export function normalizeSettings(settings) {
  return { ...DEFAULT_SETTINGS, ...settings };
}

export function intSetting(settings, key, min, max) {
  const value = Number.parseInt(settings[key], 10);
  const n = Number.isFinite(value) ? value : (DEFAULT_SETTINGS[key] ?? min);
  return Math.max(min, Math.min(max, Number(n)));
}

export function unitSetting(settings, key) {
  return intSetting(settings, key, 0, 100) / 100;
}

export function materialSettings(settings) {
  return {
    relief: intSetting(settings, 'mat_relief', 0, 160) / 100,
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

export function lightSettings(settings) {
  const angle = intSetting(settings, 'light_angle', 0, 360) * Math.PI / 180;
  const elevation = intSetting(settings, 'light_elevation', 0, 90) * Math.PI / 180;
  return {
    angle,
    elevation,
    intensity: intSetting(settings, 'light_intensity', 0, 200) / 100,
    ambient: intSetting(settings, 'light_ambient', 0, 100) / 100,
    warmth: intSetting(settings, 'light_warmth', 0, 100) / 100,
  };
}
