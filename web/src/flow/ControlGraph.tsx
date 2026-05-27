import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, MouseEvent, ReactNode, SetStateAction } from 'react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  addEdge,
  reconnectEdge,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import type { Connection, Edge, Node } from '@xyflow/react';
import { Clock, Mic, Pause, Play, Plus, RotateCcw, SkipBack, Square, Trash2, Upload } from 'lucide-react';
import { FAMILIES, familyByValue, seedLabel } from '../tiling/families';
import { MAX_COLORS, oklchCss, oklchToLinearSrgb } from '../color/palette';
import type { Oklch, Palette } from '../color/palette';
import { intSetting, type SettingKey, type SettingValue, type Settings } from '../settings/androidSettings';
import type { AtlasCategory, AtlasManifest, Gains, WebAudioGraph } from '../types';

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

type ControlSpec = readonly [SettingKey, string, number, number, number];
type GainKey = keyof Gains;
type GainSpec = readonly [GainKey, string];
type OperatorKind = 'gain' | 'bias' | 'clamp' | 'smooth' | 'mix' | 'multiply' | 'add' | 'map' | 'envelope' | 'lag' | 'threshold' | 'invert';
type OperatorSpec = {
  kind: OperatorKind;
  label: string;
  inputs: string[];
  outputs: string[];
  controls: readonly [string, string, number, number, number, number][];
};

const MATERIAL_CONTROLS: ControlSpec[] = [
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

const LIGHT_CONTROLS: ControlSpec[] = [
  ['light_angle', 'Angle', 0, 360, 1],
  ['light_elevation', 'Elevation', 0, 90, 1],
  ['light_intensity', 'Intensity', 0, 200, 1],
  ['light_warmth', 'Warmth', 0, 100, 1],
  ['light_ambient', 'Ambient', 0, 100, 1],
];

const PROJECTION_CONTROLS: ControlSpec[] = [
  ['hyp_scale', 'Scale', 0, 100, 1],
  ['hyp_boost_x', 'Boost X', 0, 100, 1],
  ['hyp_boost_y', 'Boost Y', 0, 100, 1],
  ['hyp_fill_subdiv', 'Fill subdiv', 1, 8, 1],
  ['hyp_border_subdiv', 'Edge subdiv', 1, 32, 1],
];

const CLOCK_CONTROLS: ControlSpec[] = [
  ['clock_rate', 'Rate', 0, 240, 1],
];

const POSTFX_CONTROLS: ControlSpec[] = [
  ['brightness', 'Brightness', 40, 180, 1],
  ['depth_amount', 'Depth drive', 0, 100, 1],
  ['ripple_amount', 'Ripple', 0, 100, 1],
  ['ripple_speed', 'Ripple speed', 0, 200, 1],
];

const GAIN_CONTROLS: GainSpec[] = [
  ['relief', 'Relief'],
  ['emissive', 'Glow'],
  ['film', 'Film'],
  ['metal', 'Metal'],
];

const OPERATOR_LIBRARY: OperatorSpec[] = [
  { kind: 'gain', label: 'Gain', inputs: ['signal'], outputs: ['signal'], controls: [['gain', 'Gain', 0, 4, 0.01, 2]] },
  { kind: 'bias', label: 'Bias', inputs: ['signal'], outputs: ['signal'], controls: [['bias', 'Bias', -2, 2, 0.01, 2]] },
  { kind: 'clamp', label: 'Clamp', inputs: ['signal'], outputs: ['signal'], controls: [['min', 'Min', 0, 1, 0.01, 2], ['max', 'Max', 0, 1, 0.01, 2]] },
  { kind: 'smooth', label: 'Smooth', inputs: ['signal'], outputs: ['signal'], controls: [['amount', 'Amount', 0, 1, 0.01, 2]] },
  { kind: 'mix', label: 'Mix', inputs: ['a', 'b', 'mix'], outputs: ['signal'], controls: [['blend', 'Blend', 0, 1, 0.01, 2]] },
  { kind: 'multiply', label: 'Multiply', inputs: ['a', 'b'], outputs: ['signal'], controls: [['scale', 'Scale', 0, 4, 0.01, 2]] },
  { kind: 'add', label: 'Add', inputs: ['a', 'b'], outputs: ['signal'], controls: [['offset', 'Offset', -2, 2, 0.01, 2]] },
  { kind: 'map', label: 'Map range', inputs: ['signal'], outputs: ['signal'], controls: [['inMin', 'In min', 0, 1, 0.01, 2], ['inMax', 'In max', 0, 1, 0.01, 2], ['outMin', 'Out min', 0, 1, 0.01, 2], ['outMax', 'Out max', 0, 1, 0.01, 2]] },
  { kind: 'envelope', label: 'Envelope', inputs: ['gate'], outputs: ['signal'], controls: [['attack', 'Attack', 0, 2, 0.01, 2], ['release', 'Release', 0, 4, 0.01, 2]] },
  { kind: 'lag', label: 'Lag', inputs: ['signal'], outputs: ['signal'], controls: [['time', 'Time', 0, 2, 0.01, 2]] },
  { kind: 'threshold', label: 'Threshold', inputs: ['signal'], outputs: ['gate'], controls: [['level', 'Level', 0, 1, 0.01, 2]] },
  { kind: 'invert', label: 'Invert', inputs: ['signal'], outputs: ['signal'], controls: [['pivot', 'Pivot', 0, 1, 0.01, 2]] },
];

type ControlGraphProps = {
  manifest: AtlasManifest | null;
  activeCategory: AtlasCategory | null;
  categoryId: string;
  targetId: string;
  currentValue: string;
  settings: Settings;
  palette: Palette;
  colorCount: number;
  selectedColor: number;
  selectedColorValue: Oklch;
  seedOptions: { value: string; label: string }[];
  maxGeneration: number;
  audio: WebAudioGraph;
  gains: Gains;
  tiles: number;
  loading: string;
  gamut: string;
  onCategory: (categoryId: string) => void;
  onTarget: (targetId: string) => void;
  onFamily: (family: string) => void;
  onSetting: (key: SettingKey, value: SettingValue) => void;
  onPalette: (palette: string) => void;
  onSelectedColor: (index: number) => void;
  onCustomColor: (updater: (color: Oklch) => Oklch) => void;
  onGain: (key: GainKey, value: number) => void;
  onResetBoost: () => void;
  onResetClock: () => void;
  onResetView: () => void;
};

type HandleProps = {
  id?: string;
  offset?: number;
};

function Inlet({ id = 'in', offset }: HandleProps) {
  return <Handle id={id} type="target" position={Position.Left} style={offset === undefined ? undefined : { top: `${offset}%` }} />;
}

function Outlet({ id = 'out', offset }: HandleProps) {
  return <Handle id={id} type="source" position={Position.Right} style={offset === undefined ? undefined : { top: `${offset}%` }} />;
}

function portOffset(index: number, total: number): number {
  if (total <= 1) return 50;
  return 22 + index * (56 / Math.max(1, total - 1));
}

type NodeFrameProps = {
  children: ReactNode;
  kind: string;
  title: string;
  wide?: boolean;
  variant?: number;
};

function NodeFrame({ children, kind, title, wide = false, variant = 0 }: NodeFrameProps) {
  return (
    <div className={`flow-node control-node node-kind-${kind} node-variant-${variant}${wide ? ' wide-node' : ''}`}>
      <div className="flow-node-title">
        <strong>{title}</strong>
      </div>
      {children}
    </div>
  );
}

type RangeControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  digits?: number;
  handleId?: string;
  onChange: (value: number) => void;
};

function formatNumber(value: number, digits: number): string {
  return digits > 0 ? Number(value).toFixed(digits) : String(Math.round(Number(value)));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function RangeControl({ label, value, min, max, step, digits = 0, handleId, onChange }: RangeControlProps) {
  const display = formatNumber(value, digits);
  const [draft, setDraft] = useState(display);

  useEffect(() => {
    setDraft(display);
  }, [display]);

  const commit = useCallback(() => {
    const parsed = Number(draft);
    const next = clampNumber(parsed, min, max);
    setDraft(formatNumber(next, digits));
    onChange(next);
  }, [digits, draft, max, min, onChange]);

  return (
    <label className="range-row nodrag nowheel">
      {handleId ? <Handle className="row-handle" id={handleId} type="target" position={Position.Left} /> : null}
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
      />
      <input
        className="number-field"
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onFocus={event => event.currentTarget.select()}
        onKeyDown={event => {
          if (event.key === 'Enter') commit();
        }}
      />
    </label>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="meter-row">
      <span>{label}</span>
      <div className="meter-track">
        <i style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

type AtlasNodeData = {
  categories: AtlasCategory[];
  items: AtlasCategory['items'];
  categoryId: string;
  targetId: string;
  currentValue: string;
  onCategory: (categoryId: string) => void;
  onTarget: (targetId: string) => void;
};

type TilingNodeData = {
  settings: Settings;
  seedOptions: { value: string; label: string }[];
  maxGeneration: number;
  onFamily: (family: string) => void;
  onSetting: (key: SettingKey, value: SettingValue) => void;
};

type PaletteNodeData = {
  settings: Settings;
  palette: Palette;
  colorCount: number;
  selectedColor: number;
  selectedColorValue: Oklch;
  gamut: string;
  onPalette: (palette: string) => void;
  onSetting: (key: SettingKey, value: SettingValue) => void;
  onSelectedColor: (index: number) => void;
  onCustomColor: (updater: (color: Oklch) => Oklch) => void;
};

type SettingsNodeData = {
  settings: Settings;
  onSetting: (key: SettingKey, value: SettingValue) => void;
};

type ProjectionNodeData = SettingsNodeData & {
  onResetBoost: () => void;
  onResetView: () => void;
};

type ClockNodeData = SettingsNodeData & {
  onResetClock: () => void;
};

type AudioTransportNodeData = {
  audio: WebAudioGraph;
};

type AudioAnalysisNodeData = {
  audio: WebAudioGraph;
};

type ModulationNodeData = {
  audio: WebAudioGraph;
  gains: Gains;
  onGain: (key: GainKey, value: number) => void;
};

type OperatorNodeData = {
  id: string;
  spec: OperatorSpec;
  values: Record<string, number>;
};

type RendererNodeData = {
  tiles: number;
  loading: string;
};

type NodeComponentProps<TData> = {
  data: TData;
};

type FlowSelection = {
  nodes: Node[];
  edges: Edge[];
};

type MiddleZoomState = {
  y: number;
  zoom: number;
} | null;

type WheelPointer = {
  clientX: number;
  clientY: number;
};

const GRID_SIZE = 24;
const LAYOUT_COLUMN_GAP = 96;
const LAYOUT_ROW_GAP = 84;
const MIN_FLOW_ZOOM = 0.18;
const MAX_FLOW_ZOOM = 1.25;
const LAYOUT_ROWS: readonly string[][] = [
  ['atlas', 'tiling', 'palette', 'renderer'],
  ['transport', 'analysis', 'projection', 'material'],
  ['clock', 'operator-invert-1', 'drive', 'lighting', 'postfx'],
];
const PROTECTED_NODE_IDS = new Set([
  'atlas',
  'tiling',
  'palette',
  'projection',
  'material',
  'lighting',
  'transport',
  'analysis',
  'drive',
  'clock',
  'postfx',
  'renderer',
]);

function snapValue(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function clampFlowZoom(value: number): number {
  return Math.max(MIN_FLOW_ZOOM, Math.min(MAX_FLOW_ZOOM, value));
}

function measuredWidth(node: Node): number {
  return node.measured?.width ?? node.width ?? 320;
}

function measuredHeight(node: Node): number {
  return node.measured?.height ?? node.height ?? 240;
}

function layoutRowsForNodes(nodes: readonly Node[]): string[][] {
  const nodeIds = new Set(nodes.map(node => node.id));
  const rows = LAYOUT_ROWS.map(row => row.filter(id => nodeIds.has(id))).filter(row => row.length > 0);
  const placed = new Set(rows.flat());
  const pending = nodes.map(node => node.id).filter(id => !placed.has(id));
  for (let i = 0; i < pending.length; i += 4) {
    rows.push(pending.slice(i, i + 4));
  }
  return rows;
}

function measuredLayoutPositions(nodes: readonly Node[]): Map<string, { x: number; y: number }> {
  const rows = layoutRowsForNodes(nodes);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const columnCount = rows.reduce((count, row) => Math.max(count, row.length), 0);
  const columnWidths: number[] = Array.from({ length: columnCount }, () => 0);
  const rowHeights: number[] = Array.from({ length: rows.length }, () => 0);

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const id = row[columnIndex];
      const node = id ? byId.get(id) : undefined;
      if (!node) continue;
      columnWidths[columnIndex] = Math.max(columnWidths[columnIndex] ?? 0, measuredWidth(node));
      rowHeights[rowIndex] = Math.max(rowHeights[rowIndex] ?? 0, measuredHeight(node));
    }
  }

  const columnX: number[] = [];
  let x = 0;
  for (const width of columnWidths) {
    columnX.push(snapValue(x));
    x += snapValue(width + LAYOUT_COLUMN_GAP);
  }

  const rowY: number[] = [];
  let y = 0;
  for (const height of rowHeights) {
    rowY.push(snapValue(y));
    y += snapValue(height + LAYOUT_ROW_GAP);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const id = row[columnIndex];
      if (!id) continue;
      positions.set(id, {
        x: columnX[columnIndex] ?? 0,
        y: rowY[rowIndex] ?? 0,
      });
    }
  }
  return positions;
}

function sameSelection(a: FlowSelection, b: FlowSelection): boolean {
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false;
  for (let i = 0; i < a.nodes.length; i++) {
    if (a.nodes[i]?.id !== b.nodes[i]?.id) return false;
  }
  for (let i = 0; i < a.edges.length; i++) {
    if (a.edges[i]?.id !== b.edges[i]?.id) return false;
  }
  return true;
}

function oklch(l: number, c: number, h: number): Oklch {
  return [l, c, h];
}

const AtlasNode = memo(function AtlasNode({ data }: NodeComponentProps<AtlasNodeData>) {
  return (
    <NodeFrame title="Curated renders" kind="source" wide variant={0}>
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

const TilingNode = memo(function TilingNode({ data }: NodeComponentProps<TilingNodeData>) {
  const family = familyByValue(data.settings.family);
  return (
    <NodeFrame title="Tiling source" kind="source" wide variant={1}>
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
          handleId="generation"
          onChange={value => data.onSetting('generation', value)}
        />
      </div>
    </NodeFrame>
  );
});

const PaletteNode = memo(function PaletteNode({ data }: NodeComponentProps<PaletteNodeData>) {
  const wheelRef = useRef<HTMLCanvasElement | null>(null);
  const selected = data.selectedColorValue;

  useEffect(() => {
    drawWheel(wheelRef.current, selected);
  }, [selected]);

  const applyWheel = (event: WheelPointer) => {
    const canvas = wheelRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * 2 - 1;
    const y = (event.clientY - rect.top) / rect.height * 2 - 1;
    const radius = Math.min(1, Math.hypot(x, y));
    const hue = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    data.onCustomColor(color => oklch(color[0], radius * 0.37, hue));
  };

  return (
    <NodeFrame title="Color mapper" kind="color" wide variant={0}>
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
          handleId="color_count"
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
          handleId="luminance"
          onChange={value => data.onCustomColor(color => oklch(value, color[1], color[2]))}
        />
        <div className="gamut">{data.gamut}</div>
      </div>
    </NodeFrame>
  );
});

const MaterialNode = memo(function MaterialNode({ data }: NodeComponentProps<SettingsNodeData>) {
  return (
    <NodeFrame title="Material" kind="surface" wide variant={0}>
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
            handleId={key}
            onChange={value => data.onSetting(key, value)}
          />
        ))}
      </div>
    </NodeFrame>
  );
});

const LightingNode = memo(function LightingNode({ data }: NodeComponentProps<SettingsNodeData>) {
  return (
    <NodeFrame title="Lighting" kind="surface" wide variant={1}>
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
            handleId={key}
            onChange={value => data.onSetting(key, value)}
          />
        ))}
      </div>
    </NodeFrame>
  );
});

const ProjectionNode = memo(function ProjectionNode({ data }: NodeComponentProps<ProjectionNodeData>) {
  return (
    <NodeFrame title="Projection" kind="geometry" wide variant={0}>
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
            handleId={key}
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

const ClockNode = memo(function ClockNode({ data }: NodeComponentProps<ClockNodeData>) {
  const enabled = String(data.settings.clock_enabled ?? '1') !== '0';
  return (
    <NodeFrame title="Clock source" kind="signal" variant={0}>
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
          handleId={key}
          onChange={value => data.onSetting(key, value)}
        />
      ))}
    </NodeFrame>
  );
});

const AudioTransportNode = memo(function AudioTransportNode({ data }: NodeComponentProps<AudioTransportNodeData>) {
  const transport = data.audio.transport;
  const hasFile = data.audio.status === 'file';
  return (
    <NodeFrame title="Audio transport" kind="signal" wide variant={1}>
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
    </NodeFrame>
  );
});

const AudioAnalysisNode = memo(function AudioAnalysisNode({ data }: NodeComponentProps<AudioAnalysisNodeData>) {
  return (
    <NodeFrame title="Audio analysis" kind="signal" wide variant={2}>
      <Inlet id="transport" />
      {['level', 'bass', 'mid', 'treble', 'beat'].map((id, index, ports) => (
        <Outlet key={id} id={id} offset={portOffset(index, ports.length)} />
      ))}
      <Meter label="Bass" value={data.audio.features.bass} />
      <Meter label="Mid" value={data.audio.features.mid} />
      <Meter label="Treble" value={data.audio.features.treble} />
      <Meter label="Level" value={data.audio.features.level} />
      <Meter label="Beat" value={data.audio.features.beat} />
    </NodeFrame>
  );
});

const TargetDriveNode = memo(function TargetDriveNode({ data }: NodeComponentProps<ModulationNodeData>) {
  return (
    <NodeFrame title="Target drives" kind="operator" wide variant={1}>
      {['level', 'bass', 'mid', 'treble'].map((id, index, ports) => (
        <Inlet key={id} id={id} offset={portOffset(index, ports.length)} />
      ))}
      {['relief', 'glow', 'film', 'metal'].map((id, index, ports) => (
        <Outlet key={id} id={id} offset={portOffset(index, ports.length)} />
      ))}
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
            handleId={key}
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

const OperatorNode = memo(function OperatorNode({ data }: NodeComponentProps<OperatorNodeData>) {
  const [values, setValues] = useState(data.values);

  useEffect(() => {
    setValues(data.values);
  }, [data.values]);

  return (
    <NodeFrame title={data.spec.label} kind="operator" variant={0}>
      {data.spec.inputs.map((input, index, ports) => (
        <Inlet key={input} id={input} offset={portOffset(index, ports.length)} />
      ))}
      {data.spec.outputs.map((output, index, ports) => (
        <Outlet key={output} id={output} offset={portOffset(index, ports.length)} />
      ))}
      <div className="operator-port-list">
        <span>In: {data.spec.inputs.join(', ')}</span>
        <span>Out: {data.spec.outputs.join(', ')}</span>
      </div>
      <div className="control-grid">
        {data.spec.controls.map(([key, label, min, max, step, digits]) => (
          <RangeControl
            key={key}
            label={label}
            value={values[key] ?? min}
            min={min}
            max={max}
            step={step}
            digits={digits}
            handleId={key}
            onChange={value => setValues(current => ({ ...current, [key]: value }))}
          />
        ))}
      </div>
    </NodeFrame>
  );
});

const PostFxNode = memo(function PostFxNode({ data }: NodeComponentProps<SettingsNodeData>) {
  return (
    <NodeFrame title="Post-FX" kind="surface" wide variant={2}>
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
            handleId={key}
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

const RendererNode = memo(function RendererNode({ data }: NodeComponentProps<RendererNodeData>) {
  return (
    <NodeFrame title="Renderer sink" kind="output" variant={0}>
      {['geometry', 'color', 'material', 'lighting', 'postfx'].map((id, index, ports) => (
        <Inlet key={id} id={id} offset={portOffset(index, ports.length)} />
      ))}
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
  transport: AudioTransportNode,
  analysis: AudioAnalysisNode,
  drive: TargetDriveNode,
  operator: OperatorNode,
  postfx: PostFxNode,
  renderer: RendererNode,
};

function operatorSpec(kind: OperatorKind): OperatorSpec {
  const found = OPERATOR_LIBRARY.find(item => item.kind === kind);
  if (found) return found;
  const first = OPERATOR_LIBRARY.find(() => true);
  if (!first) throw new Error('operator library is empty');
  return first;
}

function initialOperatorValues(spec: OperatorSpec): Record<string, number> {
  const values: Record<string, number> = {};
  for (const [key, _label, min, max] of spec.controls) {
    values[key] = key === 'pivot' || key === 'blend' || key === 'level' ? (min + max) / 2 : min;
  }
  return values;
}

function createOperatorNode(id: string, kind: OperatorKind, position: { x: number; y: number }): Node {
  const spec = operatorSpec(kind);
  return {
    id,
    type: 'operator',
    position,
    data: {
      id,
      spec,
      values: initialOperatorValues(spec),
    },
    dragHandle: '.flow-node-title',
  };
}

function readOperatorKind(value: string): OperatorKind {
  const spec = OPERATOR_LIBRARY.find(item => item.kind === value);
  return spec?.kind ?? 'invert';
}

function miniMapColor(type: string): string {
  if (type === 'atlas' || type === 'tiling') return '#b99228';
  if (type === 'palette') return '#c7682e';
  if (type === 'projection') return '#3e83a8';
  if (type === 'material' || type === 'lighting' || type === 'postfx') return '#a66f35';
  if (type === 'transport' || type === 'analysis' || type === 'clock') return '#3a9d75';
  if (type === 'operator' || type === 'drive') return '#7a73c7';
  if (type === 'renderer') return '#8764bc';
  return '#69717e';
}

export function ControlGraph(props: ControlGraphProps) {
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 0.62 });
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [measuredLayoutDone, setMeasuredLayoutDone] = useState(false);
  const [middleZoom, setMiddleZoom] = useState<MiddleZoomState>(null);
  const [operatorKind, setOperatorKind] = useState<OperatorKind>('invert');
  const operatorIdRef = useRef(2);
  const baseNodes = useMemo<Node[]>(() => [
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
      id: 'transport',
      type: 'transport',
      position: { x: 0, y: 620 },
      data: {
        audio: props.audio,
      },
    },
    {
      id: 'analysis',
      type: 'analysis',
      position: { x: 360, y: 620 },
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
      id: 'drive',
      type: 'drive',
      position: { x: 720, y: 1000 },
      data: {
        audio: props.audio,
        gains: props.gains,
        onGain: props.onGain,
      },
    },
    createOperatorNode('operator-invert-1', 'invert', { x: 360, y: 1000 }),
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
  ].map(node => ({ ...node, dragHandle: '.flow-node-title' })), [
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

  const initialEdges = useMemo<Edge[]>(() => [
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
    { id: 'transport-analysis', source: 'transport', target: 'analysis', targetHandle: 'transport', animated: true },
    { id: 'analysis-invert', source: 'analysis', sourceHandle: 'level', target: 'operator-invert-1', targetHandle: 'signal', animated: true },
    { id: 'analysis-drive', source: 'analysis', sourceHandle: 'level', target: 'drive', targetHandle: 'level', animated: true },
    { id: 'invert-postfx', source: 'operator-invert-1', sourceHandle: 'signal', target: 'postfx', targetHandle: 'ripple_amount', animated: true },
    { id: 'drive-emissive', source: 'drive', sourceHandle: 'glow', target: 'material', targetHandle: 'mat_emissive', animated: true },
    { id: 'drive-metal', source: 'drive', sourceHandle: 'metal', target: 'material', targetHandle: 'mat_metalness', animated: true },
    { id: 'drive-depth', source: 'drive', sourceHandle: 'relief', target: 'postfx', targetHandle: 'depth_amount', animated: true },
  ], []);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(baseNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);
  const [selection, setSelection] = useState<FlowSelection>({ nodes: [], edges: [] });

  useEffect(() => {
    const baseIds = new Set(baseNodes.map(node => node.id));
    setNodes(current => {
      const updatedBase = baseNodes.map(node => {
        const existing = current.find(item => item.id === node.id);
        return {
          ...node,
          position: existing?.position ?? node.position,
          selected: existing?.selected ?? false,
        };
      });
      const extra = current.filter(node => !baseIds.has(node.id));
      return [...updatedBase, ...extra];
    });
  }, [baseNodes, setNodes]);

  const onConnect = useCallback((connection: Connection) => {
    setEdges(current => addEdge({ ...connection, animated: true }, current));
  }, [setEdges]);

  const onReconnect = useCallback((oldEdge: Edge, connection: Connection) => {
    setEdges(current => reconnectEdge(oldEdge, connection, current));
  }, [setEdges]);

  const restoreLinks = useCallback(() => {
    const nodeIds = new Set(nodes.map(node => node.id));
    setEdges(initialEdges.filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target)));
    setSelection(current => ({ ...current, edges: [] }));
  }, [initialEdges, nodes, setEdges]);

  const deleteSelectedLinks = useCallback(() => {
    const selectedIds = new Set(selection.edges.map(edge => edge.id));
    if (selectedIds.size === 0) return;
    setEdges(current => current.filter(edge => !selectedIds.has(edge.id)));
    setSelection(current => ({ ...current, edges: [] }));
  }, [selection.edges, setEdges]);

  const addOperatorNode = useCallback(() => {
    const id = `operator-${operatorKind}-${operatorIdRef.current}`;
    operatorIdRef.current += 1;
    const position = {
      x: snapValue((120 - viewport.x) / Math.max(viewport.zoom, MIN_FLOW_ZOOM)),
      y: snapValue((180 - viewport.y) / Math.max(viewport.zoom, MIN_FLOW_ZOOM)),
    };
    setNodes(current => [...current, createOperatorNode(id, operatorKind, position)]);
  }, [operatorKind, setNodes, viewport.x, viewport.y, viewport.zoom]);

  const deleteSelectedNodes = useCallback(() => {
    const selectedIds = new Set(
      selection.nodes
        .filter(node => !PROTECTED_NODE_IDS.has(node.id))
        .map(node => node.id),
    );
    if (selectedIds.size === 0) return;
    setNodes(current => current.filter(node => !selectedIds.has(node.id)));
    setEdges(current => current.filter(edge => !selectedIds.has(edge.source) && !selectedIds.has(edge.target)));
    setSelection({ nodes: [], edges: [] });
  }, [selection.nodes, setEdges, setNodes]);

  const snapCurrentLayout = useCallback(() => {
    setNodes(current => current.map(node => ({
      ...node,
      position: {
        x: snapValue(node.position.x),
        y: snapValue(node.position.y),
      },
    })));
  }, [setNodes]);

  const resetLayout = useCallback(() => {
    setNodes(current => {
      const baseIds = new Set(baseNodes.map(node => node.id));
      const extra = current.filter(node => !baseIds.has(node.id));
      return [...baseNodes, ...extra].map(node => ({ ...node, selected: false }));
    });
    setEdges(current => {
      const nodeIds = new Set(nodes.map(node => node.id));
      for (const node of baseNodes) nodeIds.add(node.id);
      return initialEdges
        .filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target))
        .concat(current.filter(edge => !initialEdges.some(item => item.id === edge.id)));
    });
    setViewport({ x: 0, y: 0, zoom: 0.62 });
    setSelection({ nodes: [], edges: [] });
    setMeasuredLayoutDone(false);
  }, [baseNodes, initialEdges, nodes, setEdges, setNodes]);

  const onSelectionChange = useCallback((params: FlowSelection) => {
    setSelection(current => sameSelection(current, params) ? current : params);
  }, []);

  const markMeasuredLayoutDone = useCallback(() => {
    setMeasuredLayoutDone(true);
  }, []);

  const startMiddleZoom = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    setMiddleZoom({ y: event.clientY, zoom: viewport.zoom });
  }, [viewport.zoom]);

  useEffect(() => {
    if (!middleZoom) return;
    const move = (event: globalThis.MouseEvent) => {
      event.preventDefault();
      const delta = (middleZoom.y - event.clientY) * 0.004;
      const zoom = clampFlowZoom(middleZoom.zoom * Math.exp(delta));
      setViewport(current => ({ ...current, zoom }));
    };
    const end = () => setMiddleZoom(null);
    window.addEventListener('mousemove', move, { passive: false });
    window.addEventListener('mouseup', end);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
    };
  }, [middleZoom]);

  return (
    <div className="control-flow-shell" onMouseDownCapture={startMiddleZoom} onAuxClickCapture={startMiddleZoom}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onEdgesChange={onEdgesChange}
        onNodesChange={onNodesChange}
        onSelectionChange={onSelectionChange}
        viewport={viewport}
        onViewportChange={setViewport}
        nodesDraggable
        nodesConnectable
        connectOnClick
        edgesReconnectable
        elementsSelectable
        nodeDragThreshold={2}
        paneClickDistance={4}
        panOnDrag
        panOnScroll={false}
        selectionOnDrag={false}
        zoomOnScroll
        zoomOnPinch
        deleteKeyCode={['Backspace', 'Delete']}
        multiSelectionKeyCode={['Meta', 'Control']}
        selectionKeyCode="Shift"
        zoomActivationKeyCode={null}
        snapToGrid={snapEnabled}
        snapGrid={[GRID_SIZE, GRID_SIZE]}
        minZoom={MIN_FLOW_ZOOM}
        maxZoom={MAX_FLOW_ZOOM}
        proOptions={{ hideAttribution: true }}
      >
        <FitOnce />
        <MeasuredLayout
          enabled={!measuredLayoutDone}
          onDone={markMeasuredLayoutDone}
          setNodes={setNodes}
        />
        <Panel position="top-left" className="flow-panel">
          <button type="button" onClick={resetLayout}>Reset graph</button>
          <FlowFitButton />
          <button type="button" className={snapEnabled ? 'active' : ''} onClick={() => setSnapEnabled(value => !value)}>
            Snap {snapEnabled ? 'on' : 'off'}
          </button>
          <button type="button" onClick={snapCurrentLayout}>Snap now</button>
          <button type="button" onClick={restoreLinks}>Restore links</button>
          <button type="button" onClick={deleteSelectedLinks} disabled={selection.edges.length === 0}>Delete link</button>
          <label className="operator-picker nodrag nowheel">
            <span>Node</span>
            <select value={operatorKind} onChange={event => setOperatorKind(readOperatorKind(event.target.value))}>
              {OPERATOR_LIBRARY.map(item => (
                <option key={item.kind} value={item.kind}>{item.label}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={addOperatorNode}><Plus size={14} />Add</button>
          <button type="button" onClick={deleteSelectedNodes} disabled={selection.nodes.every(node => PROTECTED_NODE_IDS.has(node.id))}>
            <Trash2 size={14} />Delete node
          </button>
        </Panel>
        <Background gap={22} size={1} />
        <Controls showInteractive />
        <MiniMap pannable zoomable nodeColor={node => miniMapColor(String(node.type ?? ''))} />
      </ReactFlow>
    </div>
  );
}

type MeasuredLayoutProps = {
  enabled: boolean;
  onDone: () => void;
  setNodes: Dispatch<SetStateAction<Node[]>>;
};

function MeasuredLayout({ enabled, onDone, setNodes }: MeasuredLayoutProps) {
  const nodesReady = useNodesInitialized();
  const flow = useReactFlow();
  const applied = useRef(false);

  useEffect(() => {
    if (!enabled) applied.current = false;
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !nodesReady || applied.current) return;
    applied.current = true;
    onDone();
    const currentNodes = flow.getNodes();
    const nextPositions = measuredLayoutPositions(currentNodes);
    setNodes(nodes => {
      return nodes.map(node => ({
        ...node,
        position: nextPositions.get(node.id) ?? node.position,
      }));
    });
    window.requestAnimationFrame(() => {
      flow.fitView({ padding: 0.08, duration: 160 });
    });
  }, [enabled, flow, nodesReady, onDone, setNodes]);

  return null;
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

function FlowFitButton() {
  const flow = useReactFlow();
  const fit = useCallback(() => {
    flow.fitView({ padding: 0.08, duration: 180 });
  }, [flow]);
  return <button type="button" onClick={fit}>Fit</button>;
}

function drawWheel(canvas: HTMLCanvasElement | null, selected: Oklch) {
  if (!canvas || !selected) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
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

function encodeSrgbByte(channel: number): number {
    const v = Math.max(0, Math.min(1, channel));
    const encoded = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
}

function oklchToRgbBytes(color: Oklch): [number, number, number] {
  const rgb = oklchToLinearSrgb(color);
  return [encodeSrgbByte(rgb[0]), encodeSrgbByte(rgb[1]), encodeSrgbByte(rgb[2])];
}
