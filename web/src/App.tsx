import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, GripVertical, Move, Rotate3D, RotateCcw } from 'lucide-react';
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
import {
  applyModulationTargetRange,
  clampTargetValue,
  editHoldsAnyParam,
  editRidesAnyParam,
  editRidesParam,
  finiteModulation,
} from './flow/modulationTargetRuntime';
import type { AtlasCategory, AtlasItem, AtlasManifest, BoostPosition, DragMode, FieldSlot, Gains, GraphPresetAppState, LiveBoostStore, Patch, PostChainSpec, RenderInputs, TilingWindow } from './types';
import type { ViewGestureMode, WallpaperRenderer } from './render/webgpuRenderer';
import { isOrderFiveIfsSettings, orderFiveIfsPointCount } from './tiling/orderFiveIfs';
import { sourceOverlayActiveForStyle } from './tiling/capabilities';
import { supportsWindowedPatchGeneration, windowedPatchKey } from './tiling/windowedGeneration';

// Loaded with the renderer chunk (see the renderer-init effect): the wrapper
// touches three/webgpu, and a static import would drag three into the entry
// bundle. Every call site runs behind a `rendererRef.current` guard, and the
// renderer-init effect assigns this before setRendererReady(true), so the stub
// throwing means that invariant was broken — fail loudly rather than render
// nothing.
let buildOrderFiveIfsGeometry: typeof import('./tiling/orderFiveIfsGeometry')['buildOrderFiveIfsGeometry'] = () => {
  throw new Error('orderFiveIfsGeometry is loaded with the renderer chunk; renderer is not initialized yet');
};

const CURRENT_CONTROLS = '__current_controls__';
const FILL_GEOMETRY_CACHE_LIMIT = 4;
const EDGE_GEOMETRY_CACHE_LIMIT = 6;
// Settings that change the baked fill mesh (vertices + the per-vertex
// paletteSlot index), so changing one must rebuild the surface mesh. NOT included:
// `preset`/`customColors` — those change only the colour *values* per slot, which
// `applyPaletteColors` re-bakes live into the `color` attribute without a rebuild.
// Adding `preset` here would reintroduce a full mesh rebuild on every palette
// change (and the Poincaré flatten/re-ball flicker that came with it).
const FILL_GEOMETRY_SETTINGS: SettingKey[] = [
  'hyp_fill_subdiv',
  'ornament_style',
  'projection',
  'surface_relief_mode',
  'facet_refine',
  'adapt_tess',
  'source_mark_detail',
];
const PALETTE_CLASS_SETTINGS: SettingKey[] = ['color_count', 'color_mode', 'color_spread'];
const ATTRACTOR_GEOMETRY_SETTINGS: SettingKey[] = [
  'family',
  'seed',
  'generation',
  'preset',
  'color_count',
  'color_spectral',
];

// Border shape is real edge geometry: round/bevel/miter/fill/point/gap live in
// borderJoin.ts. Rebuild only the edge mesh for these controls.
const BORDER_GEOMETRY_SETTINGS: SettingKey[] = [
  'border_on',
  'border_width',
  'border_join',
  'border_fill',
  'border_point',
  'border_gap',
  'hyp_border_subdiv',
];
const EDGE_PROJECTED_GEOMETRY_SETTINGS: SettingKey[] = [
  'projection',
  'hyp_scale',
  'hyp_fill_subdiv',
  'adapt_tess',
  'surface_relief_mode',
];
type PreviewGeometryMode = 'fill' | 'border';

const LIVE_MODULATED_SETTING_KEYS: readonly SettingKey[] = [
  'color_count',
  'color_spread',
  'color_spectral',
  'border_width',
  'border_fill',
  'border_point',
  'border_gap',
];

type SettingsMutator = (current: Settings) => Settings;
type LiveModulatedSettingBases = Partial<Record<SettingKey, number>>;
type LuminanceModulationBase = { index: number; value: number };
type PendingPaletteRender = { settings: Settings; palette: Palette };
type FillGeometryCacheEntry = {
  key: string;
  geometry: BufferGeometry;
  overlayGeometry: BufferGeometry | null;
};
type EdgeGeometryCacheEntry = {
  key: string;
  geometry: BufferGeometry | null;
};
type CachedEdgeGeometry = {
  key: string;
  geometry: BufferGeometry | null;
  retainPrevious: boolean;
};
type CachedFillGeometry = {
  key: string;
  geometry: BufferGeometry;
  edgeGeometry: BufferGeometry | null;
  overlayGeometry: BufferGeometry | null;
  edgeKey: string;
  palette: Palette;
  retainPrevious: boolean;
  retainPreviousEdge: boolean;
};

function errorMessage(error: Error | string): string {
  return error instanceof Error ? error.stack ?? error.message : error;
}

function isGeometryBudgetMessage(message: string): boolean {
  return message.includes('tiling mesh exceeds vertex budget')
    || message.includes('WebGPU buffer budget exceeded');
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
  const family = intSetting(settings, 'family', 0, 19);
  const overlayActive = sourceOverlayActiveForStyle(family, intSetting(settings, 'ornament_style', 0, 4)) ? '1' : '0';
  return `${settingsKey(settings, FILL_GEOMETRY_SETTINGS)}|source_overlay:${overlayActive}`;
}

function borderGeometryKey(settings: Settings): string {
  return settingsKey(settings, BORDER_GEOMETRY_SETTINGS);
}

function geometryWindowCacheKey(window: TilingWindow | null): string {
  if (!window) return 'window:full';
  const q = (value: number): string => String(Math.round(value * 1000));
  return `window:${q(window.centerX)},${q(window.centerY)},${q(window.halfWidth)},${q(window.halfHeight)}`;
}

function fillGeometryCacheKey(settings: Settings, window: TilingWindow | null): string {
  return [
    fillGeometryKey(settings),
    borderGeometryKey(settings),
    settingsKey(settings, PALETTE_CLASS_SETTINGS),
    geometryWindowCacheKey(window),
  ].join('||');
}

function edgeGeometryCacheKey(settings: Settings, window: TilingWindow | null): string {
  return [
    borderGeometryKey(settings),
    settingsKey(settings, EDGE_PROJECTED_GEOMETRY_SETTINGS),
    geometryWindowCacheKey(window),
  ].join('||');
}

function borderGeometryBasisSettings(current: Settings, baked: Settings | null): Settings {
  if (!baked) return current;
  return {
    ...current,
    projection: baked.projection,
    hyp_scale: baked.hyp_scale,
  };
}

function previewGeometryModeForSetting(key: SettingKey): PreviewGeometryMode | null {
  if (FILL_GEOMETRY_SETTINGS.includes(key) || key === 'hyp_fill_subdiv') return 'fill';
  if (BORDER_GEOMETRY_SETTINGS.includes(key)) return 'border';
  return null;
}

function isPaletteClassSetting(key: SettingKey): boolean {
  return PALETTE_CLASS_SETTINGS.includes(key);
}

function copyOklch(color: Oklch): Oklch {
  return [color[0], color[1], color[2]];
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
  dragMode: DragMode,
  modulations: Record<string, number | undefined>,
): Settings {
  const keys = heldSettingKeys(preview, heldParams);
  if (!preview || keys.length === 0) return base;
  const effective = { ...base };
  for (const key of keys) {
    const appTargetIsRiding = editRidesParam(dragMode, heldParams, key)
      && LIVE_MODULATED_SETTING_KEYS.some(item => item === key)
      && finiteModulation(modulations[key]) !== null;
    if (!appTargetIsRiding) effective[key] = preview[key];
  }
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
  dragMode: DragMode,
  modulations: Record<string, number | undefined>,
  boost: BoostPosition | null,
): Settings {
  return settingsWithLiveBoost(settingsWithHeldPreview(base, preview, heldParams, dragMode, modulations), boost);
}

function paletteForSettings(settings: Settings, customColors: Oklch[] | null): Palette {
  return buildPalette(
    intSetting(settings, 'preset', 0, MAX_PALETTE_PRESET),
    intSetting(settings, 'color_count', 2, MAX_COLORS),
    customColors,
    intSetting(settings, 'color_spectral', 0, 100) / 100,
  );
}

function editablePaletteForSettings(settings: Settings, customColors: Oklch[] | null): Palette {
  const colorCount = intSetting(settings, 'color_count', 2, MAX_COLORS);
  if (customColors) return buildPalette(CUSTOM_PALETTE_PRESET, colorCount, customColors, 0);
  return buildPalette(intSetting(settings, 'preset', 0, MAX_PALETTE_PRESET), colorCount, null, 0);
}

function sameLiveModulatedSettings(a: Partial<Settings>, b: Partial<Settings>): boolean {
  return LIVE_MODULATED_SETTING_KEYS.every(key => a[key] === b[key]);
}

function mergeHeldPreviewSettings(settings: Settings, preview: Settings | null, heldParams: Record<string, boolean | undefined>): Settings {
  const keys = heldSettingKeys(preview, heldParams);
  if (!preview || keys.length === 0) return settings;
  const merged = { ...settings };
  for (const key of keys) merged[key] = preview[key];
  return merged;
}

function paletteWithLuminance(palette: Palette, index: number, luminance: number): Palette {
  return {
    ...palette,
    colors: palette.colors.map((color, idx): Oklch => (
      idx === index ? [luminance, color[1], color[2]] : copyOklch(color)
    )),
  };
}

function customPaletteSettings(settings: Settings): Settings {
  return intSetting(settings, 'preset', 0, MAX_PALETTE_PRESET) === CUSTOM_PALETTE_PRESET
    ? settings
    : { ...settings, preset: String(CUSTOM_PALETTE_PRESET) };
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
  const choreoPhaseRef = useRef(0);
  const fieldSlotsRef = useRef<FieldSlot[]>([]);
  const renderInputsRef = useRef<RenderInputs>({
    geometry: true,
    attractor: true,
    lighting: true,
    choreoPhase: true,
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
  const applyLiveSettingModulationsRef = useRef<() => void>(() => undefined);
  const schedulePreviewGeometryRef = useRef<(mode: PreviewGeometryMode) => void>(() => undefined);
  const schedulePreviewPaletteSlotsRef = useRef<() => void>(() => undefined);
  const liveSettingModulationFrameRef = useRef(0);
  // Live geometry/colour preview needs dependency-free access to the lazy builders
  // and current patch. Slots/Color mode only re-quantize paletteSlot in-place;
  // subdivision/projection still rebuild real geometry.
  const buildMeshGeometryRef = useRef<typeof import('./tiling/geometry').buildMeshGeometry | null>(null);
  const buildEdgeGeometryRef = useRef<typeof import('./tiling/geometry').buildEdgeGeometryForPatch | null>(null);
  const buildPaletteSlotsForPatchRef = useRef<typeof import('./tiling/geometry').buildPaletteSlotsForPatch | null>(null);
  const patchRef = useRef<Patch | null>(null);
  const framedPatchRef = useRef<Patch | null>(null);
  const previewGeometryFrameRef = useRef(0);
  const previewGeometryModeRef = useRef<PreviewGeometryMode>('border');
  const previewPaletteFrameRef = useRef(0);
  const viewWindowChangeTimeoutRef = useRef(0);
  const liveModulatedSettingBasesRef = useRef<LiveModulatedSettingBases>({});
  const luminanceModBaseRef = useRef<LuminanceModulationBase | null>(null);
  const luminanceModActiveRef = useRef(false);
  const bakedGeometrySettingsRef = useRef<Settings | null>(null);
  const fillGeometryCacheRef = useRef<FillGeometryCacheEntry[]>([]);
  const fillGeometryCachePatchRef = useRef<Patch | null>(null);
  const activeFillGeometryCacheKeyRef = useRef('');
  const edgeGeometryCacheRef = useRef<EdgeGeometryCacheEntry[]>([]);
  const edgeGeometryCachePatchRef = useRef<Patch | null>(null);
  const activeEdgeGeometryCacheKeyRef = useRef('');
  const gainsRef = useRef<Gains>({ relief: 0.28, emissive: 0.55, film: 0.36, metal: 0.18 });
  const dragModeRef = useRef<DragMode>('ride');
  if (!liveBoostStoreRef.current) liveBoostStoreRef.current = createLiveBoostStore();
  const liveBoostStore = liveBoostStoreRef.current;
  const [manifest, setManifest] = useState<AtlasManifest | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [targetId, setTargetId] = useState(CURRENT_CONTROLS);
  const [settings, setSettings] = useState(() => normalizeSettings(DEFAULT_SETTINGS));
  const [liveModulatedSettings, setLiveModulatedSettings] = useState<Partial<Settings>>({});
  const [patch, setPatch] = useState<Patch | null>(null);
  const [viewWindowPatchKey, setViewWindowPatchKey] = useState('full');
  const [customColors, setCustomColors] = useState<Oklch[] | null>(null);
  const customColorsRef = useRef<Oklch[] | null>(null);
  const [selectedColor, setSelectedColor] = useState(0);
  const [rendererReady, setRendererReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [drawerWidth, setDrawerWidth] = useState(() => Math.min(780, Math.max(560, window.innerWidth * 0.48)));
  const [viewGestureMode, setViewGestureMode] = useState<ViewGestureMode>('rotate');
  const viewGestureModeRef = useRef<ViewGestureMode>('rotate');
  const [loading, setLoading] = useState('Loading atlas');
  const [error, setError] = useState('');
  const [gains, setGains] = useState({ relief: 0.28, emissive: 0.55, film: 0.36, metal: 0.18 });
  const [dragMode, setDragMode] = useState<DragMode>('ride');
  const settingsRef = useRef(settings);
  const selectedColorRef = useRef(selectedColor);
  const customColorFrameRef = useRef(0);
  const customColorPreviewActiveRef = useRef(false);
  const pendingCustomColorRenderRef = useRef<PendingPaletteRender | null>(null);
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
  const colorSpectral = intSetting(settings, 'color_spectral', 0, 100);
  const palette = useMemo(() => (
    buildPalette(palettePreset, colorCount, customColors, colorSpectral / 100)
  ), [colorCount, colorSpectral, customColors, palettePreset]);
  const editablePalette = useMemo(() => (
    editablePaletteForSettings(settings, customColors)
  ), [customColors, settings]);
  const renderSettings = useMemo(() => (
    clampGeneration(normalizeSettings({ ...settings, ...liveModulatedSettings }))
  ), [liveModulatedSettings, settings]);
  const renderColorCount = intSetting(renderSettings, 'color_count', 2, MAX_COLORS);
  const renderPalettePreset = intSetting(renderSettings, 'preset', 0, MAX_PALETTE_PRESET);
  const renderColorSpectral = intSetting(renderSettings, 'color_spectral', 0, 100);
  const renderPalette = useMemo(() => (
    buildPalette(renderPalettePreset, renderColorCount, customColors, renderColorSpectral / 100)
  ), [customColors, renderColorCount, renderColorSpectral, renderPalettePreset]);
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
  const paletteClassSettingsKey = useMemo(() => settingsKey(renderSettings, PALETTE_CLASS_SETTINGS), [renderSettings]);
  const attractorGeometrySettingsKey = useMemo(() => settingsKey(renderSettings, ATTRACTOR_GEOMETRY_SETTINGS), [renderSettings]);
  const appliedBorderGeometryRef = useRef<{ key: string; patch: Patch } | null>(null);
  const renderIsAttractor = isOrderFiveIfsSettings(renderSettings);
  const renderItemCount = renderIsAttractor ? orderFiveIfsPointCount(renderSettings) : (patch?.tiles.length ?? 0);
  const renderUnit = renderIsAttractor ? 'points' : 'tiles';
  const selectedColorValue: Oklch =
    editablePalette.colors[Math.min(selectedColor, colorCount - 1)] ?? editablePalette.colors[0] ?? [0.78, 0.13, 80];
  const drawerStyle: CSSProperties & Record<'--drawer-width', string> = {
    '--drawer-width': `${drawerWidth}px`,
  };

  const updateSettings = useCallback((mutator: SettingsMutator) => {
    setTargetId(CURRENT_CONTROLS);
    setSettings(current => clampGeneration(normalizeSettings(mutator({ ...current }))));
  }, []);

  const fallbackMonotileGenerationForBudget = useCallback((): boolean => {
    const current = settingsRef.current;
    const familyValue = String(current.family ?? '');
    if (familyValue !== '11' && familyValue !== '12') return false;
    const generation = Math.floor(Number(current.generation ?? 0));
    if (!Number.isFinite(generation) || generation <= 0) return false;
    setLoading('Reducing geometry detail');
    updateSettings(next => {
      if (String(next.family ?? '') === familyValue && Number(next.generation ?? 0) >= generation) {
        next.generation = generation - 1;
      }
      return next;
    });
    return true;
  }, [updateSettings]);

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
    if (
      LIVE_MODULATED_SETTING_KEYS.some(item => item === key)
      && finiteModulation(audioModulationsRef.current[key]) !== null
    ) {
      applyLiveSettingModulationsRef.current();
    }
    if (isPaletteClassSetting(key)) {
      schedulePreviewPaletteSlotsRef.current();
      return;
    }
    // Geometry-shape settings change baked positions/topology. Live preview still
    // updates continuously, but only real geometry changes take the rebuild path.
    // Border colour/opacity (l/c/h/a) are runtime uniforms handled below.
    const geometryMode = previewGeometryModeForSetting(key);
    if (geometryMode) {
      schedulePreviewGeometryRef.current(geometryMode);
      return;
    }
    // Spectral (and preset) only change colour *values* per bucket; Spread changes
    // bucket-to-slot assignment and is handled by the palette-slot path above.
    const nextPalette = key === 'preset' || key === 'color_spectral'
      ? paletteForSettings(next, customColorsRef.current)
      : paletteRef.current;
    if (key === 'preset' || key === 'color_spectral') {
      paletteRef.current = nextPalette;
      renderPaletteRef.current = nextPalette;
    }
    rendererRef.current?.setSettings(next, nextPalette);
    // setSettings renders the un-modulated baseline; re-apply the current audio
    // modulation in the same tick so the preview render already includes it.
    // Without this, every slider move (and the release frame) flashes one
    // un-modulated frame before the audio loop re-mods — the ride/hold jitter.
    applyAudioDriveRef.current();
  }, []);

  const schedulePreviewPaletteSlots = useCallback(() => {
    if (previewPaletteFrameRef.current) return;
    previewPaletteFrameRef.current = requestAnimationFrame(() => {
      previewPaletteFrameRef.current = 0;
      try {
        const buildSlots = buildPaletteSlotsForPatchRef.current;
        const currentPatch = patchRef.current;
        const renderer = rendererRef.current;
        if (!buildSlots || !currentPatch || !renderer) return;
        const current = effectiveRenderSettings(
          previewSettingsRef.current ?? settingsRef.current,
          previewSettingsRef.current,
          heldParamsRef.current,
          dragModeRef.current,
          audioModulationsRef.current,
          boostRef.current ?? liveBoostStore.getSnapshot(),
        );
        const window = renderer.currentTilingWindow();
        const { paletteSlot, topologyPaletteColor, palette: builtPalette } = buildSlots(currentPatch, current, customColorsRef.current, window);
        if (!renderer.setPaletteSlots(paletteSlot, topologyPaletteColor, builtPalette, { render: false })) {
          schedulePreviewGeometryRef.current('fill');
          return;
        }
        paletteRef.current = builtPalette;
        renderPaletteRef.current = builtPalette;
        renderer.setSettings(current, builtPalette);
        applyAudioDriveRef.current();
      } catch (caught) {
        setError(caught instanceof Error ? errorMessage(caught) : String(caught));
      }
    });
  }, [liveBoostStore]);

  useEffect(() => {
    schedulePreviewPaletteSlotsRef.current = schedulePreviewPaletteSlots;
  }, [schedulePreviewPaletteSlots]);

  const cachedOrBuildEdgeGeometry = useCallback((
    buildEdge: typeof import('./tiling/geometry').buildEdgeGeometryForPatch,
    currentPatch: Patch,
    current: Settings,
    window: TilingWindow | null,
  ): CachedEdgeGeometry => {
    const samePatch = edgeGeometryCachePatchRef.current === currentPatch;
    if (!samePatch) {
      const activeKey = activeEdgeGeometryCacheKeyRef.current;
      for (const entry of edgeGeometryCacheRef.current) {
        if (entry.key !== activeKey) entry.geometry?.dispose();
      }
      edgeGeometryCacheRef.current = [];
      edgeGeometryCachePatchRef.current = currentPatch;
      activeEdgeGeometryCacheKeyRef.current = '';
    }

    const key = edgeGeometryCacheKey(current, window);
    const entries = edgeGeometryCacheRef.current;
    const existingIndex = entries.findIndex(entry => entry.key === key);
    if (existingIndex >= 0) {
      const [entry] = entries.splice(existingIndex, 1);
      entries.unshift(entry!);
      return {
        key,
        geometry: entry!.geometry,
        retainPrevious: samePatch,
      };
    }

    const geometry = buildEdge(currentPatch, current, window);
    entries.unshift({ key, geometry });
    while (entries.length > EDGE_GEOMETRY_CACHE_LIMIT) {
      const activeKey = activeEdgeGeometryCacheKeyRef.current;
      let evictIndex = entries.length - 1;
      while (evictIndex >= 0 && entries[evictIndex]?.key === activeKey) evictIndex -= 1;
      if (evictIndex < 0) break;
      const [evicted] = entries.splice(evictIndex, 1);
      evicted?.geometry?.dispose();
    }
    return {
      key,
      geometry,
      retainPrevious: samePatch,
    };
  }, []);

  const cachedOrBuildFillGeometry = useCallback((
    buildMesh: typeof import('./tiling/geometry').buildMeshGeometry,
    buildEdge: typeof import('./tiling/geometry').buildEdgeGeometryForPatch,
    currentPatch: Patch,
    current: Settings,
    window: TilingWindow | null,
  ): CachedFillGeometry => {
    const samePatch = fillGeometryCachePatchRef.current === currentPatch;
    if (!samePatch) {
      const activeKey = activeFillGeometryCacheKeyRef.current;
      for (const entry of fillGeometryCacheRef.current) {
        if (entry.key !== activeKey) {
          entry.geometry.dispose();
          entry.overlayGeometry?.dispose();
        }
      }
      fillGeometryCacheRef.current = [];
      fillGeometryCachePatchRef.current = currentPatch;
      activeFillGeometryCacheKeyRef.current = '';
    }

    const key = fillGeometryCacheKey(current, window);
    const entries = fillGeometryCacheRef.current;
    const existingIndex = entries.findIndex(entry => entry.key === key);
    if (existingIndex >= 0) {
      const [entry] = entries.splice(existingIndex, 1);
      entries.unshift(entry!);
      const edge = cachedOrBuildEdgeGeometry(buildEdge, currentPatch, current, window);
      return {
        key,
        geometry: entry!.geometry,
        edgeGeometry: edge.geometry,
        overlayGeometry: entry!.overlayGeometry,
        edgeKey: edge.key,
        palette: paletteForSettings(current, customColorsRef.current),
        retainPrevious: samePatch,
        retainPreviousEdge: edge.retainPrevious,
      };
    }

    const built = buildMesh(currentPatch, current, customColorsRef.current, window);
    const edgeKey = edgeGeometryCacheKey(current, window);
    if (edgeGeometryCachePatchRef.current !== currentPatch) {
      const activeEdgeKey = activeEdgeGeometryCacheKeyRef.current;
      for (const entry of edgeGeometryCacheRef.current) {
        if (entry.key !== activeEdgeKey) entry.geometry?.dispose();
      }
      edgeGeometryCacheRef.current = [];
    }
    edgeGeometryCachePatchRef.current = currentPatch;
    activeEdgeGeometryCacheKeyRef.current = edgeKey;
    edgeGeometryCacheRef.current.unshift({ key: edgeKey, geometry: built.edgeGeometry });
    while (edgeGeometryCacheRef.current.length > EDGE_GEOMETRY_CACHE_LIMIT) {
      const activeEdgeKey = activeEdgeGeometryCacheKeyRef.current;
      let evictIndex = edgeGeometryCacheRef.current.length - 1;
      while (evictIndex >= 0 && edgeGeometryCacheRef.current[evictIndex]?.key === activeEdgeKey) evictIndex -= 1;
      if (evictIndex < 0) break;
      const [evicted] = edgeGeometryCacheRef.current.splice(evictIndex, 1);
      evicted?.geometry?.dispose();
    }
    entries.unshift({ key, geometry: built.geometry, overlayGeometry: built.overlayGeometry });
    while (entries.length > FILL_GEOMETRY_CACHE_LIMIT) {
      const activeKey = activeFillGeometryCacheKeyRef.current;
      let evictIndex = entries.length - 1;
      while (evictIndex >= 0 && entries[evictIndex]?.key === activeKey) evictIndex -= 1;
      if (evictIndex < 0) break;
      const [evicted] = entries.splice(evictIndex, 1);
      evicted?.geometry.dispose();
      evicted?.overlayGeometry?.dispose();
    }
    return {
      key,
      geometry: built.geometry,
      edgeGeometry: built.edgeGeometry,
      overlayGeometry: built.overlayGeometry,
      edgeKey,
      palette: built.palette,
      retainPrevious: samePatch,
      retainPreviousEdge: samePatch,
    };
  }, [cachedOrBuildEdgeGeometry]);

  const disposeInactiveGeometryCaches = useCallback(() => {
    const activeKey = activeFillGeometryCacheKeyRef.current;
    for (const entry of fillGeometryCacheRef.current) {
      if (entry.key !== activeKey) {
        entry.geometry.dispose();
        entry.overlayGeometry?.dispose();
      }
    }
    fillGeometryCacheRef.current = activeKey
      ? fillGeometryCacheRef.current.filter(entry => entry.key === activeKey)
      : [];
    const activeEdgeKey = activeEdgeGeometryCacheKeyRef.current;
    for (const entry of edgeGeometryCacheRef.current) {
      if (entry.key !== activeEdgeKey) entry.geometry?.dispose();
    }
    edgeGeometryCacheRef.current = activeEdgeKey
      ? edgeGeometryCacheRef.current.filter(entry => entry.key === activeEdgeKey)
      : [];
  }, []);

  // Rebuild the mesh from the live preview settings, coalesced to one rebuild per
  // frame. Uses lazy builders cached by the geometry effect; before that import
  // resolves there is nothing on screen to update, so it simply no-ops.
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
          dragModeRef.current,
          audioModulationsRef.current,
          boostRef.current ?? liveBoostStore.getSnapshot(),
        );
        if (isOrderFiveIfsSettings(current)) {
          const pointGeometry = buildOrderFiveIfsGeometry(current, customColorsRef.current);
          renderer.setSettings(current, paletteForSettings(current, customColorsRef.current));
          renderer.setGeometry(null, null, null, { frame: false, warmup: false });
          renderer.setAttractorGeometry(pointGeometry, { frame: false, warmup: false });
          bakedGeometrySettingsRef.current = current;
          appliedBorderGeometryRef.current = null;
          applyAudioDriveRef.current();
          return;
        }
        if (scheduledMode === 'border') {
          if (!buildEdge) return;
          const edgeBasis = borderGeometryBasisSettings(current, bakedGeometrySettingsRef.current);
          const window = renderer.currentTilingWindow();
          const { key, geometry, retainPrevious } = cachedOrBuildEdgeGeometry(buildEdge, currentPatch, edgeBasis, window);
          renderer.setSettings(current, paletteForSettings(current, customColorsRef.current));
          renderer.setEdgeGeometry(geometry, { retirePrevious: !retainPrevious });
          activeEdgeGeometryCacheKeyRef.current = key;
          appliedBorderGeometryRef.current = { key: borderGeometryKey(current), patch: currentPatch };
        } else {
          if (!buildMesh || !buildEdge) return;
          const window = renderer.currentTilingWindow();
          const { key, geometry, edgeGeometry, overlayGeometry, edgeKey, palette: builtPalette, retainPrevious, retainPreviousEdge } = cachedOrBuildFillGeometry(buildMesh, buildEdge, currentPatch, current, window);
          renderPaletteRef.current = builtPalette;
          renderer.setSettings(current, builtPalette);
          renderer.setGeometry(geometry, edgeGeometry, overlayGeometry, { frame: false, warmup: false, retirePrevious: !retainPrevious, retirePreviousEdge: !retainPreviousEdge });
          renderer.applyPaletteColors(builtPalette);
          activeFillGeometryCacheKeyRef.current = key;
          activeEdgeGeometryCacheKeyRef.current = edgeKey;
          bakedGeometrySettingsRef.current = current;
          appliedBorderGeometryRef.current = { key: borderGeometryKey(current), patch: currentPatch };
        }
        applyAudioDriveRef.current();
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        if (isGeometryBudgetMessage(message) && fallbackMonotileGenerationForBudget()) return;
        setError(caught instanceof Error ? errorMessage(caught) : String(caught));
      }
    });
  }, [cachedOrBuildEdgeGeometry, cachedOrBuildFillGeometry, fallbackMonotileGenerationForBudget, liveBoostStore]);

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
    previewSettingsRef.current = mergeHeldPreviewSettings(settings, previewSettingsRef.current, heldParamsRef.current);
    settingsRef.current = settings;
    liveModulatedSettingBasesRef.current = {};
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
    if (customColorPreviewActiveRef.current) return;
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
    }, audioModulationsRef.current, audio.getSnapshot().features);
  }, [audio]);

  useEffect(() => {
    applyAudioDriveRef.current = applyAudioDrive;
  }, [applyAudioDrive]);

  const applyLiveSettingModulations = useCallback(() => {
    const modulations = audioModulationsRef.current;
    const heldParams = heldParamsRef.current;
    const dragMode = dragModeRef.current;
    const baselineSettings = previewSettingsRef.current ?? settingsRef.current;
    const persistentSettings = settingsRef.current;
    const bases = liveModulatedSettingBasesRef.current;
    const nextLiveSettings: Partial<Settings> = {};

    const applyIntegerTarget = (key: SettingKey, min: number, max: number): void => {
      const signal = finiteModulation(modulations[key]);
      if (signal === null || editHoldsAnyParam(dragMode, heldParams, [key])) {
        delete bases[key];
        return;
      }
      const currentBaseline = intSetting(baselineSettings, key, min, max);
      if (editRidesParam(dragMode, heldParams, key)) bases[key] = currentBaseline;
      const base = bases[key] ?? currentBaseline;
      bases[key] = base;
      const persistentValue = intSetting(persistentSettings, key, min, max);
      const nextValue = Math.round(applyModulationTargetRange(base, signal, min, max));
      if (nextValue !== persistentValue) nextLiveSettings[key] = nextValue;
    };

    applyIntegerTarget('color_count', 2, MAX_COLORS);
    applyIntegerTarget('color_spread', 0, 100);
    applyIntegerTarget('color_spectral', 0, 100);
    applyIntegerTarget('border_width', 0, 600);
    applyIntegerTarget('border_fill', 0, 100);
    applyIntegerTarget('border_point', 0, 100);
    applyIntegerTarget('border_gap', 0, 100);

    setLiveModulatedSettings(current => (
      sameLiveModulatedSettings(current, nextLiveSettings) ? current : nextLiveSettings
    ));

    const selectedIndex = Math.max(0, Math.min(selectedColorRef.current, renderColorCountRef.current - 1));
    const luminanceKey = `custom_color_${selectedIndex}_luminance`;
    const luminanceSignal = finiteModulation(modulations['luminance']);
    const luminanceHeld = editHoldsAnyParam(dragMode, heldParams, ['luminance', luminanceKey]);
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
    const editingLuminance = editRidesAnyParam(dragMode, heldParams, [luminanceKey, 'luminance']);
    if (
      !luminanceModBaseRef.current
      || luminanceModBaseRef.current.index !== selectedIndex
      || editingLuminance
    ) {
      luminanceModBaseRef.current = { index: selectedIndex, value: sourceColor[0] };
    }
    const base = luminanceModBaseRef.current;
    const nextLuminance = clampTargetValue(base.value + luminanceSignal, 0, 1);
    renderer.applyPaletteColors(paletteWithLuminance(basePalette, selectedIndex, nextLuminance));
    renderer.render();
    luminanceModActiveRef.current = true;
  }, []);

  useEffect(() => {
    applyLiveSettingModulationsRef.current = applyLiveSettingModulations;
  }, [applyLiveSettingModulations]);

  const scheduleLiveSettingModulations = useCallback(() => {
    if (liveSettingModulationFrameRef.current) return;
    liveSettingModulationFrameRef.current = requestAnimationFrame(() => {
      liveSettingModulationFrameRef.current = 0;
      applyLiveSettingModulations();
    });
  }, [applyLiveSettingModulations]);

  const handleViewWindowChange = useCallback(() => {
    const renderer = rendererRef.current;
    const family = intSetting(renderSettingsRef.current, 'family', 0, 19);
    if (renderer && supportsWindowedPatchGeneration(family)) {
      if (viewWindowChangeTimeoutRef.current) window.clearTimeout(viewWindowChangeTimeoutRef.current);
      viewWindowChangeTimeoutRef.current = window.setTimeout(() => {
        viewWindowChangeTimeoutRef.current = 0;
        const activeRenderer = rendererRef.current;
        if (!activeRenderer) return;
        const activeFamily = intSetting(renderSettingsRef.current, 'family', 0, 19);
        if (!supportsWindowedPatchGeneration(activeFamily)) return;
        const key = windowedPatchKey(activeRenderer.currentTilingWindow());
        setViewWindowPatchKey(current => current === key ? current : key);
      }, 180);
    }
  }, []);

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
        setSettings(targetSettings(first.category, first.item));
        setLoading('');
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? errorMessage(caught) : String(caught));
      }
    }
    void boot();
    return () => {
      cancelled = true;
      if (boostFrameRef.current) cancelAnimationFrame(boostFrameRef.current);
      if (customColorFrameRef.current) cancelAnimationFrame(customColorFrameRef.current);
      if (liveSettingModulationFrameRef.current) cancelAnimationFrame(liveSettingModulationFrameRef.current);
      if (previewGeometryFrameRef.current) cancelAnimationFrame(previewGeometryFrameRef.current);
      if (viewWindowChangeTimeoutRef.current) window.clearTimeout(viewWindowChangeTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!viewportRef.current || rendererRef.current) return;
    let cancelled = false;
    async function initRenderer() {
      try {
        const [{ WallpaperRenderer }, orderFiveIfsGeometryModule] = await Promise.all([
          import('./render/webgpuRenderer'),
          import('./tiling/orderFiveIfsGeometry'),
        ]);
        buildOrderFiveIfsGeometry = orderFiveIfsGeometryModule.buildOrderFiveIfsGeometry;
        if (cancelled || !viewportRef.current) return;
        const renderer = new WallpaperRenderer(viewportRef.current, { onViewWindowChange: handleViewWindowChange });
        rendererRef.current = renderer;
        renderer.onDeviceLost = (message) => {
          if (!cancelled) setError(`WebGPU device lost: ${message}. Reload the page — this should not happen, so investigate the cause rather than masking it.`);
        };
        await renderer.init();
        if (cancelled) return;
        renderer.setPostChain(postChainRef.current);
        renderer.setRenderInputs(renderInputsRef.current);
        renderer.setFieldPhase(fieldPhaseRef.current);
        renderer.setChoreoPhase(choreoPhaseRef.current);
        renderer.setFieldSlots(fieldSlotsRef.current);
        renderer.setViewGestureMode(viewGestureModeRef.current);
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
      disposeInactiveGeometryCaches();
      rendererRef.current?.dispose();
      rendererRef.current = null;
      setRendererReady(false);
    };
  }, [disposeInactiveGeometryCaches, handleViewWindowChange]);

  useEffect(() => {
    if (!manifest) return;
    let cancelled = false;
    const family = intSetting(renderSettings, 'family', 0, 19);
    const seed = intSetting(renderSettings, 'seed', 0, 1000);
    const generation = intSetting(renderSettings, 'generation', 0, 1000);
    const currentPatch = patchRef.current;
    if (!currentPatch || currentPatch.family !== family || currentPatch.seed !== seed || currentPatch.generation !== generation) {
      setLoading('Generating geometry');
    }
    async function loadPatch() {
      try {
        const { loadPatchForSettings } = await import('./tiling/geometry');
        const rendererWindow = currentPatch && rendererRef.current && supportsWindowedPatchGeneration(family)
          ? rendererRef.current.currentTilingWindow()
          : null;
        const nextPatch = await loadPatchForSettings(renderSettings, activeItem, rendererWindow);
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
  }, [activeItem, manifest, rendererReady, renderSettings.family, renderSettings.generation, renderSettings.seed, viewWindowPatchKey]);

  useEffect(() => {
    if (!patch || !rendererReady || !rendererRef.current) return;
    if (isOrderFiveIfsSettings(renderSettingsRef.current)) return;
    const currentPatch = patch;
    let cancelled = false;
    let activeEdgeGeometry: BufferGeometry | null = null;
    async function buildGeometry() {
      const { buildEdgeGeometryForPatch, buildMeshGeometry, buildPaletteSlotsForPatch } = await import('./tiling/geometry');
      buildMeshGeometryRef.current = buildMeshGeometry;
      buildEdgeGeometryRef.current = buildEdgeGeometryForPatch;
      buildPaletteSlotsForPatchRef.current = buildPaletteSlotsForPatch;
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
        dragModeRef.current,
        audioModulationsRef.current,
        boostRef.current ?? liveBoostStore.getSnapshot(),
      );
      const { key, geometry, edgeGeometry, overlayGeometry, edgeKey, palette: builtPalette, retainPrevious, retainPreviousEdge } = cachedOrBuildFillGeometry(
        buildMeshGeometry,
        buildEdgeGeometryForPatch,
        currentPatch,
        current,
        rendererRef.current.currentTilingWindow(),
      );
      const shouldFrame = framedPatchRef.current !== currentPatch;
      activeEdgeGeometry = edgeGeometry;
      rendererRef.current.setSettings(current, builtPalette);
      rendererRef.current.setGeometry(geometry, edgeGeometry, overlayGeometry, { frame: shouldFrame, warmup: shouldFrame, retirePrevious: !retainPrevious, retirePreviousEdge: !retainPreviousEdge });
      rendererRef.current.applyPaletteColors(builtPalette);
      activeFillGeometryCacheKeyRef.current = key;
      activeEdgeGeometryCacheKeyRef.current = edgeKey;
      bakedGeometrySettingsRef.current = current;
      framedPatchRef.current = currentPatch;
      appliedBorderGeometryRef.current = { key: borderGeometryKey(current), patch: currentPatch };
      activeEdgeGeometry = null;
    }
    void buildGeometry().catch(caught => {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (!cancelled && isGeometryBudgetMessage(message) && fallbackMonotileGenerationForBudget()) return;
      if (!cancelled) setError(caught instanceof Error ? errorMessage(caught) : String(caught));
    });
    return () => {
      cancelled = true;
      activeEdgeGeometry?.dispose();
    };
  }, [cachedOrBuildFillGeometry, fallbackMonotileGenerationForBudget, fillGeometrySettingsKey, patch, rendererReady]);

  useEffect(() => {
    if (!rendererReady || !rendererRef.current) return;
    if (!isOrderFiveIfsSettings(renderSettingsRef.current)) {
      rendererRef.current.setAttractorGeometry(null, { frame: false, warmup: false });
      return;
    }
    const current = effectiveRenderSettings(
      renderSettingsRef.current,
      previewSettingsRef.current,
      heldParamsRef.current,
      dragModeRef.current,
      audioModulationsRef.current,
      boostRef.current ?? liveBoostStore.getSnapshot(),
    );
    const paletteForRender = paletteForSettings(current, customColorsRef.current);
    const geometry = buildOrderFiveIfsGeometry(current, customColorsRef.current);
    rendererRef.current.setSettings(current, paletteForRender);
    rendererRef.current.setGeometry(null, null, null, { frame: false, warmup: false });
    rendererRef.current.setAttractorGeometry(geometry, { frame: true, warmup: true });
    bakedGeometrySettingsRef.current = current;
    applyAudioDriveRef.current();
  }, [attractorGeometrySettingsKey, customColors, liveBoostStore, rendererReady]);

  useEffect(() => {
    if (!patch || !rendererReady || !rendererRef.current) return;
    if (isOrderFiveIfsSettings(renderSettingsRef.current)) return;
    const currentPatch = patch;
    let cancelled = false;
    async function reclassifyPaletteSlots() {
      const { buildPaletteSlotsForPatch } = await import('./tiling/geometry');
      buildPaletteSlotsForPatchRef.current = buildPaletteSlotsForPatch;
      if (cancelled || !rendererRef.current) return;
      const current = effectiveRenderSettings(
        renderSettingsRef.current,
        previewSettingsRef.current,
        heldParamsRef.current,
        dragModeRef.current,
        audioModulationsRef.current,
        boostRef.current ?? liveBoostStore.getSnapshot(),
      );
      const { paletteSlot, topologyPaletteColor, palette: builtPalette } = buildPaletteSlotsForPatch(currentPatch, current, customColorsRef.current, rendererRef.current.currentTilingWindow());
      if (!rendererRef.current.setPaletteSlots(paletteSlot, topologyPaletteColor, builtPalette, { render: false })) {
        schedulePreviewGeometryRef.current('fill');
        return;
      }
      rendererRef.current.setSettings(current, builtPalette);
      applyAudioDriveRef.current();
    }
    void reclassifyPaletteSlots().catch(caught => {
      if (!cancelled) setError(caught instanceof Error ? errorMessage(caught) : String(caught));
    });
    return () => {
      cancelled = true;
    };
  }, [liveBoostStore, paletteClassSettingsKey, patch, rendererReady]);

  useEffect(() => {
    if (!patch || !rendererReady || !rendererRef.current) return;
    if (isOrderFiveIfsSettings(renderSettingsRef.current)) return;
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
        dragModeRef.current,
        audioModulationsRef.current,
        boostRef.current ?? liveBoostStore.getSnapshot(),
      );
      const edgeBasis = borderGeometryBasisSettings(current, bakedGeometrySettingsRef.current);
      const { key, geometry, retainPrevious } = cachedOrBuildEdgeGeometry(buildEdgeGeometryForPatch, currentPatch, edgeBasis, rendererRef.current.currentTilingWindow());
      activeEdgeGeometry = geometry;
      rendererRef.current.setSettings(current, paletteForSettings(current, customColorsRef.current));
      rendererRef.current.setEdgeGeometry(activeEdgeGeometry, { retirePrevious: !retainPrevious });
      activeEdgeGeometryCacheKeyRef.current = key;
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
  }, [borderGeometrySettingsKey, cachedOrBuildEdgeGeometry, patch, rendererReady]);

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
      dragModeRef.current,
      audioModulationsRef.current,
      boostRef.current ?? liveBoostStore.getSnapshot(),
    );
    const currentCustomColors = customColorsRef.current;
    const effectivePalette = effective === renderSettings && currentCustomColors === customColors
      ? renderPalette
      : paletteForSettings(effective, currentCustomColors);
    renderPaletteRef.current = effectivePalette;
    rendererRef.current.setSettings(effective, effectivePalette);
  }, [customColors, liveBoostStore, renderPalette, renderSettings, rendererReady]);

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
    setSettings(targetSettings(category, item));
    customColorPreviewActiveRef.current = false;
    customColorsRef.current = null;
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
      if (nextFamily.showOrientMode === false && String(current.color_mode) === '1') {
        current.color_mode = '0';
      }
      current.generation = Math.min(Number(current.generation ?? 0), nextFamily.maxGeneration);
      return current;
    });
  }, [updateSettings]);

  const scheduleCustomColorRender = useCallback((settingsForRender: Settings, paletteForRender: Palette) => {
    pendingCustomColorRenderRef.current = { settings: settingsForRender, palette: paletteForRender };
    if (customColorFrameRef.current) return;
    customColorFrameRef.current = requestAnimationFrame(() => {
      customColorFrameRef.current = 0;
      const pending = pendingCustomColorRenderRef.current;
      pendingCustomColorRenderRef.current = null;
      if (!pending) return;
      const renderer = rendererRef.current;
      if (renderer && isOrderFiveIfsSettings(pending.settings)) {
        renderer.setSettings(pending.settings, pending.palette);
        renderer.setAttractorGeometry(buildOrderFiveIfsGeometry(pending.settings, customColorsRef.current), { frame: false, warmup: false });
      } else {
        renderer?.setSettings(pending.settings, pending.palette);
      }
      applyAudioDriveRef.current();
    });
  }, []);

  const previewCustomColor = useCallback((updater: (color: Oklch) => Oklch) => {
    const current = settingsRef.current;
    const nextColors = editablePaletteForSettings(current, customColorsRef.current).colors.map(copyOklch);
    const currentColorCount = intSetting(current, 'color_count', 2, MAX_COLORS);
    const idx = Math.max(0, Math.min(selectedColorRef.current, currentColorCount - 1));
    nextColors[idx] = updater(copyOklch(nextColors[idx] ?? nextColors[0] ?? [0.78, 0.13, 80]));
    customColorsRef.current = nextColors;
    const nextSettings = customPaletteSettings(current);
    const nextRenderSettings = customPaletteSettings(renderSettingsRef.current);
    const nextPalette = paletteForSettings(nextSettings, nextColors);
    const nextRenderPalette = paletteForSettings(nextRenderSettings, nextColors);
    customColorPreviewActiveRef.current = true;
    paletteRef.current = nextPalette;
    renderPaletteRef.current = nextRenderPalette;
    scheduleCustomColorRender(nextRenderSettings, nextRenderPalette);
  }, [scheduleCustomColorRender]);

  const commitCustomColor = useCallback(() => {
    const nextColors = customColorsRef.current;
    if (!nextColors) return;
    customColorPreviewActiveRef.current = false;
    setCustomColors(nextColors.map(copyOklch));
    if (intSetting(settingsRef.current, 'preset', 0, MAX_PALETTE_PRESET) !== CUSTOM_PALETTE_PRESET) {
      setSetting('preset', String(CUSTOM_PALETTE_PRESET));
    }
  }, [setSetting]);

  const onPalette = useCallback((value: string) => {
    customColorPreviewActiveRef.current = false;
    customColorsRef.current = null;
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
    scheduleLiveSettingModulations();
  }, [scheduleLiveSettingModulations]);

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

  const onChoreoPhase = useCallback((phase: number) => {
    choreoPhaseRef.current = phase;
    rendererRef.current?.setChoreoPhase(phase);
  }, []);

  const onFieldSlots = useCallback((slots: FieldSlot[]) => {
    fieldSlotsRef.current = slots;
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setFieldSlots(slots);
    renderer.flushPendingRender();
  }, []);

  const applyGraphPresetState = useCallback((state: GraphPresetAppState) => {
    const category = manifest?.categories?.find(item => item.id === state.categoryId) ?? manifest?.categories?.[0] ?? null;
    const target = category && state.targetId !== CURRENT_CONTROLS
      ? category.items.find(item => item.id === state.targetId) ?? null
      : null;
    setCategoryId(category?.id ?? state.categoryId);
    setTargetId(target?.id ?? CURRENT_CONTROLS);
    setSettings(current => clampGeneration(normalizeSettings({ ...current, ...state.settings })));
    const nextCustomColors = state.customColors ? state.customColors.map(copyOklch) : null;
    customColorPreviewActiveRef.current = false;
    customColorsRef.current = nextCustomColors;
    setCustomColors(nextCustomColors);
    setSelectedColor(Math.max(0, state.selectedColor));
    setGains(current => ({ ...current, ...state.gains }));
    setDragMode(state.dragMode);
  }, [manifest]);

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

  const setGestureMode = useCallback((mode: ViewGestureMode) => {
    viewGestureModeRef.current = mode;
    setViewGestureMode(mode);
    rendererRef.current?.setViewGestureMode(mode);
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
      <div className="view-toolbar" aria-label="Renderer view controls">
        <button
          type="button"
          className={viewGestureMode === 'rotate' ? 'selected' : ''}
          onClick={() => setGestureMode('rotate')}
          aria-label="Rotate view"
          title="Rotate view"
        >
          <Rotate3D size={17} />
        </button>
        <button
          type="button"
          className={viewGestureMode === 'pan' ? 'selected' : ''}
          onClick={() => setGestureMode('pan')}
          aria-label="Pan view"
          title="Pan view"
        >
          <Move size={17} />
        </button>
        <button
          type="button"
          onClick={resetView}
          aria-label="Reset view"
          title="Reset view"
        >
          <RotateCcw size={17} />
        </button>
      </div>
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
            <span>{renderItemCount}</span>
            <span>{renderUnit}</span>
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
              tiles={renderItemCount}
              renderUnit={renderUnit}
              loading={loading}
              gamut={displayGamutLabel()}
              onCategory={onCategory}
              onTarget={onTarget}
              onFamily={setFamily}
              onSetting={setSetting}
              onPreviewSetting={previewSetting}
              onPalette={onPalette}
              onSelectedColor={setSelectedColor}
              onPreviewCustomColor={previewCustomColor}
              onCommitCustomColor={commitCustomColor}
              onGain={onGain}
              onAudioModulation={onAudioModulation}
              onPostChain={onPostChain}
              onRenderInputs={onRenderInputs}
              onFieldPhase={onFieldPhase}
              onChoreoPhase={onChoreoPhase}
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
