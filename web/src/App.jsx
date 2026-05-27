import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';
import { loadAtlasManifest, firstTarget, targetSettings } from './atlas/loadAtlas.js';
import { familyByValue, maxGenerationForFamily, seedLabel, seedOptionsForFamily } from './tiling/families.js';
import { buildPalette, displayGamutLabel, MAX_COLORS } from './color/palette.js';
import { DEFAULT_SETTINGS, intSetting, normalizeSettings } from './settings/androidSettings.js';
import { useWebAudioGraph } from './audio/useWebAudioGraph.js';

const CURRENT_CONTROLS = '__current_controls__';
const ControlGraph = lazy(() => import('./flow/ControlGraph.jsx').then(module => ({ default: module.ControlGraph })));
const GEOMETRY_SETTINGS = [
  'border_a',
  'border_c',
  'border_h',
  'border_l',
  'border_on',
  'border_width',
  'color_count',
  'color_mode',
  'hyp_boost_x',
  'hyp_boost_y',
  'hyp_border_subdiv',
  'hyp_fill_subdiv',
  'hyp_scale',
  'mat_relief',
  'preset',
  'projection',
];

function clampGeneration(settings) {
  const family = String(settings.family ?? DEFAULT_SETTINGS.family);
  const maxGeneration = maxGenerationForFamily(family);
  return {
    ...settings,
    generation: Math.min(Number(settings.generation ?? 0), maxGeneration),
  };
}

function atlasItemById(manifest, categoryId, itemId) {
  const category = manifest?.categories?.find(item => item.id === categoryId);
  const item = category?.items?.find(target => target.id === itemId);
  return { category, item };
}

function settingsKey(settings, keys) {
  return keys.map(key => `${key}:${String(settings[key] ?? '')}`).join('|');
}

export function App() {
  const viewportRef = useRef(null);
  const rendererRef = useRef(null);
  const [manifest, setManifest] = useState(null);
  const [categoryId, setCategoryId] = useState('');
  const [targetId, setTargetId] = useState(CURRENT_CONTROLS);
  const [settings, setSettings] = useState(() => normalizeSettings(DEFAULT_SETTINGS));
  const [patch, setPatch] = useState(null);
  const [customColors, setCustomColors] = useState(null);
  const [selectedColor, setSelectedColor] = useState(0);
  const [rendererReady, setRendererReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [drawerWidth, setDrawerWidth] = useState(() => Math.min(780, Math.max(560, window.innerWidth * 0.48)));
  const [loading, setLoading] = useState('Loading atlas');
  const [error, setError] = useState('');
  const [gains, setGains] = useState({ relief: 0.28, emissive: 0.55, film: 0.36, metal: 0.18 });
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
  const palette = useMemo(() => (
    buildPalette(intSetting(settings, 'preset', 0, 11), colorCount, customColors)
  ), [colorCount, customColors, settings]);
  const geometrySettingsKey = useMemo(() => settingsKey(settings, GEOMETRY_SETTINGS), [settings]);
  const selectedColorValue = palette.colors[Math.min(selectedColor, colorCount - 1)] ?? palette.colors[0];

  const updateSettings = useCallback(mutator => {
    setTargetId(CURRENT_CONTROLS);
    setSettings(current => clampGeneration(normalizeSettings(mutator({ ...current }))));
  }, []);

  const setSetting = useCallback((key, value) => {
    updateSettings(current => {
      current[key] = value;
      return current;
    });
  }, [updateSettings]);

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
        if (!cancelled) setError(caught.stack || caught.message);
      }
    }
    void boot();
    return () => {
      cancelled = true;
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!viewportRef.current || rendererRef.current) return;
    let cancelled = false;
    async function initRenderer() {
      try {
        const { WallpaperRenderer } = await import('./render/webgpuRenderer.js');
        if (cancelled || !viewportRef.current) return;
        const renderer = new WallpaperRenderer(viewportRef.current);
        rendererRef.current = renderer;
        await renderer.init();
        if (!cancelled) setRendererReady(true);
      } catch (caught) {
        if (!cancelled) setError(caught.stack || caught.message);
      }
    }
    void initRenderer();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!manifest) return;
    let cancelled = false;
    setLoading('Generating geometry');
    async function loadPatch() {
      try {
        const { loadPatchForSettings } = await import('./tiling/geometry.js');
        const nextPatch = await loadPatchForSettings(settings, activeItem);
        if (cancelled) return;
        setPatch(nextPatch);
        setLoading('');
      } catch (caught) {
        if (!cancelled) setError(caught.stack || caught.message);
      }
    }
    void loadPatch();
    return () => {
      cancelled = true;
    };
  }, [activeItem, manifest, settings.family, settings.generation, settings.seed]);

  useEffect(() => {
    if (!patch || !rendererReady || !rendererRef.current) return;
    let cancelled = false;
    let activeGeometry = null;
    let activeEdgeGeometry = null;
    async function buildGeometry() {
      const { buildMeshGeometry } = await import('./tiling/geometry.js');
      if (cancelled || !rendererRef.current) return;
      const { geometry, edgeGeometry, palette: builtPalette } = buildMeshGeometry(patch, settings, customColors);
      activeGeometry = geometry;
      activeEdgeGeometry = edgeGeometry;
      rendererRef.current.setSettings(settings, builtPalette);
      rendererRef.current.setGeometry(geometry, edgeGeometry);
      activeGeometry = null;
      activeEdgeGeometry = null;
    }
    void buildGeometry().catch(caught => {
      if (!cancelled) setError(caught.stack || caught.message);
    });
    return () => {
      cancelled = true;
      activeGeometry?.dispose();
      activeEdgeGeometry?.dispose();
    };
  }, [customColors, geometrySettingsKey, patch, rendererReady]);

  useEffect(() => {
    if (!rendererReady || !rendererRef.current) return;
    rendererRef.current.setSettings(settings, palette);
  }, [palette, rendererReady, settings]);

  useEffect(() => {
    rendererRef.current?.setAudioDrive(audio.features, gains);
  }, [audio.features, gains]);

  useEffect(() => {
    rendererRef.current?.setProjectionGesture({
      settings,
      onBoost: (x, y) => {
        updateSettings(current => {
          current.projection = '1';
          current.hyp_boost_x = x;
          current.hyp_boost_y = y;
          return current;
        });
      },
    });
  }, [settings, updateSettings]);

  const applyTarget = useCallback((nextCategoryId, nextTargetId) => {
    const { category, item } = atlasItemById(manifest, nextCategoryId, nextTargetId);
    if (!category || !item) return;
    setCategoryId(category.id);
    setTargetId(item.id);
    setSettings(targetSettings(item));
    setCustomColors(null);
    setSelectedColor(0);
  }, [manifest]);

  const setFamily = useCallback(value => {
    const nextFamily = familyByValue(value);
    updateSettings(current => {
      current.family = nextFamily.value;
      if (!nextFamily.seeds.some(seed => seed.value === String(current.seed))) {
        current.seed = nextFamily.seeds[0].value;
      }
      current.generation = Math.min(Number(current.generation ?? 0), nextFamily.maxGeneration);
      return current;
    });
  }, [updateSettings]);

  const ensureCustomColors = useCallback(() => {
    if (customColors) return customColors.map(color => color.slice());
    const source = buildPalette(intSetting(settings, 'preset', 0, 11), colorCount).colors;
    return source.map(color => color.slice());
  }, [colorCount, customColors, settings]);

  const updateCustomColor = useCallback(updater => {
    const nextColors = ensureCustomColors();
    const idx = Math.min(selectedColor, colorCount - 1);
    nextColors[idx] = updater(nextColors[idx].slice());
    setCustomColors(nextColors);
    setSetting('preset', '11');
  }, [colorCount, ensureCustomColors, selectedColor, setSetting]);

  const onPalette = useCallback(value => {
    setCustomColors(null);
    setSetting('preset', value);
  }, [setSetting]);

  const onCategory = useCallback(nextCategoryId => {
    const category = manifest?.categories?.find(item => item.id === nextCategoryId);
    if (category?.items?.[0]) applyTarget(category.id, category.items[0].id);
  }, [applyTarget, manifest]);

  const onTarget = useCallback(nextTargetId => {
    if (nextTargetId === CURRENT_CONTROLS) {
      setTargetId(CURRENT_CONTROLS);
      return;
    }
    applyTarget(categoryId, nextTargetId);
  }, [applyTarget, categoryId]);

  const onGain = useCallback((key, value) => {
    setGains(current => ({ ...current, [key]: value }));
  }, []);

  const resetBoost = useCallback(() => {
    updateSettings(current => {
      current.projection = '1';
      current.hyp_boost_x = 50;
      current.hyp_boost_y = 50;
      return current;
    });
  }, [updateSettings]);

  const resetView = useCallback(() => {
    rendererRef.current?.resetView();
  }, []);

  const resetClock = useCallback(() => {
    rendererRef.current?.resetClock();
  }, []);

  const startDrawerResize = useCallback(event => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = drawerWidth;
    const onMove = moveEvent => {
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
        style={{ '--drawer-width': `${drawerWidth}px` }}
        aria-label="Control graph"
      >
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
        <Suspense fallback={<div className="control-flow-shell loading-flow">Loading graph</div>}>
          <ControlGraph
            manifest={manifest}
            activeCategory={activeCategory}
            categoryId={categoryId}
            targetId={targetId}
            currentValue={CURRENT_CONTROLS}
            settings={settings}
            palette={palette}
            colorCount={colorCount}
            selectedColor={selectedColor}
            selectedColorValue={selectedColorValue}
            seedOptions={seedOptions}
            maxGeneration={maxGeneration}
            audio={audio}
            gains={gains}
            tiles={patch?.tiles.length ?? 0}
            loading={loading}
            gamut={displayGamutLabel()}
            onCategory={onCategory}
            onTarget={onTarget}
            onFamily={setFamily}
            onSetting={setSetting}
            onPalette={onPalette}
            onSelectedColor={setSelectedColor}
            onCustomColor={updateCustomColor}
            onGain={onGain}
            onResetBoost={resetBoost}
            onResetClock={resetClock}
            onResetView={resetView}
          />
        </Suspense>
      </aside>
    </>
  );
}
