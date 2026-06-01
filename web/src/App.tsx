import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';
import type { BufferGeometry } from 'three/webgpu';
import { loadAtlasManifest, firstTarget, targetSettings } from './atlas/loadAtlas';
import { familyByValue, maxGenerationForFamily, seedLabel, seedOptionsForFamily } from './tiling/families';
import { buildPalette, CUSTOM_PALETTE_PRESET, displayGamutLabel, MAX_COLORS, MAX_PALETTE_PRESET, type Oklch, type Palette } from './color/palette';
import {
  DEFAULT_SETTINGS,
  intSetting,
  normalizeSettings,
  type SettingKey,
  type SettingValue,
  type Settings,
} from './settings/androidSettings';
import { useWebAudioGraph } from './audio/useWebAudioGraph';
import { ControlGraph } from './flow/ControlGraph';
import { clampNumber } from './util/clamp';
import type { AtlasCategory, AtlasItem, AtlasManifest, BoostPosition, DragMode, FieldSlot, Gains, GraphPresetAppState, LiveBoostStore, Patch, PostChainSpec, RenderInputs } from './types';
import type { WallpaperRenderer } from './render/webgpuRenderer';

const CURRENT_CONTROLS = '__current_controls__';
// Settings that change the baked fill mesh (vertices + the per-vertex
// paletteSlot index), so changing one must rebuild the surface mesh. NOT included:
// `preset`/`customColors` — those change only the colour *values* per slot, which
// `applyPaletteColors` re-bakes live into the `color` attribute without a rebuild.
// Adding `preset` here would reintroduce a full mesh rebuild on every palette
// change (and the Poincaré flatten/re-ball flicker that came with it).
const FILL_GEOMETRY_SETTINGS: SettingKey[] = [
  'color_count',
  'color_mode',
  'hyp_fill_subdiv',
  'projection',
];
const HYPERBOLIC_FILL_GEOMETRY_SETTINGS: SettingKey[] = [...FILL_GEOMETRY_SETTINGS, 'hyp_scale'];

// Settings that reshape only the border mesh. Keeping these separate avoids
// re-uploading the full surface mesh while dragging Close gap/Fill/Point/Width.
const BORDER_GEOMETRY_SETTINGS: SettingKey[] = [
  'border_fill',
  'border_gap',
  'border_join',
  'border_on',
  'border_point',
  'border_width',
  'hyp_border_subdiv',
];
type PreviewGeometryMode = 'fill' | 'border';

// How many gradient stops the applied palette uses. `color_spread` overrides the
// stop-count independently of how many tile buckets exist (`color_count`); 0 means
// "follow Slots" so the historical look is unchanged. Re-baked live by
// applyPaletteColors / buildMeshGeometry — no geometry rebuild for spread alone.
function appliedColorStops(settings: Settings | Partial<Settings>): number {
  const spread = intSetting(settings, 'color_spread', 0, MAX_COLORS);
  return spread > 0 ? spread : intSetting(settings, 'color_count', 2, MAX_COLORS);
}
const APP_AUDIO_SETTING_KEYS: readonly SettingKey[] = [
  'generation',
  'color_count',
  'color_spread',
  'hyp_fill_subdiv',
  'hyp_border_subdiv',
  'border_fill',
  'border_point',
  'border_gap',
  'border_width',
];

type SettingsMutator = (current: Settings) => Settings;
type AppAudioSettingBases = Partial<Record<SettingKey, number>>;
type LuminanceModulationBase = { index: number; value: number };

function errorMessage(error: Error | string): string {
  return error instanceof Error ? error.stack ?? error.message : error;
}

function clampGeneration(settings: Settings): Settings {
  const family = String(settings.family ?? DEFAULT_SETTINGS.family);
  const maxGeneration = maxGenerationForFamily(family);
  return {
    ...settings,
    generation: Math.min(Number(settings.generation ?? 0), maxGeneration),
  };
}

function atlasItemById(
  manifest: AtlasManifest | null,
  categoryId: string,
  itemId: string,
): { category: AtlasCategory | null; item: AtlasItem | null } {
  const category = manifest?.categories?.find(item => item.id === categoryId);
  const item = category?.items?.find(target => target.id === itemId);
  return { category: category ?? null, item: item ?? null };
}

function settingsKey(settings: Settings, keys: SettingKey[]): string {
  return keys.map(key => `${key}:${String(settings[key] ?? '')}`).join('|');
}

function fillGeometryKey(settings: Settings): string {
  const keys = String(settings.projection) === '1' ? HYPERBOLIC_FILL_GEOMETRY_SETTINGS : FILL_GEOMETRY_SETTINGS;
  return settingsKey(settings, keys);
}

function borderGeometryKey(settings: Settings): string {
  return settingsKey(settings, BORDER_GEOMETRY_SETTINGS);
}

function previewGeometryModeForSetting(key: SettingKey, settings: Settings): PreviewGeometryMode | null {
  if (key === 'hyp_scale') return String(settings.projection) === '1' ? 'fill' : null;
  if (FILL_GEOMETRY_SETTINGS.includes(key) || key === 'hyp_fill_subdiv') return 'fill';
  if (BORDER_GEOMETRY_SETTINGS.includes(key)) return 'border';
  return null;
}

function copyOklch(color: Oklch): Oklch {
  return [color[0], color[1], color[2]];
}


function finiteModulation(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function editIsHeld(
  dragMode: DragMode,
  heldParams: Record<string, boolean | undefined>,
  keys: readonly string[],
): boolean {
  return dragMode === 'hold' && keys.some(key => heldParams[key] === true);
}

function heldSettingKeys(preview: Settings | null, heldParams: Record<string, boolean | undefined>): SettingKey[] {
  if (!preview) return [];
  return Object.keys(heldParams).filter((key): key is SettingKey => (
    heldParams[key] === true && Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)
  ));
}

function settingsWithHeldPreview(
  base: Settings,
  preview: Settings | null,
  heldParams: Record<string, boolean | undefined>,
): Settings {
  const keys = heldSettingKeys(preview, heldParams);
  if (!preview || keys.length === 0) return base;
  const effective = { ...base };
  for (const key of keys) effective[key] = preview[key];
  return effective;
}

function settingsWithLiveBoost(settings: Settings, boost: BoostPosition | null): Settings {
  return boost
    ? { ...settings, projection: '1', hyp_boost_x: boost.x, hyp_boost_y: boost.y }
    : settings;
}

function effectiveRenderSettings(
  base: Settings,
  preview: Settings | null,
  heldParams: Record<string, boolean | undefined>,
  boost: BoostPosition | null,
): Settings {
  return settingsWithLiveBoost(settingsWithHeldPreview(base, preview, heldParams), boost);
}

function paletteForSettings(settings: Settings, customColors: Oklch[] | null): Palette {
  return buildPalette(
    intSetting(settings, 'preset', 0, MAX_PALETTE_PRESET),
    appliedColorStops(settings),
    customColors,
  );
}

function sameAppAudioSettings(a: Partial<Settings>, b: Partial<Settings>): boolean {
  return APP_AUDIO_SETTING_KEYS.every(key => a[key] === b[key]);
}

function paletteWithLuminance(palette: Palette, index: number, luminance: number): Palette {
  return {
    ...palette,
    colors: palette.colors.map((color, idx): Oklch => (
      idx === index ? [luminance, color[1], color[2]] : copyOklch(color)
    )),
  };
}

function createLiveBoostStore(): LiveBoostStore {
  let snapshot: BoostPosition | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    set: (value: BoostPosition | null) => {
      if (snapshot?.x === value?.x && snapshot?.y === value?.y) return;
      snapshot = value;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function App() {
  const viewportRef = useRef<HTMLElement | null>(null);
  const controlsRef = useRef<HTMLElement | null>(null);
  const rendererRef = useRef<WallpaperRenderer | null>(null);
  const boostFrameRef = useRef(0);
  const boostRef = useRef<BoostPosition | null>(null);
  const liveBoostStoreRef = useRef<LiveBoostStore | null>(null);
  const heldParamsRef = useRef<Record<string, boolean | undefined>>({});
  const previewSettingsRef = useRef<Settings | null>(null);
  const audioModulationsRef = useRef<Record<string, number | undefined>>({});
  const postChainRef = useRef<PostChainSpec>([]);
  const fieldPhaseRef = useRef(0);
  const fieldSlotsRef = useRef<FieldSlot[]>([]);
  const renderInputsRef = useRef<RenderInputs>({
    geometry: true,
    lighting: true,
    color: true,
    material: true,
    materialColor: true,
    materialRelief: true,
    projection: true,
    fieldDisplace: true,
    fieldRelief: true,
    fieldColor: true,
    fieldUndulate: true,
    fieldPhase: true,
    border: true,
  });
  const applyAudioDriveRef = useRef<() => void>(() => undefined);
  const schedulePreviewGeometryRef = useRef<(mode: PreviewGeometryMode) => void>(() => undefined);
  const appModulationFrameRef = useRef(0);
  // Live "Slots"/"Color mode" preview re-quantizes the tile→bucket assignment,
  // which lives in the baked paletteSlot attribute — so the slider drag must
  // rebuild the mesh, not just recolor it. These refs let the dependency-free
  // previewSetting reach the (lazily imported) geometry builder + current patch.
  const buildMeshGeometryRef = useRef<typeof import('./tiling/geometry').buildMeshGeometry | null>(null);
  const buildEdgeGeometryRef = useRef<typeof import('./tiling/geometry').buildEdgeGeometryForPatch | null>(null);
  const patchRef = useRef<Patch | null>(null);
  const framedPatchRef = useRef<Patch | null>(null);
  const previewGeometryFrameRef = useRef(0);
  const previewGeometryModeRef = useRef<PreviewGeometryMode>('border');
  const appAudioSettingBasesRef = useRef<AppAudioSettingBases>({});
  const luminanceModBaseRef = useRef<LuminanceModulationBase | null>(null);
  const luminanceModActiveRef = useRef(false);
  const gainsRef = useRef<Gains>({ relief: 0.28, emissive: 0.55, film: 0.36, metal: 0.18 });
  const dragModeRef = useRef<DragMode>('ride');
  if (!liveBoostStoreRef.current) liveBoostStoreRef.current = createLiveBoostStore();
  const liveBoostStore = liveBoostStoreRef.current;
  const [manifest, setManifest] = useState<AtlasManifest | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [targetId, setTargetId] = useState(CURRENT_CONTROLS);
  const [settings, setSettings] = useState(() => normalizeSettings(DEFAULT_SETTINGS));
  const [appAudioSettings, setAppAudioSettings] = useState<Partial<Settings>>({});
  const [patch, setPatch] = useState<Patch | null>(null);
  const [customColors, setCustomColors] = useState<Oklch[] | null>(null);
  const customColorsRef = useRef<Oklch[] | null>(null);
  const [selectedColor, setSelectedColor] = useState(0);
  const [rendererReady, setRendererReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [drawerWidth, setDrawerWidth] = useState(() => Math.min(780, Math.max(560, window.innerWidth * 0.48)));
  const [loading, setLoading] = useState('Loading atlas');
  const [error, setError] = useState('');
  const [gains, setGains] = useState({ relief: 0.28, emissive: 0.55, film: 0.36, metal: 0.18 });
  const [dragMode, setDragMode] = useState<DragMode>('ride');
  const settingsRef = useRef(settings);
  const selectedColorRef = useRef(selectedColor);
  const audio = useWebAudioGraph();

  const activeCategory = useMemo(() => (
    manifest?.categories?.find(category => category.id === categoryId) ?? manifest?.categories?.[0] ?? null
  ), [categoryId, manifest]);

  const activeItem = useMemo(() => {
    if (!activeCategory || targetId === CURRENT_CONTROLS) return null;
    return activeCategory.items.find(item => item.id === targetId) ?? null;
  }, [activeCategory, targetId]);

  const family = familyByValue(settings.family);
  const seedOptions = seedOptionsForFamily(settings.family);
  const maxGeneration = maxGenerationForFamily(settings.family);
  const colorCount = intSetting(settings, 'color_count', 2, MAX_COLORS);
  const palettePreset = intSetting(settings, 'preset', 0, MAX_PALETTE_PRESET);
  // Slots (color_count) quantizes tiles into buckets; Spread (color_spread) sets
  // the palette gradient's stop-count independently. 0 = follow Slots, so the
  // default look is unchanged. See appliedColorStops.
  const appliedStops = appliedColorStops(settings);
  const palette = useMemo(() => (
    buildPalette(palettePreset, appliedStops, customColors)
  ), [appliedStops, customColors, palettePreset]);
  const renderSettings = useMemo(() => (
    clampGeneration(normalizeSettings({ ...settings, ...appAudioSettings }))
  ), [appAudioSettings, settings]);
  const renderColorCount = intSetting(renderSettings, 'color_count', 2, MAX_COLORS);
  const renderPalettePreset = intSetting(renderSettings, 'preset', 0, MAX_PALETTE_PRESET);
  const renderAppliedStops = appliedColorStops(renderSettings);
  const renderPalette = useMemo(() => (
    buildPalette(renderPalettePreset, renderAppliedStops, customColors)
  ), [customColors, renderAppliedStops, renderPalettePreset]);
  const renderColorCountRef = useRef(renderColorCount);
  const renderPaletteRef = useRef(renderPalette);
  // Lets previewSetting read the live palette without a dependency on it, so
  // previewSetting stays referentially stable across color/setting changes. If
  // it weren't stable, the control-graph's baseNodes (which embeds it) would
  // recompute every color-wheel move and the graph would rebuild/flash.
  const paletteRef = useRef(palette);
  // Lets the geometry-rebuild effects read the latest settings without depending on
  // renderSettings directly — so they rebuild only when the relevant geometry key
  // changes, not on every param.
  const renderSettingsRef = useRef(renderSettings);
  const fillGeometrySettingsKey = useMemo(() => fillGeometryKey(renderSettings), [renderSettings]);
  const borderGeometrySettingsKey = useMemo(() => borderGeometryKey(renderSettings), [renderSettings]);
  const appliedBorderGeometryRef = useRef<{ key: string; patch: Patch } | null>(null);
  const selectedColorValue: Oklch =
    palette.colors[Math.min(selectedColor, colorCount - 1)] ?? palette.colors[0] ?? [0.78, 0.13, 80];
  const drawerStyle: CSSProperties & Record<'--drawer-width', string> = {
    '--drawer-width': `${drawerWidth}px`,
  };

  const updateSettings = useCallback((mutator: SettingsMutator) => {
    setTargetId(CURRENT_CONTROLS);
    setSettings(current => clampGeneration(normalizeSettings(mutator({ ...current }))));
  }, []);

  const setSetting = useCallback((key: SettingKey, value: SettingValue) => {
    updateSettings(current => {
      current[key] = value;
      return current;
    });
  }, [updateSettings]);

  // Reads everything from refs so it is referentially STABLE (empty deps). It is
  // embedded in the control-graph baseNodes; an unstable previewSetting made
  // baseNodes recompute on every color-wheel move, which rebuilt the whole graph
  // and blacked it out. Keep it dependency-free.
  const previewSetting = useCallback((key: SettingKey, value: SettingValue) => {
    const next = {
      ...(previewSettingsRef.current ?? settingsRef.current),
      [key]: value,
    };
    previewSettingsRef.current = next;
    // Geometry-shape settings change the baked mesh (Slots/Color mode re-quantize the
    // paletteSlot attribute; Border width/Fill/Point and the subdivisions reshape the
    // mesh), so the live preview must REBUILD — debounced — not merely set uniforms.
    // This makes the drag update continuously (honoring ride/hold) instead of
    // deferring to commit. Border colour/opacity (l/c/h/a) are runtime uniforms,
    // handled by setSettings below.
    const geometryMode = previewGeometryModeForSetting(key, next);
    if (geometryMode) {
      schedulePreviewGeometryRef.current(geometryMode);
      return;
    }
    // Spread (and preset) only change colour *values* per bucket — recolour live
    // with the spread-aware applied palette, no rebuild. Default spread 0 = follow
    // Slots, so nothing changes versus the historical look.
    const nextPalette = key === 'preset' || key === 'color_spread'
      ? paletteForSettings(next, customColorsRef.current)
      : paletteRef.current;
    rendererRef.current?.setSettings(next, nextPalette);
    // setSettings renders the un-modulated baseline; re-apply the current audio
    // modulation in the same tick so the preview render already includes it.
    // Without this, every slider move (and the release frame) flashes one
    // un-modulated frame before the audio loop re-mods — the ride/hold jitter.
    applyAudioDriveRef.current();
  }, []);

  // Rebuild the mesh from the live preview settings, coalesced to one rebuild per
  // frame, so dragging Slots / Color mode re-quantizes the tiles live. Uses the
  // lazily-imported builder cached by the geometry effect; before that first import
  // resolves there is nothing on screen to re-quantize, so it simply no-ops.
  const schedulePreviewGeometry = useCallback((mode: PreviewGeometryMode) => {
    if (mode === 'fill') previewGeometryModeRef.current = 'fill';
    if (previewGeometryFrameRef.current) return;
    previewGeometryModeRef.current = mode;
    previewGeometryFrameRef.current = requestAnimationFrame(() => {
      previewGeometryFrameRef.current = 0;
      const scheduledMode = previewGeometryModeRef.current;
      previewGeometryModeRef.current = 'border';
      try {
        const buildMesh = buildMeshGeometryRef.current;
        const buildEdge = buildEdgeGeometryRef.current;
        const currentPatch = patchRef.current;
        const renderer = rendererRef.current;
        if (!currentPatch || !renderer) return;
        const current = effectiveRenderSettings(
          previewSettingsRef.current ?? settingsRef.current,
          previewSettingsRef.current,
          heldParamsRef.current,
          boostRef.current ?? liveBoostStore.getSnapshot(),
        );
        if (scheduledMode === 'border') {
          if (!buildEdge) return;
          renderer.setSettings(current, paletteForSettings(current, customColorsRef.current));
          renderer.setEdgeGeometry(buildEdge(currentPatch, current));
          appliedBorderGeometryRef.current = { key: borderGeometryKey(current), patch: currentPatch };
        } else {
          if (!buildMesh) return;
          const { geometry, edgeGeometry, palette: builtPalette } = buildMesh(currentPatch, current, customColorsRef.current);
          renderer.setSettings(current, builtPalette);
          renderer.setGeometry(geometry, edgeGeometry, { frame: false, warmup: false });
          appliedBorderGeometryRef.current = { key: borderGeometryKey(current), patch: currentPatch };
        }
        applyAudioDriveRef.current();
      } catch (caught) {
        setError(caught instanceof Error ? errorMessage(caught) : String(caught));
      }
    });
  }, []);

  useEffect(() => {
    schedulePreviewGeometryRef.current = schedulePreviewGeometry;
  }, [schedulePreviewGeometry]);

  const beginEdit = useCallback((paramKey: string) => {
    heldParamsRef.current[paramKey] = true;
  }, []);

  const endEdit = useCallback((paramKey: string) => {
    delete heldParamsRef.current[paramKey];
  }, []);

  useEffect(() => {
    previewSettingsRef.current = settings;
    settingsRef.current = settings;
    appAudioSettingBasesRef.current = {};
  }, [settings]);

  useEffect(() => {
    customColorsRef.current = customColors;
  }, [customColors]);

  useEffect(() => {
    patchRef.current = patch;
  }, [patch]);

  useEffect(() => {
    selectedColorRef.current = selectedColor;
  }, [selectedColor]);

  useEffect(() => {
    renderColorCountRef.current = renderColorCount;
  }, [renderColorCount]);

  useEffect(() => {
    paletteRef.current = palette;
  }, [palette]);

  useEffect(() => {
    renderPaletteRef.current = renderPalette;
  }, [renderPalette]);

  useEffect(() => {
    renderSettingsRef.current = renderSettings;
  }, [renderSettings]);

  useEffect(() => {
    gainsRef.current = gains;
  }, [gains]);

  useEffect(() => {
    dragModeRef.current = dragMode;
  }, [dragMode]);

  const applyAudioDrive = useCallback(() => {
    rendererRef.current?.setAudioDrive({
      dragMode: dragModeRef.current,
      heldParams: heldParamsRef.current,
    }, audioModulationsRef.current);
  }, [audio]);

  useEffect(() => {
    applyAudioDriveRef.current = applyAudioDrive;
  }, [applyAudioDrive]);

  const applyAppAudioModulations = useCallback(() => {
    const modulations = audioModulationsRef.current;
    const heldParams = heldParamsRef.current;
    const dragMode = dragModeRef.current;
    const baselineSettings = previewSettingsRef.current ?? settingsRef.current;
    const persistentSettings = settingsRef.current;
    const bases = appAudioSettingBasesRef.current;
    const nextAudioSettings: Partial<Settings> = {};

    const applyIntegerTarget = (key: SettingKey, min: number, max: number): void => {
      const signal = finiteModulation(modulations[key]);
      const editing = heldParams[key] === true;
      if (signal === null || editIsHeld(dragMode, heldParams, [key])) {
        delete bases[key];
        return;
      }
      const currentBaseline = intSetting(baselineSettings, key, min, max);
      if (dragMode === 'ride' && editing) bases[key] = currentBaseline;
      const base = bases[key] ?? currentBaseline;
      bases[key] = base;
      const persistentValue = intSetting(persistentSettings, key, min, max);
      const nextValue = Math.round(clampNumber(base + signal * (max - min), min, max));
      if (nextValue !== persistentValue) nextAudioSettings[key] = nextValue;
    };

    const generationMax = maxGenerationForFamily(String(baselineSettings.family ?? DEFAULT_SETTINGS.family));
    applyIntegerTarget('generation', 0, generationMax);
    applyIntegerTarget('color_count', 2, MAX_COLORS);
    // Spread modulates the palette gradient only (not in GEOMETRY_SETTINGS), so it
    // recolours live through the uniform-apply effect — no per-frame mesh rebuild,
    // unlike color_count above.
    applyIntegerTarget('color_spread', 0, MAX_COLORS);
    applyIntegerTarget('hyp_fill_subdiv', 1, 8);
    applyIntegerTarget('hyp_border_subdiv', 1, 32);
    applyIntegerTarget('border_width', 0, 600);
    applyIntegerTarget('border_fill', 0, 100);
    applyIntegerTarget('border_point', 0, 100);
    applyIntegerTarget('border_gap', 0, 100);

    setAppAudioSettings(current => (
      sameAppAudioSettings(current, nextAudioSettings) ? current : nextAudioSettings
    ));

    const selectedIndex = Math.max(0, Math.min(selectedColorRef.current, renderColorCountRef.current - 1));
    const luminanceKey = `custom_color_${selectedIndex}_luminance`;
    const luminanceSignal = finiteModulation(modulations['luminance']);
    const luminanceHeld = editIsHeld(dragMode, heldParams, ['luminance', luminanceKey]);
    const renderer = rendererRef.current;
    if (luminanceSignal === null || luminanceHeld || !renderer) {
      luminanceModBaseRef.current = null;
      if (luminanceModActiveRef.current && renderer) {
        renderer.applyPaletteColors(renderPaletteRef.current);
        renderer.render();
      }
      luminanceModActiveRef.current = false;
      return;
    }

    const basePalette = renderPaletteRef.current;
    const sourceColor = basePalette.colors[selectedIndex] ?? basePalette.colors[0] ?? [0.78, 0.13, 80];
    const editingLuminance = heldParams[luminanceKey] === true || heldParams['luminance'] === true;
    if (
      !luminanceModBaseRef.current
      || luminanceModBaseRef.current.index !== selectedIndex
      || (dragMode === 'ride' && editingLuminance)
    ) {
      luminanceModBaseRef.current = { index: selectedIndex, value: sourceColor[0] };
    }
    const base = luminanceModBaseRef.current;
    const nextLuminance = clampNumber(base.value + luminanceSignal, 0, 1);
    renderer.applyPaletteColors(paletteWithLuminance(basePalette, selectedIndex, nextLuminance));
    renderer.render();
    luminanceModActiveRef.current = true;
  }, []);

  const scheduleAppAudioModulations = useCallback(() => {
    if (appModulationFrameRef.current) return;
    appModulationFrameRef.current = requestAnimationFrame(() => {
      appModulationFrameRef.current = 0;
      applyAppAudioModulations();
    });
  }, [applyAppAudioModulations]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        const nextManifest = await loadAtlasManifest();
        if (cancelled) return;
        setManifest(nextManifest);
        const first = firstTarget(nextManifest);
        setCategoryId(first.category.id);
        setTargetId(first.item.id);
        setSettings(targetSettings(first.item));
        setLoading('');
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? errorMessage(caught) : String(caught));
      }
    }
    void boot();
    return () => {
      cancelled = true;
      if (boostFrameRef.current) cancelAnimationFrame(boostFrameRef.current);
      if (appModulationFrameRef.current) cancelAnimationFrame(appModulationFrameRef.current);
      if (previewGeometryFrameRef.current) cancelAnimationFrame(previewGeometryFrameRef.current);
    };
  }, []);

  useEffect(() => {
    if (!viewportRef.current || rendererRef.current) return;
    let cancelled = false;
    async function initRenderer() {
      try {
        const { WallpaperRenderer } = await import('./render/webgpuRenderer');
        if (cancelled || !viewportRef.current) return;
        const renderer = new WallpaperRenderer(viewportRef.current);
        rendererRef.current = renderer;
        renderer.onDeviceLost = (message) => {
          if (!cancelled) setError(`WebGPU device lost: ${message}. Reload the page — this should not happen, so investigate the cause rather than masking it.`);
        };
        await renderer.init();
        if (cancelled) return;
        renderer.setPostChain(postChainRef.current);
        renderer.setRenderInputs(renderInputsRef.current);
        renderer.setFieldPhase(fieldPhaseRef.current);
        renderer.setFieldSlots(fieldSlotsRef.current);
        setRendererReady(true);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? errorMessage(caught) : String(caught));
      }
    }
    void initRenderer();
    return () => {
      // The creation effect owns the renderer's disposal, so a teardown (incl.
      // StrictMode's dev mount→unmount→remount) releases the WebGPU instance
      // before a new one is created — no orphaned/double instance.
      cancelled = true;
      rendererRef.current?.dispose();
      rendererRef.current = null;
      setRendererReady(false);
    };
  }, []);

  useEffect(() => {
    if (!manifest) return;
    let cancelled = false;
    setLoading('Generating geometry');
    async function loadPatch() {
      try {
        const { loadPatchForSettings } = await import('./tiling/geometry');
        const nextPatch = await loadPatchForSettings(renderSettings, activeItem);
        if (cancelled) return;
        setPatch(nextPatch);
        setLoading('');
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? errorMessage(caught) : String(caught));
      }
    }
    void loadPatch();
    return () => {
      cancelled = true;
    };
  }, [activeItem, manifest, renderSettings.family, renderSettings.generation, renderSettings.seed]);

  useEffect(() => {
    if (!patch || !rendererReady || !rendererRef.current) return;
    const currentPatch = patch;
    let cancelled = false;
    let activeGeometry: BufferGeometry | null = null;
    let activeEdgeGeometry: BufferGeometry | null = null;
    async function buildGeometry() {
      const { buildEdgeGeometryForPatch, buildMeshGeometry } = await import('./tiling/geometry');
      buildMeshGeometryRef.current = buildMeshGeometry;
      buildEdgeGeometryRef.current = buildEdgeGeometryForPatch;
      if (cancelled || !rendererRef.current) return;
      // Read the latest settings from a ref: this effect intentionally re-runs only
      // when the fill/topology key changes or the patch does — NOT on border-only
      // geometry changes. Border shape gets its own edgeMesh-only effect below.
      // Geometry rebuilds are allowed to be triggered by audio-driven geometry
      // params, but they must not stomp an active slider hold or a live Poincare
      // boost preview with the committed baseline.
      const current = effectiveRenderSettings(
        renderSettingsRef.current,
        previewSettingsRef.current,
        heldParamsRef.current,
        boostRef.current ?? liveBoostStore.getSnapshot(),
      );
      const { geometry, edgeGeometry, palette: builtPalette } = buildMeshGeometry(currentPatch, current, customColorsRef.current);
      const shouldFrame = framedPatchRef.current !== currentPatch;
      activeGeometry = geometry;
      activeEdgeGeometry = edgeGeometry;
      rendererRef.current.setSettings(current, builtPalette);
      rendererRef.current.setGeometry(geometry, edgeGeometry, { frame: shouldFrame, warmup: shouldFrame });
      framedPatchRef.current = currentPatch;
      appliedBorderGeometryRef.current = { key: borderGeometryKey(current), patch: currentPatch };
      activeGeometry = null;
      activeEdgeGeometry = null;
    }
    void buildGeometry().catch(caught => {
      if (!cancelled) setError(caught instanceof Error ? errorMessage(caught) : String(caught));
    });
    return () => {
      cancelled = true;
      activeGeometry?.dispose();
      activeEdgeGeometry?.dispose();
    };
  }, [fillGeometrySettingsKey, patch, rendererReady]);

  useEffect(() => {
    if (!patch || !rendererReady || !rendererRef.current) return;
    const currentPatch = patch;
    const applied = appliedBorderGeometryRef.current;
    if (applied?.patch === currentPatch && applied.key === borderGeometrySettingsKey) return;
    let cancelled = false;
    let activeEdgeGeometry: BufferGeometry | null = null;
    async function buildBorderGeometry() {
      const { buildEdgeGeometryForPatch } = await import('./tiling/geometry');
      buildEdgeGeometryRef.current = buildEdgeGeometryForPatch;
      if (cancelled || !rendererRef.current) return;
      const current = effectiveRenderSettings(
        renderSettingsRef.current,
        previewSettingsRef.current,
        heldParamsRef.current,
        boostRef.current ?? liveBoostStore.getSnapshot(),
      );
      activeEdgeGeometry = buildEdgeGeometryForPatch(currentPatch, current);
      rendererRef.current.setSettings(current, paletteForSettings(current, customColorsRef.current));
      rendererRef.current.setEdgeGeometry(activeEdgeGeometry);
      appliedBorderGeometryRef.current = { key: borderGeometrySettingsKey, patch: currentPatch };
      activeEdgeGeometry = null;
      applyAudioDriveRef.current();
    }
    void buildBorderGeometry().catch(caught => {
      if (!cancelled) setError(caught instanceof Error ? errorMessage(caught) : String(caught));
    });
    return () => {
      cancelled = true;
      activeEdgeGeometry?.dispose();
    };
  }, [borderGeometrySettingsKey, patch, rendererReady]);

  useEffect(() => {
    if (!rendererReady || !rendererRef.current) return;
    // This committed-state apply re-fires every frame the audio/clock loop changes
    // renderSettings. For a param the user is actively dragging (held), that would
    // clobber its live preview with the not-yet-committed baseline — the slider
    // snaps back when you pause the drag, and geometry params (scale/boost) jump.
    // So keep held params at their live preview value here; previewSetting drives
    // them, commit lands on release.
    const effective = effectiveRenderSettings(
      renderSettings,
      previewSettingsRef.current,
      heldParamsRef.current,
      boostRef.current ?? liveBoostStore.getSnapshot(),
    );
    const effectivePalette = effective === renderSettings ? renderPalette : paletteForSettings(effective, customColorsRef.current);
    rendererRef.current.setSettings(effective, effectivePalette);
  }, [liveBoostStore, renderPalette, renderSettings, rendererReady]);

  useEffect(() => {
    applyAudioDrive();
    return audio.subscribe(applyAudioDrive);
  }, [applyAudioDrive, audio]);

  useEffect(() => {
    applyAudioDrive();
  }, [applyAudioDrive, dragMode, gains, renderSettings]);

  useEffect(() => {
    rendererRef.current?.setProjectionGesture({
      settings,
      onBoostPreview: (x: number, y: number) => {
        boostRef.current = { x, y };
        if (boostFrameRef.current) return;
        boostFrameRef.current = requestAnimationFrame(() => {
          boostFrameRef.current = 0;
          const next = boostRef.current;
          if (!next) return;
          const previous = liveBoostStore.getSnapshot() ?? {
            x: Number(settings.hyp_boost_x ?? 50),
            y: Number(settings.hyp_boost_y ?? 50),
          };
          if (Math.abs(previous.x - next.x) < 0.2 && Math.abs(previous.y - next.y) < 0.2) return;
          liveBoostStore.set(next);
        });
      },
      onBoostCommit: (x: number, y: number) => {
        if (boostFrameRef.current) {
          cancelAnimationFrame(boostFrameRef.current);
          boostFrameRef.current = 0;
        }
        boostRef.current = null;
        liveBoostStore.set(null);
        updateSettings(current => {
          current.projection = '1';
          current.hyp_boost_x = x;
          current.hyp_boost_y = y;
          return current;
        });
      },
    });
  }, [liveBoostStore, settings, updateSettings]);

  const applyTarget = useCallback((nextCategoryId: string, nextTargetId: string) => {
    const { category, item } = atlasItemById(manifest, nextCategoryId, nextTargetId);
    if (!category || !item) return;
    setCategoryId(category.id);
    setTargetId(item.id);
    setSettings(targetSettings(item));
    setCustomColors(null);
    setSelectedColor(0);
  }, [manifest]);

  const setFamily = useCallback((value: string) => {
    const nextFamily = familyByValue(value);
    updateSettings(current => {
      current.family = nextFamily.value;
      if (!nextFamily.seeds.some(seed => seed.value === String(current.seed))) {
        current.seed = nextFamily.seeds[0]!.value;
      }
      current.generation = Math.min(Number(current.generation ?? 0), nextFamily.maxGeneration);
      return current;
    });
  }, [updateSettings]);

  const ensureCustomColors = useCallback((): Oklch[] => {
    if (customColors) return customColors.map(copyOklch);
    // Seed from the *displayed* palette (Spread-aware stop count), not the raw
    // Slots count, so starting to edit a colour doesn't snap the others from the
    // on-screen spread gradient to a different resolution. spread 0 = follow Slots,
    // so this is identical to the old behaviour in the default case.
    const source = buildPalette(palettePreset, appliedStops).colors;
    return source.map(copyOklch);
  }, [appliedStops, customColors, palettePreset]);

  const updateCustomColor = useCallback((updater: (color: Oklch) => Oklch) => {
    const nextColors = ensureCustomColors();
    const idx = Math.min(selectedColor, colorCount - 1);
    nextColors[idx] = updater(copyOklch(nextColors[idx]!));
    setCustomColors(nextColors);
    if (palettePreset !== CUSTOM_PALETTE_PRESET) setSetting('preset', String(CUSTOM_PALETTE_PRESET));
  }, [colorCount, ensureCustomColors, palettePreset, selectedColor, setSetting]);

  const onPalette = useCallback((value: string) => {
    setCustomColors(null);
    setSetting('preset', value);
  }, [setSetting]);

  const onCategory = useCallback((nextCategoryId: string) => {
    const category = manifest?.categories?.find(item => item.id === nextCategoryId);
    if (category?.items?.[0]) applyTarget(category.id, category.items[0].id);
  }, [applyTarget, manifest]);

  const onTarget = useCallback((nextTargetId: string) => {
    if (nextTargetId === CURRENT_CONTROLS) {
      setTargetId(CURRENT_CONTROLS);
      return;
    }
    applyTarget(categoryId, nextTargetId);
  }, [applyTarget, categoryId]);

  const onGain = useCallback((key: keyof Gains, value: number) => {
    setGains(current => ({ ...current, [key]: value }));
  }, []);

  const onAudioModulation = useCallback((values: Record<string, number | undefined>) => {
    audioModulationsRef.current = values;
    applyAudioDriveRef.current();
    scheduleAppAudioModulations();
  }, [scheduleAppAudioModulations]);

  const onPostChain = useCallback((spec: PostChainSpec) => {
    postChainRef.current = spec;
    rendererRef.current?.setPostChain(spec);
  }, []);

  const onRenderInputs = useCallback((inputs: RenderInputs) => {
    renderInputsRef.current = inputs;
    rendererRef.current?.setRenderInputs(inputs);
  }, []);

  const onFieldPhase = useCallback((phase: number) => {
    fieldPhaseRef.current = phase;
    rendererRef.current?.setFieldPhase(phase);
  }, []);

  const onFieldSlots = useCallback((slots: FieldSlot[]) => {
    fieldSlotsRef.current = slots;
    rendererRef.current?.setFieldSlots(slots);
  }, []);

  const applyGraphPresetState = useCallback((state: GraphPresetAppState) => {
    setCategoryId(state.categoryId);
    setTargetId(state.targetId);
    setSettings(current => clampGeneration(normalizeSettings({ ...current, ...state.settings })));
    setCustomColors(state.customColors ? state.customColors.map(copyOklch) : null);
    setSelectedColor(Math.max(0, state.selectedColor));
    setGains(current => ({ ...current, ...state.gains }));
    setDragMode(state.dragMode);
  }, []);

  const resetBoost = useCallback(() => {
    updateSettings(current => {
      current.projection = '1';
      current.hyp_boost_x = 50;
      current.hyp_boost_y = 50;
      return current;
    });
    liveBoostStore.set(null);
  }, [liveBoostStore, updateSettings]);

  const resetView = useCallback(() => {
    rendererRef.current?.resetView();
  }, []);

  const resetClock = useCallback(() => {
    rendererRef.current?.resetClock();
  }, []);

  const startDrawerResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = drawerWidth;
    const controls = controlsRef.current;
    let nextWidth = startWidth;
    let frame = 0;
    const applyGuide = () => {
      frame = 0;
      controls?.style.setProperty('--resize-guide-left', `${window.innerWidth - 16 - nextWidth}px`);
    };
    controls?.classList.add('resizing');
    controls?.style.setProperty('--resize-guide-left', `${window.innerWidth - 16 - nextWidth}px`);
    const onMove = (moveEvent: PointerEvent) => {
      nextWidth = Math.max(420, Math.min(window.innerWidth - 24, startWidth + startX - moveEvent.clientX));
      if (!frame) frame = requestAnimationFrame(applyGuide);
    };
    const onUp = () => {
      if (frame) cancelAnimationFrame(frame);
      controls?.classList.remove('resizing');
      controls?.style.removeProperty('--resize-guide-left');
      controls?.style.setProperty('--drawer-width', `${nextWidth}px`);
      setDrawerWidth(nextWidth);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
  }, [drawerWidth]);

  if (error) {
    return <pre className="fatal">{error}</pre>;
  }

  return (
    <>
      <section id="viewport" ref={viewportRef} aria-label="Tiling renderer" />
      <aside
        id="controls"
        ref={controlsRef}
        className={drawerOpen ? 'open' : 'collapsed'}
        style={drawerStyle}
        aria-label="Control graph"
      >
        <header>
          <div>
            <p className="eyebrow">Penrose Wallpaper</p>
            <h1>{activeItem?.name ?? `${family.label} / ${seedLabel(settings.family, settings.seed)}`}</h1>
          </div>
          <div className="status">
            <span>{patch?.tiles.length ?? 0}</span>
            <span>tiles</span>
          </div>
        </header>
        <div className="graph-frame">
          <button
            type="button"
            className="drawer-toggle"
            onClick={() => setDrawerOpen(open => !open)}
            aria-label={drawerOpen ? 'Collapse controls' : 'Expand controls'}
          >
            {drawerOpen ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
          <button
            type="button"
            className="drawer-resize"
            onPointerDown={startDrawerResize}
            aria-label="Resize controls"
            disabled={!drawerOpen}
          >
            <GripVertical size={16} />
          </button>
          {manifest && activeCategory ? (
            <ControlGraph
              manifest={manifest}
              activeCategory={activeCategory}
              categoryId={categoryId}
              targetId={targetId}
              currentValue={CURRENT_CONTROLS}
              settings={settings}
              liveBoostStore={liveBoostStore}
              palette={palette}
              colorCount={colorCount}
              selectedColor={selectedColor}
              selectedColorValue={selectedColorValue}
              seedOptions={seedOptions}
              maxGeneration={maxGeneration}
              audio={audio}
              customColors={customColors}
              gains={gains}
              dragMode={dragMode}
              tiles={patch?.tiles.length ?? 0}
              loading={loading}
              gamut={displayGamutLabel()}
              onCategory={onCategory}
              onTarget={onTarget}
              onFamily={setFamily}
              onSetting={setSetting}
              onPreviewSetting={previewSetting}
              onPalette={onPalette}
              onSelectedColor={setSelectedColor}
              onCustomColor={updateCustomColor}
              onGain={onGain}
              onAudioModulation={onAudioModulation}
              onPostChain={onPostChain}
              onRenderInputs={onRenderInputs}
              onFieldPhase={onFieldPhase}
              onFieldSlots={onFieldSlots}
              onGraphPresetState={applyGraphPresetState}
              onDragMode={setDragMode}
              onBeginEdit={beginEdit}
              onEndEdit={endEdit}
              onResetBoost={resetBoost}
              onResetClock={resetClock}
              onResetView={resetView}
            />
          ) : (
            <div className="control-flow-shell loading-flow">Loading graph</div>
          )}
        </div>
      </aside>
    </>
  );
}
