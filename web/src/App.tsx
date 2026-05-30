import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';
import type { BufferGeometry } from 'three/webgpu';
import { loadAtlasManifest, firstTarget, targetSettings } from './atlas/loadAtlas';
import { familyByValue, maxGenerationForFamily, seedLabel, seedOptionsForFamily } from './tiling/families';
import { buildPalette, displayGamutLabel, MAX_COLORS, type Oklch, type Palette } from './color/palette';
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
import type { AtlasCategory, AtlasItem, AtlasManifest, BoostPosition, DragMode, Gains, GraphPresetAppState, LiveBoostStore, Patch, PostChainSpec, RenderInputs } from './types';
import type { WallpaperRenderer } from './render/webgpuRenderer';

const CURRENT_CONTROLS = '__current_controls__';
// Settings that change the baked tiling structure (vertices + the per-vertex
// paletteSlot index), so changing one must rebuild the mesh. NOT included:
// `preset`/`customColors` — those change only the colour *values* per slot, which
// `applyPaletteColors` re-bakes live into the `color` attribute without a rebuild.
// Adding `preset` here would reintroduce a full mesh rebuild on every palette
// change (and the Poincaré flatten/re-ball flicker that came with it).
const GEOMETRY_SETTINGS: SettingKey[] = [
  'border_a',
  'border_c',
  'border_h',
  'border_l',
  'border_on',
  'border_width',
  'color_count',
  'color_mode',
  'hyp_border_subdiv',
  'hyp_fill_subdiv',
  'projection',
];
const HYPERBOLIC_GEOMETRY_SETTINGS: SettingKey[] = [...GEOMETRY_SETTINGS, 'hyp_scale'];
const APP_AUDIO_SETTING_KEYS: readonly SettingKey[] = [
  'generation',
  'color_count',
  'hyp_fill_subdiv',
  'hyp_border_subdiv',
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
  const rendererRef = useRef<WallpaperRenderer | null>(null);
  const boostFrameRef = useRef(0);
  const boostRef = useRef<BoostPosition | null>(null);
  const liveBoostStoreRef = useRef<LiveBoostStore | null>(null);
  const heldParamsRef = useRef<Record<string, boolean | undefined>>({});
  const previewSettingsRef = useRef<Settings | null>(null);
  const audioModulationsRef = useRef<Record<string, number | undefined>>({});
  const postChainRef = useRef<PostChainSpec>([]);
  const renderInputsRef = useRef<RenderInputs>({ geometry: true, lighting: true, color: true, material: true, projection: true, field: true });
  const applyAudioDriveRef = useRef<() => void>(() => undefined);
  const appModulationFrameRef = useRef(0);
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
  const palettePreset = intSetting(settings, 'preset', 0, 11);
  const palette = useMemo(() => (
    buildPalette(palettePreset, colorCount, customColors)
  ), [colorCount, customColors, palettePreset]);
  const renderSettings = useMemo(() => (
    clampGeneration(normalizeSettings({ ...settings, ...appAudioSettings }))
  ), [appAudioSettings, settings]);
  const renderColorCount = intSetting(renderSettings, 'color_count', 2, MAX_COLORS);
  const renderPalettePreset = intSetting(renderSettings, 'preset', 0, 11);
  const renderPalette = useMemo(() => (
    buildPalette(renderPalettePreset, renderColorCount, customColors)
  ), [customColors, renderColorCount, renderPalettePreset]);
  const renderColorCountRef = useRef(renderColorCount);
  const renderPaletteRef = useRef(renderPalette);
  // Lets previewSetting read the live palette without a dependency on it, so
  // previewSetting stays referentially stable across color/setting changes. If
  // it weren't stable, the control-graph's baseNodes (which embeds it) would
  // recompute every color-wheel move and the graph would rebuild/flash.
  const paletteRef = useRef(palette);
  // Lets the geometry-rebuild effect read the latest settings without depending on
  // renderSettings directly — so it rebuilds the mesh only when a geometry-affecting
  // setting changes (geometrySettingsKey), not on every param.
  const renderSettingsRef = useRef(renderSettings);
  const geometrySettingsKey = useMemo(() => {
    const keys = String(renderSettings.projection) === '1' ? HYPERBOLIC_GEOMETRY_SETTINGS : GEOMETRY_SETTINGS;
    return settingsKey(renderSettings, keys);
  }, [renderSettings]);
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
    const nextPalette = key === 'color_count' || key === 'preset'
      ? buildPalette(intSetting(next, 'preset', 0, 11), intSetting(next, 'color_count', 2, MAX_COLORS), customColorsRef.current)
      : paletteRef.current;
    rendererRef.current?.setSettings(next, nextPalette);
    // setSettings renders the un-modulated baseline; re-apply the current audio
    // modulation in the same tick so the preview render already includes it.
    // Without this, every slider move (and the release frame) flashes one
    // un-modulated frame before the audio loop re-mods — the ride/hold jitter.
    applyAudioDriveRef.current();
  }, []);

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
    applyIntegerTarget('hyp_fill_subdiv', 1, 8);
    applyIntegerTarget('hyp_border_subdiv', 1, 32);

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
      const { buildMeshGeometry } = await import('./tiling/geometry');
      if (cancelled || !rendererRef.current) return;
      // Read the latest settings from a ref: this effect intentionally re-runs only
      // when a geometry-affecting setting changes (geometrySettingsKey) or the patch
      // does — NOT on every renderSettings change. Listing renderSettings here made
      // it rebuild and swap the whole mesh on every committed slider/boost change,
      // which flashed the tiling flat ("unprojected") for a frame before re-applying
      // the projection. Non-geometry changes now flow only through the uniform-apply
      // effect below, so the projection never resets.
      const current = renderSettingsRef.current;
      const { geometry, edgeGeometry, palette: builtPalette } = buildMeshGeometry(currentPatch, current, customColorsRef.current);
      activeGeometry = geometry;
      activeEdgeGeometry = edgeGeometry;
      rendererRef.current.setSettings(current, builtPalette);
      rendererRef.current.setGeometry(geometry, edgeGeometry);
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
  }, [geometrySettingsKey, patch, rendererReady]);

  useEffect(() => {
    if (!rendererReady || !rendererRef.current) return;
    rendererRef.current.setSettings(renderSettings, renderPalette);
  }, [renderPalette, renderSettings, rendererReady]);

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
    const source = buildPalette(palettePreset, colorCount).colors;
    return source.map(copyOklch);
  }, [colorCount, customColors, palettePreset]);

  const updateCustomColor = useCallback((updater: (color: Oklch) => Oklch) => {
    const nextColors = ensureCustomColors();
    const idx = Math.min(selectedColor, colorCount - 1);
    nextColors[idx] = updater(copyOklch(nextColors[idx]!));
    setCustomColors(nextColors);
    if (palettePreset !== 11) setSetting('preset', '11');
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
    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.max(420, Math.min(window.innerWidth - 24, startWidth + startX - moveEvent.clientX));
      setDrawerWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }, [drawerWidth]);

  if (error) {
    return <pre className="fatal">{error}</pre>;
  }

  return (
    <>
      <section id="viewport" ref={viewportRef} aria-label="Tiling renderer" />
      <aside
        id="controls"
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
