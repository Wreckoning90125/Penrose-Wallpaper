import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  Panel,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import { Clock, Mic, Pause, Play, RotateCcw, SkipBack, Square, Upload } from 'lucide-react';
import { FAMILIES, familyByValue, seedLabel } from '../tiling/families.js';
import { MAX_COLORS, oklchCss, oklchToLinearSrgb } from '../color/palette.js';
import { intSetting } from '../settings/androidSettings.js';

const PALETTE_NAMES = [
  'B&W',
  'Greys',
  'Prism',
  'Paper',
  'Gold',
  'Rust',
  'Plum',
  'Cobalt',
  'Sage',
  'Spectra',
  'Girih',
  'Custom',
];

const MATERIAL_CONTROLS = [
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

const LIGHT_CONTROLS = [
  ['light_angle', 'Angle', 0, 360, 1],
  ['light_elevation', 'Elevation', 0, 90, 1],
  ['light_intensity', 'Intensity', 0, 200, 1],
  ['light_warmth', 'Warmth', 0, 100, 1],
  ['light_ambient', 'Ambient', 0, 100, 1],
];

const PROJECTION_CONTROLS = [
  ['hyp_scale', 'Scale', 0, 100, 1],
  ['hyp_boost_x', 'Boost X', 0, 100, 1],
  ['hyp_boost_y', 'Boost Y', 0, 100, 1],
  ['hyp_fill_subdiv', 'Fill subdiv', 1, 8, 1],
  ['hyp_border_subdiv', 'Edge subdiv', 1, 32, 1],
];

const CLOCK_CONTROLS = [
  ['clock_rate', 'Rate', 0, 240, 1],
];

const POSTFX_CONTROLS = [
  ['brightness', 'Brightness', 40, 180, 1],
  ['depth_amount', 'Depth drive', 0, 100, 1],
  ['ripple_amount', 'Ripple', 0, 100, 1],
  ['ripple_speed', 'Ripple speed', 0, 200, 1],
];

const GAIN_CONTROLS = [
  ['relief', 'Relief'],
  ['emissive', 'Glow'],
  ['film', 'Film'],
  ['metal', 'Metal'],
];

function Inlet({ id = 'in' }) {
  return <Handle id={id} type="target" position={Position.Left} />;
}

function Outlet({ id = 'out' }) {
  return <Handle id={id} type="source" position={Position.Right} />;
}

function NodeFrame({ children, kind, title, wide = false }) {
  return (
    <div className={`flow-node control-node node-kind-${kind}${wide ? ' wide-node' : ''}`}>
      <div className="flow-node-title">
        <strong>{title}</strong>
      </div>
      {children}
    </div>
  );
}

function RangeControl({ label, value, min, max, step, digits = 0, onChange }) {
  const display = digits > 0 ? Number(value).toFixed(digits) : String(Math.round(Number(value)));
  return (
    <label className="range-row nodrag nowheel">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
      />
      <output>{display}</output>
    </label>
  );
}

function Meter({ label, value }) {
  return (
    <div className="meter-row">
      <span>{label}</span>
      <div className="meter-track">
        <i style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
      </div>
    </div>
  );
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

const AtlasNode = memo(function AtlasNode({ data }) {
  return (
    <NodeFrame title="Curated renders" kind="source" wide>
      <Outlet />
      <div className="control-grid">
        <label className="nodrag nowheel">
          <span>Category</span>
          <select value={data.categoryId} onChange={event => data.onCategory(event.target.value)}>
            {data.categories.map(category => (
              <option key={category.id} value={category.id}>{category.label}</option>
            ))}
          </select>
        </label>
        <label className="nodrag nowheel">
          <span>Render</span>
          <select value={data.targetId} onChange={event => data.onTarget(event.target.value)}>
            {data.targetId === data.currentValue ? <option value={data.currentValue}>Current graph controls</option> : null}
            {data.items.map(item => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
      </div>
    </NodeFrame>
  );
});

const TilingNode = memo(function TilingNode({ data }) {
  const family = familyByValue(data.settings.family);
  return (
    <NodeFrame title="Tiling source" kind="source" wide>
      <Inlet />
      <Outlet />
      <div className="node-subtitle">{family.label} / {seedLabel(data.settings.family, data.settings.seed)}</div>
      <div className="control-grid">
        <label className="nodrag nowheel">
          <span>Family</span>
          <select value={String(data.settings.family)} onChange={event => data.onFamily(event.target.value)}>
            {FAMILIES.map(item => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="nodrag nowheel">
          <span>Seed</span>
          <select value={String(data.settings.seed)} onChange={event => data.onSetting('seed', event.target.value)}>
            {data.seedOptions.map(item => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <RangeControl
          label="Generation"
          value={Number(data.settings.generation)}
          min={0}
          max={data.maxGeneration}
          step={1}
          onChange={value => data.onSetting('generation', value)}
        />
      </div>
    </NodeFrame>
  );
});

const PaletteNode = memo(function PaletteNode({ data }) {
  const wheelRef = useRef(null);
  const selected = data.selectedColorValue;

  useEffect(() => {
    drawWheel(wheelRef.current, selected);
  }, [selected]);

  const applyWheel = event => {
    const canvas = wheelRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * 2 - 1;
    const y = (event.clientY - rect.top) / rect.height * 2 - 1;
    const radius = Math.min(1, Math.hypot(x, y));
    const hue = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    data.onCustomColor(color => [color[0], radius * 0.37, hue]);
  };

  return (
    <NodeFrame title="Color mapper" kind="color" wide>
      <Inlet />
      <Outlet />
      <div className="control-grid two-col">
        <label className="nodrag nowheel">
          <span>Palette</span>
          <select value={String(data.settings.preset)} onChange={event => data.onPalette(event.target.value)}>
            {PALETTE_NAMES.map((name, idx) => (
              <option key={name} value={String(idx)}>{name}</option>
            ))}
          </select>
        </label>
        <RangeControl
          label="Slots"
          value={data.colorCount}
          min={2}
          max={MAX_COLORS}
          step={1}
          onChange={value => data.onSetting('color_count', value)}
        />
      </div>
      <div className="segmented nodrag nowheel">
        {['Type', 'Orient', 'Ring'].map((label, idx) => (
          <button
            key={label}
            type="button"
            className={intSetting(data.settings, 'color_mode', 0, 2) === idx ? 'active' : ''}
            onClick={() => data.onSetting('color_mode', String(idx))}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="swatches nodrag nowheel">
        {data.palette.colors.slice(0, data.colorCount).map((color, idx) => (
          <button
            type="button"
            className={`swatch${idx === data.selectedColor ? ' active' : ''}`}
            style={{ background: oklchCss(color) }}
            title={`Color ${idx + 1}`}
            key={`${idx}-${color.join(':')}`}
            onClick={() => data.onSelectedColor(idx)}
          />
        ))}
      </div>
      <div className="color-editor nodrag nowheel">
        <canvas
          ref={wheelRef}
          id="colorWheel"
          width="220"
          height="220"
          aria-label="OKLCH hue and chroma selector"
          onPointerDown={event => {
            event.currentTarget.setPointerCapture(event.pointerId);
            applyWheel(event);
          }}
          onPointerMove={event => {
            if (event.buttons) applyWheel(event);
          }}
        />
        <RangeControl
          label="Luminance"
          value={selected[0]}
          min={0}
          max={1}
          step={0.001}
          digits={3}
          onChange={value => data.onCustomColor(color => [value, color[1], color[2]])}
        />
        <div className="gamut">{data.gamut}</div>
      </div>
    </NodeFrame>
  );
});

const MaterialNode = memo(function MaterialNode({ data }) {
  return (
    <NodeFrame title="Material" kind="surface" wide>
      <Inlet />
      <Outlet />
      <div className="control-grid two-col">
        {MATERIAL_CONTROLS.map(([key, label, min, max, step]) => (
          <RangeControl
            key={key}
            label={label}
            value={intSetting(data.settings, key, min, max)}
            min={min}
            max={max}
            step={step}
            onChange={value => data.onSetting(key, value)}
          />
        ))}
      </div>
    </NodeFrame>
  );
});

const LightingNode = memo(function LightingNode({ data }) {
  return (
    <NodeFrame title="Lighting" kind="surface" wide>
      <Inlet />
      <Outlet />
      <div className="control-grid two-col">
        {LIGHT_CONTROLS.map(([key, label, min, max, step]) => (
          <RangeControl
            key={key}
            label={label}
            value={intSetting(data.settings, key, min, max)}
            min={min}
            max={max}
            step={step}
            onChange={value => data.onSetting(key, value)}
          />
        ))}
      </div>
    </NodeFrame>
  );
});

const ProjectionNode = memo(function ProjectionNode({ data }) {
  return (
    <NodeFrame title="Projection" kind="geometry" wide>
      <Inlet />
      <Outlet />
      <div className="segmented two nodrag nowheel">
        <button
          type="button"
          className={String(data.settings.projection) === '0' ? 'active' : ''}
          onClick={() => data.onSetting('projection', '0')}
        >
          Euclidean
        </button>
        <button
          type="button"
          className={String(data.settings.projection) === '1' ? 'active' : ''}
          onClick={() => data.onSetting('projection', '1')}
        >
          Poincare disk
        </button>
      </div>
      <div className="control-grid two-col">
        {PROJECTION_CONTROLS.map(([key, label, min, max, step]) => (
          <RangeControl
            key={key}
            label={label}
            value={intSetting(data.settings, key, min, max)}
            min={min}
            max={max}
            step={step}
            onChange={value => data.onSetting(key, value)}
          />
        ))}
      </div>
      <div className="button-row projection-actions nodrag nowheel">
        <button type="button" onClick={data.onResetBoost}>Center boost</button>
        <button type="button" onClick={data.onResetView}>Reset view</button>
      </div>
    </NodeFrame>
  );
});

const ClockNode = memo(function ClockNode({ data }) {
  const enabled = String(data.settings.clock_enabled ?? '1') !== '0';
  return (
    <NodeFrame title="Clock source" kind="signal">
      <Outlet />
      <div className="button-row audio-source-row nodrag nowheel">
        <button type="button" className={enabled ? 'active' : ''} onClick={() => data.onSetting('clock_enabled', enabled ? '0' : '1')}>
          <Clock size={15} />
          {enabled ? 'Running' : 'Paused'}
        </button>
        <button type="button" onClick={data.onResetClock}>
          <RotateCcw size={15} />
          Reset
        </button>
      </div>
      {CLOCK_CONTROLS.map(([key, label, min, max, step]) => (
        <RangeControl
          key={key}
          label={label}
          value={intSetting(data.settings, key, min, max)}
          min={min}
          max={max}
          step={step}
          onChange={value => data.onSetting(key, value)}
        />
      ))}
    </NodeFrame>
  );
});

const AudioNode = memo(function AudioNode({ data }) {
  const transport = data.audio.transport;
  const hasFile = data.audio.status === 'file';
  return (
    <NodeFrame title="Audio transport" kind="signal" wide>
      <Outlet />
      <div className="button-row audio-source-row nodrag nowheel">
        <label className="file-button">
          <Upload size={15} />
          File
          <input type="file" accept="audio/*" onChange={event => data.audio.loadFile(event.target.files?.[0])} />
        </label>
        <button type="button" onClick={data.audio.startMic}><Mic size={15} />Mic</button>
        <button type="button" onClick={data.audio.stop}><Square size={15} />Stop</button>
      </div>
      <div className="transport-row nodrag nowheel">
        <button type="button" disabled={!hasFile} onClick={() => data.audio.seek(0)}><SkipBack size={15} /></button>
        <button type="button" disabled={!hasFile} onClick={transport.playing ? data.audio.pause : data.audio.play}>
          {transport.playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <label className="transport-loop">
          <input
            type="checkbox"
            checked={transport.loop}
            disabled={!hasFile}
            onChange={event => data.audio.setLoop(event.target.checked)}
          />
          Loop
        </label>
      </div>
      <div className="seek-row nodrag nowheel">
        <span>{formatTime(transport.currentTime)}</span>
        <input
          type="range"
          min="0"
          max={Math.max(transport.duration, 0.01)}
          step="0.01"
          value={Math.min(transport.currentTime, Math.max(transport.duration, 0.01))}
          disabled={!hasFile}
          onChange={event => data.audio.seek(Number(event.target.value))}
        />
        <span>{formatTime(transport.duration)}</span>
      </div>
      <div className="audio-status">Source: {data.audio.status}</div>
      <Meter label="Bass" value={data.audio.features.bass} />
      <Meter label="Mid" value={data.audio.features.mid} />
      <Meter label="Treble" value={data.audio.features.treble} />
      <Meter label="Level" value={data.audio.features.level} />
    </NodeFrame>
  );
});

const ModulationNode = memo(function ModulationNode({ data }) {
  return (
    <NodeFrame title="Audio modulation" kind="signal" wide>
      <Inlet />
      <Outlet />
      <div className="control-grid two-col">
        {GAIN_CONTROLS.map(([key, label]) => (
          <RangeControl
            key={key}
            label={label}
            value={data.gains[key]}
            min={0}
            max={1.5}
            step={0.01}
            digits={2}
            onChange={value => data.onGain(key, value)}
          />
        ))}
      </div>
      <Meter label="Relief out" value={data.audio.features.level * data.gains.relief} />
      <Meter label="Glow out" value={data.audio.features.bass * data.gains.emissive} />
      <Meter label="Film out" value={data.audio.features.treble * data.gains.film} />
      <Meter label="Metal out" value={data.audio.features.mid * data.gains.metal} />
    </NodeFrame>
  );
});

const PostFxNode = memo(function PostFxNode({ data }) {
  return (
    <NodeFrame title="Post-FX" kind="surface" wide>
      <Inlet id="clock" />
      <Outlet />
      <div className="control-grid two-col">
        {POSTFX_CONTROLS.map(([key, label, min, max, step]) => (
          <RangeControl
            key={key}
            label={label}
            value={intSetting(data.settings, key, min, max)}
            min={min}
            max={max}
            step={step}
            onChange={value => data.onSetting(key, value)}
          />
        ))}
      </div>
      <div className="segmented nodrag nowheel">
        {['Sine', 'Bands', 'Facet', 'Shell'].map((label, idx) => (
          <button
            key={label}
            type="button"
            className={intSetting(data.settings, 'ripple_kind', 0, 3) === idx ? 'active' : ''}
            onClick={() => data.onSetting('ripple_kind', String(idx))}
          >
            {label}
          </button>
        ))}
      </div>
    </NodeFrame>
  );
});

const RendererNode = memo(function RendererNode({ data }) {
  return (
    <NodeFrame title="Renderer sink" kind="output">
      <Inlet id="geometry" />
      <Inlet id="color" />
      <Inlet id="material" />
      <Inlet id="lighting" />
      <Inlet id="postfx" />
      <div className="render-readout">
        <span>{data.tiles}</span>
        <em>tiles</em>
      </div>
      <div className="node-subtitle">{data.loading || 'WebGPU TSL r184'}</div>
    </NodeFrame>
  );
});

const nodeTypes = {
  atlas: AtlasNode,
  tiling: TilingNode,
  palette: PaletteNode,
  material: MaterialNode,
  lighting: LightingNode,
  projection: ProjectionNode,
  clock: ClockNode,
  audio: AudioNode,
  modulation: ModulationNode,
  postfx: PostFxNode,
  renderer: RendererNode,
};

export function ControlGraph(props) {
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 0.62 });
  const baseNodes = useMemo(() => [
    {
      id: 'atlas',
      type: 'atlas',
      position: { x: 0, y: 0 },
      data: {
        categories: props.manifest?.categories ?? [],
        items: props.activeCategory?.items ?? [],
        categoryId: props.categoryId,
        targetId: props.targetId,
        currentValue: props.currentValue,
        onCategory: props.onCategory,
        onTarget: props.onTarget,
      },
    },
    {
      id: 'tiling',
      type: 'tiling',
      position: { x: 360, y: 0 },
      data: {
        settings: props.settings,
        seedOptions: props.seedOptions,
        maxGeneration: props.maxGeneration,
        onFamily: props.onFamily,
        onSetting: props.onSetting,
      },
    },
    {
      id: 'palette',
      type: 'palette',
      position: { x: 720, y: 0 },
      data: {
        settings: props.settings,
        palette: props.palette,
        colorCount: props.colorCount,
        selectedColor: props.selectedColor,
        selectedColorValue: props.selectedColorValue,
        gamut: props.gamut,
        onPalette: props.onPalette,
        onSetting: props.onSetting,
        onSelectedColor: props.onSelectedColor,
        onCustomColor: props.onCustomColor,
      },
    },
    {
      id: 'projection',
      type: 'projection',
      position: { x: 360, y: 320 },
      data: {
        settings: props.settings,
        onSetting: props.onSetting,
        onResetBoost: props.onResetBoost,
        onResetView: props.onResetView,
      },
    },
    {
      id: 'material',
      type: 'material',
      position: { x: 720, y: 380 },
      data: {
        settings: props.settings,
        onSetting: props.onSetting,
      },
    },
    {
      id: 'lighting',
      type: 'lighting',
      position: { x: 720, y: 820 },
      data: {
        settings: props.settings,
        onSetting: props.onSetting,
      },
    },
    {
      id: 'audio',
      type: 'audio',
      position: { x: 0, y: 620 },
      data: {
        audio: props.audio,
      },
    },
    {
      id: 'clock',
      type: 'clock',
      position: { x: 0, y: 1000 },
      data: {
        settings: props.settings,
        onSetting: props.onSetting,
        onResetClock: props.onResetClock,
      },
    },
    {
      id: 'modulation',
      type: 'modulation',
      position: { x: 360, y: 700 },
      data: {
        audio: props.audio,
        gains: props.gains,
        onGain: props.onGain,
      },
    },
    {
      id: 'postfx',
      type: 'postfx',
      position: { x: 720, y: 1230 },
      data: {
        settings: props.settings,
        onSetting: props.onSetting,
      },
    },
    {
      id: 'renderer',
      type: 'renderer',
      position: { x: 1110, y: 420 },
      data: {
        tiles: props.tiles,
        loading: props.loading,
      },
    },
  ], [
    props.activeCategory,
    props.audio,
    props.categoryId,
    props.colorCount,
    props.currentValue,
    props.gains,
    props.gamut,
    props.loading,
    props.manifest,
    props.maxGeneration,
    props.onCategory,
    props.onCustomColor,
    props.onFamily,
    props.onGain,
    props.onPalette,
    props.onResetBoost,
    props.onResetClock,
    props.onResetView,
    props.onSelectedColor,
    props.onSetting,
    props.onTarget,
    props.palette,
    props.seedOptions,
    props.selectedColor,
    props.selectedColorValue,
    props.settings,
    props.targetId,
    props.tiles,
  ]);

  const initialEdges = useMemo(() => [
    { id: 'atlas-tiling', source: 'atlas', target: 'tiling', animated: true },
    { id: 'tiling-palette', source: 'tiling', target: 'palette', animated: true },
    { id: 'tiling-projection', source: 'tiling', target: 'projection' },
    { id: 'projection-renderer', source: 'projection', target: 'renderer', targetHandle: 'geometry' },
    { id: 'palette-renderer', source: 'palette', target: 'renderer', targetHandle: 'color' },
    { id: 'palette-material', source: 'palette', target: 'material' },
    { id: 'material-renderer', source: 'material', target: 'renderer', targetHandle: 'material' },
    { id: 'lighting-renderer', source: 'lighting', target: 'renderer', targetHandle: 'lighting' },
    { id: 'clock-postfx', source: 'clock', target: 'postfx', targetHandle: 'clock', animated: true },
    { id: 'postfx-renderer', source: 'postfx', target: 'renderer', targetHandle: 'postfx' },
    { id: 'audio-modulation', source: 'audio', target: 'modulation', animated: true },
    { id: 'modulation-material', source: 'modulation', target: 'material', animated: true },
  ], []);
  const [nodes, setNodes, onNodesChange] = useNodesState(baseNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(current => baseNodes.map(node => {
      const existing = current.find(item => item.id === node.id);
      return {
        ...node,
        position: existing?.position ?? node.position,
        selected: existing?.selected ?? false,
      };
    }));
  }, [baseNodes, setNodes]);

  const onConnect = useCallback(connection => {
    setEdges(current => addEdge({ ...connection, animated: true }, current));
  }, [setEdges]);

  const resetLayout = useCallback(() => {
    setNodes(baseNodes);
    setEdges(initialEdges);
    setViewport({ x: 0, y: 0, zoom: 0.62 });
  }, [baseNodes, initialEdges, setEdges, setNodes]);

  return (
    <div className="control-flow-shell">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onConnect={onConnect}
        onEdgesChange={onEdgesChange}
        onNodesChange={onNodesChange}
        viewport={viewport}
        onViewportChange={setViewport}
        nodesDraggable
        nodesConnectable
        elementsSelectable
        panOnDrag={[1, 2]}
        panOnScroll
        panOnScrollMode="free"
        selectionOnDrag
        deleteKeyCode={['Backspace', 'Delete']}
        multiSelectionKeyCode={['Meta', 'Control']}
        selectionKeyCode="Shift"
        zoomActivationKeyCode={null}
        minZoom={0.42}
        maxZoom={1.25}
        proOptions={{ hideAttribution: true }}
      >
        <FitOnce />
        <Panel position="top-left" className="flow-panel">
          <button type="button" onClick={resetLayout}>Reset graph</button>
        </Panel>
        <Background gap={22} size={1} />
        <Controls showInteractive />
      </ReactFlow>
    </div>
  );
}

function FitOnce() {
  const flow = useReactFlow();
  const didFit = useRef(false);
  useEffect(() => {
    if (didFit.current) return;
    didFit.current = true;
    window.requestAnimationFrame(() => {
      flow.fitView({ padding: 0.08 });
    });
  }, [flow]);
  return null;
}

function drawWheel(canvas, selected) {
  if (!canvas || !selected) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const size = canvas.width;
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / (size - 1) * 2 - 1;
      const ny = y / (size - 1) * 2 - 1;
      const radius = Math.hypot(nx, ny);
      const idx = (y * size + x) * 4;
      if (radius > 1) {
        image.data[idx + 3] = 0;
        continue;
      }
      const hue = (Math.atan2(ny, nx) * 180 / Math.PI + 360) % 360;
      const rgb = oklchToRgbBytes([selected[0], radius * 0.37, hue]);
      image.data[idx] = rgb[0];
      image.data[idx + 1] = rgb[1];
      image.data[idx + 2] = rgb[2];
      image.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const markerRadius = selected[1] / 0.37 * size * 0.5;
  const markerAngle = selected[2] * Math.PI / 180;
  ctx.beginPath();
  ctx.arc(
    size * 0.5 + Math.cos(markerAngle) * markerRadius,
    size * 0.5 + Math.sin(markerAngle) * markerRadius,
    6,
    0,
    Math.PI * 2,
  );
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
}

function oklchToRgbBytes(color) {
  return oklchToLinearSrgb(color).map(channel => {
    const v = Math.max(0, Math.min(1, channel));
    const encoded = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
  });
}
