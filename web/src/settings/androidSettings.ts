export type SettingValue = string | number | boolean;
export type Settings = {
  family: SettingValue;
  seed: SettingValue;
  generation: SettingValue;
  preset: SettingValue;
  color_mode: SettingValue;
  color_count: SettingValue;
  border_on: SettingValue;
  border_width: SettingValue;
  border_l: SettingValue;
  border_c: SettingValue;
  border_h: SettingValue;
  border_a: SettingValue;
  bg_mode: SettingValue;
  bg_l: SettingValue;
  bg_c: SettingValue;
  bg_h: SettingValue;
  ripple_amount: SettingValue;
  ripple_speed: SettingValue;
  ripple_kind: SettingValue;
  brightness: SettingValue;
  depth_amount: SettingValue;
  clock_enabled: SettingValue;
  clock_rate: SettingValue;
  mat_roughness: SettingValue;
  mat_metalness: SettingValue;
  mat_sheen: SettingValue;
  mat_clearcoat: SettingValue;
  mat_anisotropy: SettingValue;
  mat_iridescence: SettingValue;
  mat_emissive: SettingValue;
  mat_relief: SettingValue;
  light_angle: SettingValue;
  light_elevation: SettingValue;
  light_intensity: SettingValue;
  light_warmth: SettingValue;
  light_ambient: SettingValue;
  mat_sheen_color_r: SettingValue;
  mat_sheen_color_g: SettingValue;
  mat_sheen_color_b: SettingValue;
  mat_irid_thick_min: SettingValue;
  mat_irid_thick_max: SettingValue;
  mat_rough_mod: SettingValue;
  mat_metal_mod: SettingValue;
  projection: SettingValue;
  hyp_scale: SettingValue;
  hyp_boost_x: SettingValue;
  hyp_boost_y: SettingValue;
  hyp_border_subdiv: SettingValue;
  hyp_fill_subdiv: SettingValue;
};
export type SettingKey = keyof Settings;

export const DEFAULT_SETTINGS: Settings = {
  family: '0',
  seed: '0',
  generation: 4,
  preset: '4',
  color_mode: '0',
  color_count: 8,
  border_on: true,
  border_width: 65,
  border_l: 95,
  border_c: 0,
  border_h: 0,
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
  clock_enabled: '1',
  clock_rate: 100,
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
  hyp_border_subdiv: 16,
  hyp_fill_subdiv: 4,
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
  relief: number;
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

export type LightSettings = {
  angle: number;
  elevation: number;
  intensity: number;
  ambient: number;
  warmth: number;
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
  };
}
