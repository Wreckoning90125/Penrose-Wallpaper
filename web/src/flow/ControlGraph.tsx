import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, Dispatch, MouseEvent, SetStateAction } from 'react';
import {
  Background,
  ControlButton,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  addEdge,
  reconnectEdge,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import type { Connection, Edge, Node, OnBeforeDelete } from '@xyflow/react';
import {
  Activity,
  AlignStartVertical,
  Aperture,
  Box,
  CircleDot,
  Coffee,
  Contrast,
  Droplet,
  Film,
  Grid2x2,
  Grid3x3,
  History,
  Layers,
  Link2,
  Lock,
  Maximize2,
  PenLine,
  Plus,
  Repeat,
  RotateCcw,
  Save,
  Shuffle,
  Sparkles,
  Spline,
  Sun,
  Unlink,
  Upload,
  Zap,
} from 'lucide-react';
import { EFFECT_CATALOG, fxParamDefaults, fxSelectDefaults, isFxKind } from '../render/postFxCatalog';
import { isSignalSource, isSignalTarget } from './signalUtils';
import {
  evaluateSignals,
  fxModulatedParams,
  modulationsFromSignals,
  type AudioOperatorRuntimeState,
  type LiveOperatorData,
  type LiveOperatorDataMap,
} from './signalEval';
import { renderInputsFromEdges } from './renderInputs';
import { dataBoolean, dataObject, dataString, numberRecordFromObject, stringRecordFromObject } from './nodeData';
import {
  MATH_IDENTITY,
  OPERATOR_LIBRARY,
  operatorSpec,
  type OperatorKind,
  type OperatorSpec,
} from './operatorSpecs';
import {
  GRID_SIZE,
  MAX_FLOW_ZOOM,
  MIN_FLOW_ZOOM,
  clampFlowZoom,
  snapValue,
  type FlowFitMetrics,
} from './flowLayout';
import {
  alignedViewportForNodes,
  allNodesMeasured,
  applyAlignedFlowFit,
  layoutAdvanceHeight,
  measuredLayoutPositions,
  measuredLayoutSignature,
} from './graphLayout';
import {
  AtlasNode,
  AudioAnalysisNode,
  AudioTransportNode,
  ClockNode,
  DisplayNode,
  EdgeProfileNode,
  FxNode,
  LightingNode,
  MaterialNode,
  OperatorNode,
  PaletteNode,
  ProjectionNode,
  RendererNode,
  RippleTargetNode,
  TilingNode,
} from './graphNodes';
import { edgeTypes, nodeColor, type GradientEdgeModel } from './graphEdges';
import type { EditCallbacks, OperatorNodeData } from './graphNodeData';
import {
  edgeFromPreset,
  graphPresetFromState,
  graphPresetFromText,
  graphPresetSettingsFromSettings,
  isGainKey,
  isObsoletePipelineEdge,
  nodeWithPresetData,
  type GainKey,
  type GraphPreset,
} from './graphPreset';
import {
  CLOCK_SETTING_KEYS,
  BORDER_SETTING_KEYS,
  LIGHT_SETTING_KEYS,
  MATERIAL_SETTING_KEYS,
  PALETTE_SETTING_KEYS,
  PROJECTION_SETTING_KEYS,
  RIPPLE_TARGET_SETTING_KEYS,
  TILING_SETTING_KEYS,
} from './settingKeys';
import type { Oklch, Palette } from '../color/palette';
import type { SettingKey, SettingValue, Settings } from '../settings/androidSettings';
import type {
  AtlasCategory,
  AtlasManifest,
  AudioModulationValues,
  DragMode,
  Gains,
  GraphPresetAppState,
  LiveBoostStore,
  PostChainSpec,
  RenderInputs,
  WebAudioGraph,
} from '../types';


type AddMenuCategory = 'sources' | 'operators' | 'effects' | null;
type AddCategorySpec = {
  id: Exclude<AddMenuCategory, null>;
  label: string;
};




const ADD_CATEGORIES: AddCategorySpec[] = [
  { id: 'sources', label: 'Sources' },
  { id: 'operators', label: 'Operators' },
  { id: 'effects', label: 'Effects' },
];

const FX_ICONS: Record<string, typeof Box> = {
  Grid2x2, Layers, Film, Shuffle, PenLine, History, Sparkles, Contrast, CircleDot,
  Aperture, Coffee, Sun, Droplet, Zap, Spline, Repeat,
};

type DefaultGainOperator = {
  gainKey: GainKey;
  id: string;
  label: string;
  position: { x: number; y: number };
};

const DEFAULT_GAIN_OPERATORS: readonly DefaultGainOperator[] = [
  { id: 'operator-gain-metal', gainKey: 'metal', label: 'Gain', position: { x: 720, y: 760 } },
  { id: 'operator-gain-film', gainKey: 'film', label: 'Gain', position: { x: 720, y: 940 } },
  { id: 'operator-gain-glow', gainKey: 'emissive', label: 'Gain', position: { x: 720, y: 1120 } },
  { id: 'operator-gain-relief', gainKey: 'relief', label: 'Gain', position: { x: 720, y: 1300 } },
];

type ControlGraphProps = {
  manifest: AtlasManifest | null;
  activeCategory: AtlasCategory | null;
  categoryId: string;
  targetId: string;
  currentValue: string;
  settings: Settings;
  liveBoostStore: LiveBoostStore;
  palette: Palette;
  colorCount: number;
  selectedColor: number;
  selectedColorValue: Oklch;
  seedOptions: { value: string; label: string }[];
  maxGeneration: number;
  audio: WebAudioGraph;
  customColors: Oklch[] | null;
  gains: Gains;
  dragMode: DragMode;
  tiles: number;
  loading: string;
  gamut: string;
  onCategory: (categoryId: string) => void;
  onTarget: (targetId: string) => void;
  onFamily: (family: string) => void;
  onSetting: (key: SettingKey, value: SettingValue) => void;
  onPreviewSetting: (key: SettingKey, value: SettingValue) => void;
  onPalette: (palette: string) => void;
  onSelectedColor: (index: number) => void;
  onCustomColor: (updater: (color: Oklch) => Oklch) => void;
  onGain: (key: GainKey, value: number) => void;
  onAudioModulation: (values: AudioModulationValues) => void;
  onPostChain: (spec: PostChainSpec) => void;
  onRenderInputs: (inputs: RenderInputs) => void;
  onGraphPresetState: (state: GraphPresetAppState) => void;
  onDragMode: (mode: DragMode) => void;
  onBeginEdit: (paramKey: string) => void;
  onEndEdit: (paramKey: string) => void;
  onResetBoost: () => void;
  onResetClock: () => void;
  onResetView: () => void;
};







type FlowSelection = {
  nodes: Node[];
  edges: Edge[];
};


type MiddleZoomState = {
  y: number;
  zoom: number;
} | null;


const NORMALIZE_GRAPH_PRESET_VIEWPORT_ON_SAVE = false;
const PROTECTED_NODE_IDS = new Set([
  'atlas',
  'tiling',
  'palette',
  'projection',
  'material',
  'lighting',
  'edgeProfile',
  'transport',
  'analysis',
  'clock',
  'postfx',
  'renderer',
  'tonemap',
  'display',
]);
const DELETABLE_BASE_NODE_IDS = new Set([
  'operator-gain-glow',
  'operator-gain-metal',
  'operator-gain-film',
  'operator-invert-1',
  'operator-gain-relief',
]);






type GraphConnectionLike = {
  source: string | null;
  sourceHandle?: string | null;
  target: string | null;
  targetHandle?: string | null;
};

function nodeById(nodes: readonly Node[], id: string | null): Node | null {
  if (!id) return null;
  return nodes.find(node => node.id === id) ?? null;
}

function isValidGraphConnection(connection: GraphConnectionLike, nodes: readonly Node[]): boolean {
  const source = nodeById(nodes, connection.source);
  const target = nodeById(nodes, connection.target);
  const sourceHandle = connection.sourceHandle ?? null;
  const targetHandle = connection.targetHandle ?? null;
  if (!source || !target || source.id === target.id || !sourceHandle || !targetHandle) return false;

  if (source.id === 'atlas') return sourceHandle === 'out' && target.id === 'tiling' && targetHandle === 'in';
  if (source.id === 'tiling') return sourceHandle === 'out' && target.id === 'projection' && targetHandle === 'in';
  if (source.id === 'projection') return sourceHandle === 'out' && target.id === 'palette' && targetHandle === 'in';
  if (source.id === 'palette') return sourceHandle === 'color' && target.id === 'material' && targetHandle === 'color';
  if (source.id === 'material') return sourceHandle === 'surface' && target.id === 'renderer' && targetHandle === 'surface';
  if (source.id === 'lighting') return sourceHandle === 'out' && target.id === 'renderer' && targetHandle === 'lighting';
  if (source.id === 'transport') return sourceHandle === 'out' && target.id === 'analysis' && targetHandle === 'transport';

  if (sourceHandle === 'frame' && targetHandle === 'frame') {
    const sourceIsFrame = source.id === 'renderer' || source.type === 'fx';
    const targetIsFrame = target.id === 'display' || target.type === 'fx';
    return sourceIsFrame && targetIsFrame;
  }

  return isSignalSource(source, sourceHandle) && isSignalTarget(target, targetHandle);
}

// True only when a complete path exists from the geometry source to the display
// sink: atlas -> tiling -> projection -> palette -> material -> renderer (scene
// pass) -> frame chain -> display. Cut one link and the mesh stops reaching the
// sink, so the renderer hides it (the tiling disappears).
// Walk the actual frame wires backward from the Display sink toward the Scene
// source. The chain is the FX nodes physically on that path — and it is only a
// valid chain if the walk reaches the renderer (the scene source). A frame
// inlet left dangling, or a reroute that skips the renderer, yields [] — so a
// node only contributes when it is genuinely on the wire path from source to
// sink, never by merely existing. toneMap obeys this rule like every FX node.
function derivePostChain(nodes: readonly Node[], edges: readonly Edge[]): PostChainSpec {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const incomingFrame = (id: string): Edge | undefined =>
    edges.find(edge => edge.target === id && edge.targetHandle === 'frame');
  const chain: PostChainSpec = [];
  const seen = new Set<string>();
  let cursor = incomingFrame('display')?.source;
  for (let i = 0; i < 64 && cursor && !seen.has(cursor); i += 1) {
    if (cursor === 'renderer') return chain.reverse();
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node || node.type !== 'fx') break;
    const values = numberRecordFromObject(dataObject(node.data, 'values'));
    chain.push({
      id: node.id,
      kind: dataString(node.data, 'kind'),
      bypass: dataBoolean(node.data, 'bypass'),
      params: values,
      selects: stringRecordFromObject(dataObject(node.data, 'selects')),
    });
    cursor = incomingFrame(node.id)?.source;
  }
  return [];
}

function liveOperatorDataFromNode(node: Node): LiveOperatorData | null {
  if (node.type !== 'operator') return null;
  return {
    selectValues: stringRecordFromObject(dataObject(node.data, 'selectValues')),
    values: numberRecordFromObject(dataObject(node.data, 'values')),
  };
}

function liveOperatorDataFromNodes(nodes: readonly Node[]): LiveOperatorDataMap {
  const out: LiveOperatorDataMap = {};
  for (const node of nodes) {
    const data = liveOperatorDataFromNode(node);
    if (data) out[node.id] = data;
  }
  return out;
}

function graphPresetAppStateFromProps(props: ControlGraphProps): GraphPresetAppState {
  return {
    categoryId: props.categoryId,
    customColors: props.customColors ? props.customColors.map((color): Oklch => [color[0], color[1], color[2]]) : null,
    dragMode: props.dragMode,
    gains: { ...props.gains },
    selectedColor: props.selectedColor,
    settings: graphPresetSettingsFromSettings(props.settings),
    targetId: props.targetId,
  };
}

function numericSuffix(id: string): number | null {
  const separator = id.lastIndexOf('-');
  if (separator < 0) return null;
  const value = Number(id.slice(separator + 1));
  return Number.isInteger(value) && value >= 0 ? value : null;
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


const nodeTypes = {
  atlas: AtlasNode,
  tiling: TilingNode,
  palette: PaletteNode,
  material: MaterialNode,
  lighting: LightingNode,
  edgeProfile: EdgeProfileNode,
  projection: ProjectionNode,
  clock: ClockNode,
  transport: AudioTransportNode,
  analysis: AudioAnalysisNode,
  operator: OperatorNode,
  postfx: RippleTargetNode,
  fx: FxNode,
  renderer: RendererNode,
  display: DisplayNode,
};


function initialOperatorValues(spec: OperatorSpec): Record<string, number> {
  const values: Record<string, number> = {};
  for (const [key, _label, min, max] of spec.controls) {
    values[key] = key === 'pivot' || key === 'blend' || key === 'threshold' ? (min + max) / 2 : min;
  }
  if (spec.kind === 'gain') values['gain'] = 1;
  if (spec.kind === 'math') values['valB'] = MATH_IDENTITY.multiply;
  return values;
}

function initialOperatorSelectValues(spec: OperatorSpec): Record<string, string> {
  const values: Record<string, string> = {};
  for (const select of spec.selects ?? []) values[select.key] = select.defaultValue;
  return values;
}

function createOperatorNode(
  id: string,
  kind: OperatorKind,
  position: { x: number; y: number },
  editCallbacks: EditCallbacks,
  onOperatorPreview: OperatorNodeData['onOperatorPreview'],
): Node {
  const spec = operatorSpec(kind);
  return {
    id,
    type: 'operator',
    position,
    data: {
      id,
      onBeginEdit: editCallbacks.onBeginEdit,
      onEndEdit: editCallbacks.onEndEdit,
      onOperatorPreview,
      spec,
      selectValues: initialOperatorSelectValues(spec),
      values: initialOperatorValues(spec),
    },
    dragHandle: '.flow-node-title',
  };
}

function createGainOperatorNode(
  operator: DefaultGainOperator,
  gain: number,
  onGain: (key: GainKey, value: number) => void,
  editCallbacks: EditCallbacks,
  onOperatorPreview: OperatorNodeData['onOperatorPreview'],
): Node {
  const spec = { ...operatorSpec('gain'), label: operator.label };
  return {
    id: operator.id,
    type: 'operator',
    position: operator.position,
    data: {
      gainKey: operator.gainKey,
      id: operator.id,
      onBeginEdit: editCallbacks.onBeginEdit,
      onEndEdit: editCallbacks.onEndEdit,
      onGain,
      onOperatorPreview,
      selectValues: initialOperatorSelectValues(spec),
      spec,
      values: { gain },
    },
    dragHandle: '.flow-node-title',
  };
}

function createClockNode(
  id: string,
  position: { x: number; y: number },
  settings: Settings,
  onSetting: (key: SettingKey, value: SettingValue) => void,
  onPreviewSetting: (key: SettingKey, value: SettingValue) => void,
  onResetClock: () => void,
  editCallbacks: EditCallbacks,
): Node {
  return {
    id,
    type: 'clock',
    position,
    data: {
      id,
      deletable: true,
      settings,
      onBeginEdit: editCallbacks.onBeginEdit,
      onEndEdit: editCallbacks.onEndEdit,
      onSetting,
      onPreviewSetting,
      onResetClock,
    },
    dragHandle: '.flow-node-title',
  };
}


function activeHandles(edges: readonly Edge[], nodeId: string, side: 'source' | 'target'): string[] {
  const seen = new Set<string>();
  const handles: string[] = [];
  for (const edge of edges) {
    const matchesNode = side === 'source' ? edge.source === nodeId : edge.target === nodeId;
    if (!matchesNode) continue;
    const handle = side === 'source' ? edge.sourceHandle : edge.targetHandle;
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    handles.push(handle);
  }
  return handles;
}

function sameStringList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function settingsSignature(settings: Settings, keys: readonly SettingKey[]): string {
  return keys.map(key => `${key}:${String(settings[key])}`).join('|');
}

function editKeyIsIn(paramKey: string | null, keys: readonly SettingKey[]): boolean {
  return paramKey !== null && keys.some(key => key === paramKey);
}



export function ControlGraph(props: ControlGraphProps) {
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 0.62 });
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [layoutRequest, setLayoutRequest] = useState(0);
  const [middleZoom, setMiddleZoom] = useState<MiddleZoomState>(null);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [addMenuCategory, setAddMenuCategory] = useState<AddMenuCategory>(null);
  const [flowChromeTop, setFlowChromeTop] = useState(0);
  const [flowChromeLeft, setFlowChromeLeft] = useState(0);
  const [flowChromeMeasured, setFlowChromeMeasured] = useState(false);
  const [flowSize, setFlowSize] = useState({ height: 0, width: 0 });
  const flowShellRef = useRef<HTMLDivElement | null>(null);
  const flowToolbarRef = useRef<HTMLDivElement | null>(null);
  const graphPresetInputRef = useRef<HTMLInputElement | null>(null);
  const initialAudioRef = useRef(props.audio);
  const initialSettingsRef = useRef(props.settings);
  const initialGainsRef = useRef(props.gains);
  const audioOperatorStateRef = useRef<AudioOperatorRuntimeState>({ held: {}, previous: {}, triggerHigh: {} });
  const liveOperatorDataRef = useRef<LiveOperatorDataMap>({});
  const nodesRef = useRef<readonly Node[]>([]);
  const edgesRef = useRef<readonly Edge[]>([]);
  const addNodeCounterRef = useRef(0);
  const operatorIdRef = useRef(2);
  const fxIdRef = useRef(1);
  const fxValuesRef = useRef<Record<string, Record<string, number>>>({});
  const clockIdRef = useRef(2);
  const activeEditRef = useRef<string | null>(null);
  const [editFlush, setEditFlush] = useState(0);
  const editCallbacks = useMemo<EditCallbacks>(() => ({
    onBeginEdit: (paramKey: string) => {
      activeEditRef.current = paramKey;
      props.onBeginEdit(paramKey);
    },
    onEndEdit: (paramKey: string) => {
      if (activeEditRef.current === paramKey) activeEditRef.current = null;
      props.onEndEdit(paramKey);
      setEditFlush(value => value + 1);
    },
  }), [props.onBeginEdit, props.onEndEdit]);
  const emitAudioGraph = useCallback(() => {
    const features = props.audio.getSnapshot().features;
    const signals = evaluateSignals(features, nodesRef.current, edgesRef.current, audioOperatorStateRef.current, liveOperatorDataRef.current);
    props.onAudioModulation(modulationsFromSignals(signals, edgesRef.current));
    const chain = derivePostChain(nodesRef.current, edgesRef.current).map(node => {
      const flowNode = nodesRef.current.find(item => item.id === node.id);
      if (!flowNode) return node;
      return { ...node, params: fxModulatedParams(flowNode, edgesRef.current, signals, activeEditRef.current, props.dragMode) };
    });
    props.onPostChain(chain);
  }, [props.audio, props.dragMode, props.onAudioModulation, props.onPostChain]);
  const onOperatorPreview = useCallback<NonNullable<OperatorNodeData['onOperatorPreview']>>((id, values, selectValues) => {
    liveOperatorDataRef.current = {
      ...liveOperatorDataRef.current,
      [id]: {
        selectValues: { ...selectValues },
        values: { ...values },
      },
    };
    emitAudioGraph();
  }, [emitAudioGraph]);
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
        settings: initialSettingsRef.current,
        seedOptions: props.seedOptions,
        maxGeneration: props.maxGeneration,
        onBeginEdit: editCallbacks.onBeginEdit,
        onEndEdit: editCallbacks.onEndEdit,
        onFamily: props.onFamily,
        onSetting: props.onSetting,
        onPreviewSetting: props.onPreviewSetting,
      },
    },
    {
      id: 'palette',
      type: 'palette',
      position: { x: 1080, y: 0 },
      data: {
        settings: initialSettingsRef.current,
        palette: props.palette,
        colorCount: props.colorCount,
        selectedColor: props.selectedColor,
        selectedColorValue: props.selectedColorValue,
        gamut: props.gamut,
        onBeginEdit: editCallbacks.onBeginEdit,
        onEndEdit: editCallbacks.onEndEdit,
        onPalette: props.onPalette,
        onSetting: props.onSetting,
        onPreviewSetting: props.onPreviewSetting,
        onSelectedColor: props.onSelectedColor,
        onCustomColor: props.onCustomColor,
      },
    },
    {
      id: 'projection',
      type: 'projection',
      position: { x: 720, y: 0 },
      data: {
        settings: initialSettingsRef.current,
        liveBoostStore: props.liveBoostStore,
        onBeginEdit: editCallbacks.onBeginEdit,
        onEndEdit: editCallbacks.onEndEdit,
        onSetting: props.onSetting,
        onPreviewSetting: props.onPreviewSetting,
        onResetBoost: props.onResetBoost,
        onResetView: props.onResetView,
      },
    },
    {
      id: 'material',
      type: 'material',
      position: { x: 1080, y: 360 },
      data: {
        settings: initialSettingsRef.current,
        onBeginEdit: editCallbacks.onBeginEdit,
        onEndEdit: editCallbacks.onEndEdit,
        onSetting: props.onSetting,
        onPreviewSetting: props.onPreviewSetting,
      },
    },
    {
      id: 'lighting',
      type: 'lighting',
      position: { x: 1080, y: 880 },
      data: {
        settings: initialSettingsRef.current,
        onBeginEdit: editCallbacks.onBeginEdit,
        onEndEdit: editCallbacks.onEndEdit,
        onSetting: props.onSetting,
        onPreviewSetting: props.onPreviewSetting,
      },
    },
    {
      id: 'edgeProfile',
      type: 'edgeProfile',
      position: { x: 1080, y: 1240 },
      data: {
        settings: initialSettingsRef.current,
        onBeginEdit: editCallbacks.onBeginEdit,
        onEndEdit: editCallbacks.onEndEdit,
        onSetting: props.onSetting,
        onPreviewSetting: props.onPreviewSetting,
      },
    },
    {
      id: 'transport',
      type: 'transport',
      position: { x: 0, y: 360 },
      data: {
        audio: initialAudioRef.current,
      },
    },
    {
      id: 'analysis',
      type: 'analysis',
      position: { x: 360, y: 360 },
      data: {
        audio: initialAudioRef.current,
      },
    },
    {
      id: 'clock',
      type: 'clock',
      position: { x: 0, y: 720 },
      data: {
        settings: initialSettingsRef.current,
        onBeginEdit: editCallbacks.onBeginEdit,
        onEndEdit: editCallbacks.onEndEdit,
        onSetting: props.onSetting,
        onPreviewSetting: props.onPreviewSetting,
        onResetClock: props.onResetClock,
      },
    },
    ...DEFAULT_GAIN_OPERATORS.map(operator => createGainOperatorNode(
      operator,
      initialGainsRef.current[operator.gainKey],
      props.onGain,
      editCallbacks,
      onOperatorPreview,
    )),
    createOperatorNode('operator-invert-1', 'invert', { x: 720, y: 360 }, editCallbacks, onOperatorPreview),
    {
      id: 'postfx',
      type: 'postfx',
      position: { x: 1080, y: 720 },
      data: {
        settings: initialSettingsRef.current,
        onBeginEdit: editCallbacks.onBeginEdit,
        onEndEdit: editCallbacks.onEndEdit,
        onSetting: props.onSetting,
        onPreviewSetting: props.onPreviewSetting,
      },
    },
    {
      id: 'renderer',
      type: 'renderer',
      position: { x: 1440, y: 0 },
      data: {
        tiles: props.tiles,
        loading: props.loading,
      },
    },
    {
      id: 'tonemap',
      type: 'fx',
      position: { x: 1440, y: 360 },
      data: {
        id: 'tonemap', kind: 'toneMap', bypass: false, values: {}, selects: {},
        onBeginEdit: editCallbacks.onBeginEdit,
        onEndEdit: editCallbacks.onEndEdit,
      },
    },
    {
      id: 'display',
      type: 'display',
      position: { x: 1440, y: 600 },
      data: {},
    },
  ].map(node => ({ ...node, dragHandle: '.flow-node-title' })), [
    editCallbacks,
    onOperatorPreview,
    props.liveBoostStore,
    props.onGain,
    props.onPreviewSetting,
    props.onResetBoost,
    props.onResetClock,
    props.onResetView,
    props.onSetting,
  ]);

  const initialEdges = useMemo<Edge[]>(() => [
    { id: 'atlas-tiling', source: 'atlas', sourceHandle: 'out', target: 'tiling', targetHandle: 'in', animated: true },
    { id: 'tiling-projection', source: 'tiling', sourceHandle: 'out', target: 'projection', targetHandle: 'in' },
    { id: 'projection-palette', source: 'projection', sourceHandle: 'out', target: 'palette', targetHandle: 'in', animated: true },
    { id: 'palette-material', source: 'palette', sourceHandle: 'color', target: 'material', targetHandle: 'color' },
    { id: 'material-renderer', source: 'material', sourceHandle: 'surface', target: 'renderer', targetHandle: 'surface' },
    { id: 'lighting-renderer', source: 'lighting', sourceHandle: 'out', target: 'renderer', targetHandle: 'lighting' },
    { id: 'postfx-renderer-field', source: 'postfx', sourceHandle: 'field', target: 'renderer', targetHandle: 'field' },
    { id: 'renderer-tonemap', source: 'renderer', sourceHandle: 'frame', target: 'tonemap', targetHandle: 'frame' },
    { id: 'tonemap-display', source: 'tonemap', sourceHandle: 'frame', target: 'display', targetHandle: 'frame' },
    { id: 'transport-analysis', source: 'transport', sourceHandle: 'out', target: 'analysis', targetHandle: 'transport', animated: true },
    { id: 'analysis-invert', source: 'analysis', sourceHandle: 'cwtTransient', target: 'operator-invert-1', targetHandle: 'signal', animated: true },
    { id: 'invert-postfx', source: 'operator-invert-1', sourceHandle: 'signal', target: 'postfx', targetHandle: 'field_relief', animated: true },
    { id: 'analysis-gain-relief', source: 'analysis', sourceHandle: 'cwtTransient', target: 'operator-gain-relief', targetHandle: 'signal', animated: true },
    { id: 'gain-relief-depth', source: 'operator-gain-relief', sourceHandle: 'signal', target: 'postfx', targetHandle: 'field_displace', animated: true },
    { id: 'analysis-gain-glow', source: 'analysis', sourceHandle: 'bass', target: 'operator-gain-glow', targetHandle: 'signal', animated: true },
    { id: 'gain-glow-emissive', source: 'operator-gain-glow', sourceHandle: 'signal', target: 'material', targetHandle: 'mat_emissive', animated: true },
    { id: 'analysis-gain-film', source: 'analysis', sourceHandle: 'spectralFlux', target: 'operator-gain-film', targetHandle: 'signal', animated: true },
    { id: 'gain-film-iridescence', source: 'operator-gain-film', sourceHandle: 'signal', target: 'material', targetHandle: 'mat_iridescence', animated: true },
    { id: 'analysis-gain-metal', source: 'analysis', sourceHandle: 'mid', target: 'operator-gain-metal', targetHandle: 'signal', animated: true },
    { id: 'gain-metal-metalness', source: 'operator-gain-metal', sourceHandle: 'signal', target: 'material', targetHandle: 'mat_metalness', animated: true },
  ], []);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(baseNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);
  const [selection, setSelection] = useState<FlowSelection>({ nodes: [], edges: [] });
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);
  const flowFitMetrics = useMemo<FlowFitMetrics>(() => ({
    chromeLeft: flowChromeLeft,
    chromeTop: flowChromeTop,
    height: flowSize.height,
    width: flowSize.width,
  }), [flowChromeLeft, flowChromeTop, flowSize.height, flowSize.width]);
  const flowFitReady = flowChromeMeasured && flowSize.height > 0 && flowSize.width > 0;
  const nodeColorById = useMemo(() => {
    const colors = new Map<string, string>();
    for (const node of nodes) {
      colors.set(node.id, nodeColor(String(node.type ?? '')));
    }
    return colors;
  }, [nodes]);
  const selectedEdgeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const edge of selection.edges) ids.add(edge.id);
    for (const edge of edges) {
      if (edge.selected) ids.add(edge.id);
    }
    return ids;
  }, [edges, selection.edges]);
  const hasSelectedEdges = selectedEdgeIds.size > 0;
  const displayedEdges = useMemo<GradientEdgeModel[]>(() => {
    const type = 'gradient';
    return edges.map(edge => ({
      ...edge,
      type,
      data: {
        sourceColor: nodeColorById.get(edge.source) ?? nodeColor(''),
        targetColor: nodeColorById.get(edge.target) ?? nodeColor(''),
        selected: selectedEdgeIds.has(edge.id),
        dimmed: hasSelectedEdges && !selectedEdgeIds.has(edge.id),
      },
    }));
  }, [edges, hasSelectedEdges, nodeColorById, selectedEdgeIds]);

  useEffect(() => {
    const baseIds = new Set(baseNodes.map(node => node.id));
    setNodes(current => {
      const updatedBase: Node[] = [];
      for (const node of baseNodes) {
        const existing = current.find(item => item.id === node.id);
        if (!existing && DELETABLE_BASE_NODE_IDS.has(node.id)) continue;
        updatedBase.push({
          ...node,
          data: existing?.data ?? node.data,
          position: existing?.position ?? node.position,
          selected: existing?.selected ?? false,
        });
      }
      const extra = current.filter(node => !baseIds.has(node.id));
      return [...updatedBase, ...extra];
    });
  }, [baseNodes, setNodes]);

  const tilingSettingsKey = settingsSignature(props.settings, TILING_SETTING_KEYS);
  const paletteSettingsKey = settingsSignature(props.settings, PALETTE_SETTING_KEYS);
  const projectionSettingsKey = settingsSignature(props.settings, PROJECTION_SETTING_KEYS);
  const materialSettingsKey = settingsSignature(props.settings, MATERIAL_SETTING_KEYS);
  const lightSettingsKey = settingsSignature(props.settings, LIGHT_SETTING_KEYS);
  const edgeProfileSettingsKey = settingsSignature(props.settings, BORDER_SETTING_KEYS);
  const rippleTargetSettingsKey = settingsSignature(props.settings, RIPPLE_TARGET_SETTING_KEYS);
  const clockSettingsKey = settingsSignature(props.settings, CLOCK_SETTING_KEYS);

  useEffect(() => {
    setNodes(current => current.map(node => node.id === 'atlas'
      ? {
          ...node,
          data: {
            ...node.data,
            categories: props.manifest?.categories ?? [],
            categoryId: props.categoryId,
            currentValue: props.currentValue,
            items: props.activeCategory?.items ?? [],
            onCategory: props.onCategory,
            onTarget: props.onTarget,
            targetId: props.targetId,
          },
        }
      : node));
  }, [
    props.activeCategory,
    props.categoryId,
    props.currentValue,
    props.manifest,
    props.onCategory,
    props.onTarget,
    props.targetId,
    setNodes,
  ]);

  useEffect(() => {
    if (editKeyIsIn(activeEditRef.current, TILING_SETTING_KEYS)) return;
    setNodes(current => current.map(node => node.id === 'tiling'
      ? {
          ...node,
          data: {
            ...node.data,
            maxGeneration: props.maxGeneration,
            onBeginEdit: editCallbacks.onBeginEdit,
            onEndEdit: editCallbacks.onEndEdit,
            onFamily: props.onFamily,
            onSetting: props.onSetting,
            onPreviewSetting: props.onPreviewSetting,
            seedOptions: props.seedOptions,
            settings: props.settings,
          },
        }
      : node));
  }, [
    editCallbacks,
    editFlush,
    props.maxGeneration,
    props.onFamily,
    props.onPreviewSetting,
    props.onSetting,
    props.seedOptions,
    setNodes,
    tilingSettingsKey,
  ]);

  useEffect(() => {
    if (editKeyIsIn(activeEditRef.current, PALETTE_SETTING_KEYS)) return;
    setNodes(current => current.map(node => node.id === 'palette'
      ? {
          ...node,
          data: {
            ...node.data,
            colorCount: props.colorCount,
            gamut: props.gamut,
            onBeginEdit: editCallbacks.onBeginEdit,
            onCustomColor: props.onCustomColor,
            onEndEdit: editCallbacks.onEndEdit,
            onPalette: props.onPalette,
            onSelectedColor: props.onSelectedColor,
            onSetting: props.onSetting,
            onPreviewSetting: props.onPreviewSetting,
            palette: props.palette,
            selectedColor: props.selectedColor,
            selectedColorValue: props.selectedColorValue,
            settings: props.settings,
          },
        }
      : node));
  }, [
    editCallbacks,
    editFlush,
    paletteSettingsKey,
    props.colorCount,
    props.gamut,
    props.onCustomColor,
    props.onPalette,
    props.onPreviewSetting,
    props.onSelectedColor,
    props.onSetting,
    props.palette,
    props.selectedColor,
    props.selectedColorValue,
    setNodes,
  ]);

  useEffect(() => {
    if (editKeyIsIn(activeEditRef.current, PROJECTION_SETTING_KEYS)) return;
    setNodes(current => current.map(node => node.id === 'projection'
      ? {
          ...node,
          data: {
            ...node.data,
            liveBoostStore: props.liveBoostStore,
            onBeginEdit: editCallbacks.onBeginEdit,
            onEndEdit: editCallbacks.onEndEdit,
            onResetBoost: props.onResetBoost,
            onResetView: props.onResetView,
            onSetting: props.onSetting,
            onPreviewSetting: props.onPreviewSetting,
            settings: props.settings,
          },
        }
      : node));
  }, [
    editCallbacks,
    editFlush,
    projectionSettingsKey,
    props.liveBoostStore,
    props.onResetBoost,
    props.onResetView,
    props.onPreviewSetting,
    props.onSetting,
    setNodes,
  ]);

  useEffect(() => {
    if (editKeyIsIn(activeEditRef.current, MATERIAL_SETTING_KEYS)) return;
    setNodes(current => current.map(node => node.id === 'material'
      ? {
          ...node,
          data: {
            ...node.data,
            onBeginEdit: editCallbacks.onBeginEdit,
            onEndEdit: editCallbacks.onEndEdit,
            onSetting: props.onSetting,
            onPreviewSetting: props.onPreviewSetting,
            settings: props.settings,
          },
      }
      : node));
  }, [editCallbacks, editFlush, materialSettingsKey, props.onPreviewSetting, props.onSetting, setNodes]);

  useEffect(() => {
    if (editKeyIsIn(activeEditRef.current, LIGHT_SETTING_KEYS)) return;
    setNodes(current => current.map(node => node.id === 'lighting'
      ? {
          ...node,
          data: {
            ...node.data,
            onBeginEdit: editCallbacks.onBeginEdit,
            onEndEdit: editCallbacks.onEndEdit,
            onSetting: props.onSetting,
            onPreviewSetting: props.onPreviewSetting,
            settings: props.settings,
          },
      }
      : node));
  }, [editCallbacks, editFlush, lightSettingsKey, props.onPreviewSetting, props.onSetting, setNodes]);

  useEffect(() => {
    if (editKeyIsIn(activeEditRef.current, BORDER_SETTING_KEYS)) return;
    setNodes(current => current.map(node => node.id === 'edgeProfile'
      ? {
          ...node,
          data: {
            ...node.data,
            onBeginEdit: editCallbacks.onBeginEdit,
            onEndEdit: editCallbacks.onEndEdit,
            onSetting: props.onSetting,
            onPreviewSetting: props.onPreviewSetting,
            settings: props.settings,
          },
      }
      : node));
  }, [editCallbacks, editFlush, edgeProfileSettingsKey, props.onPreviewSetting, props.onSetting, setNodes]);

  useEffect(() => {
    if (editKeyIsIn(activeEditRef.current, RIPPLE_TARGET_SETTING_KEYS)) return;
    setNodes(current => current.map(node => node.id === 'postfx'
      ? {
          ...node,
          data: {
            ...node.data,
            onBeginEdit: editCallbacks.onBeginEdit,
            onEndEdit: editCallbacks.onEndEdit,
            onSetting: props.onSetting,
            onPreviewSetting: props.onPreviewSetting,
            settings: props.settings,
          },
      }
      : node));
  }, [editCallbacks, editFlush, props.onPreviewSetting, props.onSetting, rippleTargetSettingsKey, setNodes]);

  useEffect(() => {
    setNodes(current => current.map(node => node.id === 'renderer'
      ? {
          ...node,
          data: {
            ...node.data,
            loading: props.loading,
            tiles: props.tiles,
          },
        }
      : node));
  }, [props.loading, props.tiles, setNodes]);

  useEffect(() => {
    if (editKeyIsIn(activeEditRef.current, CLOCK_SETTING_KEYS)) return;
    setNodes(current => current.map(node => node.type === 'clock'
      ? {
          ...node,
          data: {
            ...node.data,
            id: node.id,
            deletable: node.id !== 'clock',
            onBeginEdit: editCallbacks.onBeginEdit,
            onEndEdit: editCallbacks.onEndEdit,
            onResetClock: props.onResetClock,
            onSetting: props.onSetting,
            onPreviewSetting: props.onPreviewSetting,
            settings: props.settings,
          },
        }
      : node));
  }, [
    clockSettingsKey,
    editCallbacks,
    editFlush,
    props.onResetClock,
    props.onPreviewSetting,
    props.onSetting,
    setNodes,
  ]);

  useEffect(() => {
    setNodes(current => current.map(node => node.type === 'operator'
      ? {
          ...node,
          data: {
            ...node.data,
            onBeginEdit: editCallbacks.onBeginEdit,
            onEndEdit: editCallbacks.onEndEdit,
            onGain: props.onGain,
            onOperatorPreview,
          },
      }
      : node));
  }, [editCallbacks, onOperatorPreview, props.onGain, setNodes]);

  useEffect(() => {
    if (activeEditRef.current?.startsWith('gain:')) return;
    setNodes(current => current.map(node => {
      const gainKey = dataString(node.data, 'gainKey');
      if (!isGainKey(gainKey)) return node;
      const currentValues = numberRecordFromObject(dataObject(node.data, 'values'));
      const nextGain = props.gains[gainKey];
      if (currentValues['gain'] === nextGain) return node;
      return {
        ...node,
        data: {
          ...node.data,
          values: { ...currentValues, gain: nextGain },
        },
      };
    }));
  }, [editFlush, props.gains, setNodes]);

  useEffect(() => {
    setNodes(current => current.map(node => {
      if (node.id !== 'transport' && node.id !== 'analysis') return node;
      if (node.data['audio'] === props.audio) return node;
      return {
        ...node,
        data: {
          ...node.data,
          audio: props.audio,
        },
      };
    }));
  }, [props.audio, setNodes]);

  useEffect(() => {
    setNodes(current => current.map(node => {
      const activeInputs = activeHandles(edges, node.id, 'target');
      const activeOutputs = activeHandles(edges, node.id, 'source');
      const previousInputs = Array.isArray(node.data['activeInputs']) ? node.data['activeInputs'].map(String) : [];
      const previousOutputs = Array.isArray(node.data['activeOutputs']) ? node.data['activeOutputs'].map(String) : [];
      if (sameStringList(previousInputs, activeInputs) && sameStringList(previousOutputs, activeOutputs)) {
        return node;
      }
      return {
        ...node,
        data: {
          ...node.data,
          activeInputs,
          activeOutputs,
        },
      };
    }));
  }, [edges, setNodes]);

  useEffect(() => {
    emitAudioGraph();
    return props.audio.subscribe(emitAudioGraph);
  }, [emitAudioGraph, edges, nodes, props.audio]);

  useEffect(() => {
    props.onRenderInputs(renderInputsFromEdges(nodes, edges));
  }, [edges, nodes, props.onRenderInputs]);

  const onConnect = useCallback((connection: Connection) => {
    if (!isValidGraphConnection(connection, nodes)) return;
    setEdges(current => {
      const next = current.filter(edge => !(edge.target === connection.target && edge.targetHandle === connection.targetHandle));
      return addEdge({ ...connection, animated: true }, next);
    });
  }, [nodes, setEdges]);

  const onReconnect = useCallback((oldEdge: Edge, connection: Connection) => {
    if (!isValidGraphConnection(connection, nodes)) return;
    setEdges(current => {
      const withoutTargetConflict = current.filter(edge => (
        edge.id === oldEdge.id || !(edge.target === connection.target && edge.targetHandle === connection.targetHandle)
      ));
      return reconnectEdge(oldEdge, connection, withoutTargetConflict);
    });
  }, [nodes, setEdges]);

  const onBeforeDelete = useCallback<OnBeforeDelete<Node, Edge>>(async ({ nodes: deletingNodes, edges: deletingEdges }) => {
    const deletableNodeIds = new Set(deletingNodes.filter(node => !PROTECTED_NODE_IDS.has(node.id)).map(node => node.id));
    setEdges(current => {
      let next = current;
      for (const id of deletableNodeIds) {
        const inEdge = next.find(edge => edge.target === id && edge.targetHandle === 'frame');
        const outEdge = next.find(edge => edge.source === id && edge.sourceHandle === 'frame');
        if (inEdge && outEdge) {
          next = next.filter(edge => edge !== inEdge && edge !== outEdge);
          next = [...next, {
            id: `${inEdge.source}-${outEdge.target}`,
            source: inEdge.source, sourceHandle: inEdge.sourceHandle ?? null,
            target: outEdge.target, targetHandle: outEdge.targetHandle ?? null, animated: true,
          }];
        }
      }
      return next;
    });
    return {
      nodes: deletingNodes.filter(node => deletableNodeIds.has(node.id)),
      edges: deletingEdges.filter(edge => (
        selectedEdgeIds.has(edge.id)
        || deletableNodeIds.has(edge.source)
        || deletableNodeIds.has(edge.target)
      )),
    };
  }, [selectedEdgeIds, setEdges]);

  const restoreLinks = useCallback(() => {
    const nodeIds = new Set(nodes.map(node => node.id));
    setEdges(initialEdges.filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target)));
    setSelection(current => ({ ...current, edges: [] }));
  }, [initialEdges, nodes, setEdges]);

  const deleteSelectedLinks = useCallback(() => {
    if (selectedEdgeIds.size === 0) return;
    setEdges(current => current.filter(edge => !selectedEdgeIds.has(edge.id)));
    setSelection(current => ({ ...current, edges: [] }));
  }, [selectedEdgeIds, setEdges]);

  const saveGraphPreset = useCallback(() => {
    const savedViewport = NORMALIZE_GRAPH_PRESET_VIEWPORT_ON_SAVE
      ? alignedViewportForNodes(nodes, flowFitMetrics) ?? viewport
      : viewport;
    const preset = graphPresetFromState(nodes, edges, savedViewport, snapEnabled, graphPresetAppStateFromProps(props));
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'penrose-graph-preset.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [edges, flowFitMetrics, nodes, props, snapEnabled, viewport]);

  const applyGraphPreset = useCallback((preset: GraphPreset) => {
    if (preset.appState) props.onGraphPresetState(preset.appState);
    const presetById = new Map(preset.nodes.map(node => [node.id, node]));
    const baseIds = new Set(baseNodes.map(node => node.id));
    const nextNodes: Node[] = [];
    for (const node of baseNodes) {
      const presetNode = presetById.get(node.id);
      if (!presetNode && DELETABLE_BASE_NODE_IDS.has(node.id)) continue;
      nextNodes.push(presetNode ? nodeWithPresetData(node, presetNode) : { ...node, selected: false });
    }
    for (const presetNode of preset.nodes) {
      if (baseIds.has(presetNode.id)) continue;
      let nextNode: Node | null = null;
      if (presetNode.type === 'operator' && presetNode.data.operatorKind) {
        nextNode = createOperatorNode(
          presetNode.id,
          presetNode.data.operatorKind,
          presetNode.position,
          editCallbacks,
          onOperatorPreview,
        );
      }
      if (presetNode.type === 'clock' && presetNode.data.deletableClock) {
        nextNode = createClockNode(
          presetNode.id,
          presetNode.position,
          props.settings,
          props.onSetting,
          props.onPreviewSetting,
          props.onResetClock,
          editCallbacks,
        );
      }
      if (presetNode.type === 'fx' && presetNode.data.fxKind !== null && isFxKind(presetNode.data.fxKind)) {
        const kind = presetNode.data.fxKind;
        nextNode = {
          id: presetNode.id,
          type: 'fx',
          position: presetNode.position,
          dragHandle: '.flow-node-title',
          data: {
            id: presetNode.id,
            kind,
            bypass: false,
            values: fxParamDefaults(kind),
            selects: fxSelectDefaults(kind),
            onBeginEdit: editCallbacks.onBeginEdit,
            onEndEdit: editCallbacks.onEndEdit,
            onFxValue,
            onFxSelect,
            onFxBypass,
          },
        };
      }
      if (nextNode) nextNodes.push(nodeWithPresetData(nextNode, presetNode));
    }

    const nodeIds = new Set(nextNodes.map(node => node.id));
    const nextEdges: Edge[] = [];
    const pushRequiredEdge = (edge: Edge): void => {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return;
      if (!isValidGraphConnection(edge, nextNodes)) return;
      const existingIndex = nextEdges.findIndex(item => item.target === edge.target && item.targetHandle === edge.targetHandle);
      if (existingIndex >= 0) nextEdges.splice(existingIndex, 1);
      nextEdges.push(edge);
    };
    for (const edge of preset.edges) {
      const next = edgeFromPreset(edge);
      if (
        next.source === 'tiling'
        && next.target === 'palette'
      ) {
        continue;
      }
      if (
        next.source === 'projection'
        && next.target === 'renderer'
      ) {
        continue;
      }
      if (
        next.source === 'palette'
        && next.target === 'renderer'
      ) {
        continue;
      }
      if (
        next.source === 'postprocess'
        && next.target === 'renderer'
      ) {
        continue;
      }
      if (
        next.source === 'postfx'
        && next.target === 'renderer'
      ) {
        continue;
      }
      if (
        next.source === 'palette'
        && next.target === 'material'
      ) {
        pushRequiredEdge({ ...next, id: 'palette-material', sourceHandle: 'color', targetHandle: 'color' });
        continue;
      }
      if (
        next.source === 'material'
        && next.target === 'renderer'
      ) {
        pushRequiredEdge({ ...next, id: 'material-renderer', sourceHandle: 'surface', targetHandle: 'surface' });
        continue;
      }
      if (nodeIds.has(next.source) && nodeIds.has(next.target) && isValidGraphConnection(next, nextNodes)) {
        pushRequiredEdge(next);
      }
    }
    liveOperatorDataRef.current = liveOperatorDataFromNodes(nextNodes);
    // Seed the FX value cache for loaded fx nodes, otherwise the first slider
    // drag on a loaded effect (onFxValue merges off this ref) would wipe its
    // other values.
    const nextFxValues: Record<string, Record<string, number>> = {};
    for (const node of nextNodes) {
      if (node.type === 'fx') nextFxValues[node.id] = numberRecordFromObject(dataObject(node.data, 'values'));
    }
    fxValuesRef.current = nextFxValues;
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSnapEnabled(preset.snapEnabled);
    setViewport(preset.viewport);
    setSelection({ nodes: [], edges: [] });

    for (const presetNode of preset.nodes) {
      const gain = presetNode.data.values['gain'];
      if (presetNode.data.gainKey && typeof gain === 'number') {
        props.onGain(presetNode.data.gainKey, gain);
      }
      const suffix = numericSuffix(presetNode.id);
      if (suffix !== null && presetNode.id.startsWith('operator-')) {
        operatorIdRef.current = Math.max(operatorIdRef.current, suffix + 1);
      }
      if (suffix !== null && presetNode.id.startsWith('clock-')) {
        clockIdRef.current = Math.max(clockIdRef.current, suffix + 1);
      }
      if (suffix !== null && presetNode.id.startsWith('fx-')) {
        fxIdRef.current = Math.max(fxIdRef.current, suffix + 1);
      }
    }
  }, [baseNodes, editCallbacks, onOperatorPreview, props, setEdges, setNodes]);

  const loadGraphPresetFile = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    if (!file) return;
    void file.text()
      .then(text => {
        const preset = graphPresetFromText(text);
        if (preset) applyGraphPreset(preset);
      })
      .catch(() => {});
  }, [applyGraphPreset]);

  const nextAddPosition = useCallback(() => {
    const index = addNodeCounterRef.current;
    addNodeCounterRef.current += 1;
    const column = index % 3;
    const row = Math.floor(index / 3);
    return {
      x: snapValue((160 - viewport.x) / Math.max(viewport.zoom, MIN_FLOW_ZOOM) + column * 96),
      y: snapValue((180 - viewport.y) / Math.max(viewport.zoom, MIN_FLOW_ZOOM) + column * 64 + row * 216),
    };
  }, [viewport.x, viewport.y, viewport.zoom]);

  const addOperatorNode = useCallback((kind: OperatorKind) => {
    const id = `operator-${kind}-${operatorIdRef.current}`;
    operatorIdRef.current += 1;
    setNodes(current => [...current, createOperatorNode(id, kind, nextAddPosition(), editCallbacks, onOperatorPreview)]);
    setIsAddMenuOpen(false);
    setAddMenuCategory(null);
  }, [editCallbacks, nextAddPosition, onOperatorPreview, setNodes]);

  const onFxValue = useCallback((id: string, key: string, value: number) => {
    const current = fxValuesRef.current[id] ?? {};
    fxValuesRef.current = { ...fxValuesRef.current, [id]: { ...current, [key]: value } };
    setNodes(nodes => nodes.map(node => node.id === id
      ? { ...node, data: { ...node.data, values: fxValuesRef.current[id] } }
      : node));
  }, [setNodes]);

  const onFxSelect = useCallback((id: string, key: string, value: string) => {
    setNodes(nodes => nodes.map(node => node.id === id
      ? { ...node, data: { ...node.data, selects: { ...stringRecordFromObject(dataObject(node.data, 'selects')), [key]: value } } }
      : node));
  }, [setNodes]);

  const onFxBypass = useCallback((id: string, bypass: boolean) => {
    setNodes(nodes => nodes.map(node => node.id === id
      ? { ...node, data: { ...node.data, bypass } }
      : node));
  }, [setNodes]);

  const addFxNode = useCallback((kind: string) => {
    if (!isFxKind(kind)) return;
    const id = `fx-${kind}-${fxIdRef.current}`;
    fxIdRef.current += 1;
    const values = fxParamDefaults(kind);
    const selects = fxSelectDefaults(kind);
    fxValuesRef.current = { ...fxValuesRef.current, [id]: values };
    const node: Node = {
      id,
      type: 'fx',
      position: nextAddPosition(),
      dragHandle: '.flow-node-title',
      data: {
        id, kind, bypass: false, values, selects,
        onBeginEdit: editCallbacks.onBeginEdit,
        onEndEdit: editCallbacks.onEndEdit,
        onFxValue, onFxSelect, onFxBypass,
      },
    };
    setEdges(current => {
      const incoming = current.find(edge => edge.target === 'tonemap' && edge.targetHandle === 'frame');
      const rest = current.filter(edge => edge !== incoming);
      const upstream = incoming?.source ?? 'renderer';
      const upstreamHandle = incoming?.sourceHandle ?? 'frame';
      return [
        ...rest,
        { id: `${upstream}-${id}`, source: upstream, sourceHandle: upstreamHandle, target: id, targetHandle: 'frame', animated: true },
        { id: `${id}-tonemap`, source: id, sourceHandle: 'frame', target: 'tonemap', targetHandle: 'frame', animated: true },
      ];
    });
    setNodes(nodes => [...nodes, node]);
    setIsAddMenuOpen(false);
    setAddMenuCategory(null);
  }, [editCallbacks, nextAddPosition, onFxBypass, onFxSelect, onFxValue, setEdges, setNodes]);

  const addClockNode = useCallback(() => {
    const id = `clock-${clockIdRef.current}`;
    clockIdRef.current += 1;
    setNodes(current => [
      ...current,
      createClockNode(id, nextAddPosition(), props.settings, props.onSetting, props.onPreviewSetting, props.onResetClock, editCallbacks),
    ]);
    setIsAddMenuOpen(false);
    setAddMenuCategory(null);
  }, [editCallbacks, nextAddPosition, props.onPreviewSetting, props.onResetClock, props.onSetting, props.settings, setNodes]);

  const toggleAddMenu = useCallback(() => {
    if (isAddMenuOpen) setAddMenuCategory(null);
    setIsAddMenuOpen(current => !current);
  }, [isAddMenuOpen]);

  const resetAddMenuCategory = useCallback(() => {
    setAddMenuCategory(null);
  }, []);

  const chooseAddCategory = useCallback((category: Exclude<AddMenuCategory, null>) => {
    setAddMenuCategory(category);
  }, []);

  const addMenuContent = useMemo(() => {
    if (!isAddMenuOpen) return null;
    if (addMenuCategory === null) {
      return (
        <div className="add-node-menu nodrag nopan">
          {ADD_CATEGORIES.map(category => (
            <button key={category.id} type="button" onClick={() => chooseAddCategory(category.id)}>
              {category.label}
            </button>
          ))}
        </div>
      );
    }

    if (addMenuCategory === 'sources') {
      return (
        <div className="add-node-menu nodrag nopan">
          <button type="button" className="back-button" onClick={resetAddMenuCategory}>Back</button>
          <button type="button" onClick={addClockNode}>Clock</button>
        </div>
      );
    }

    if (addMenuCategory === 'effects') {
      return (
        <div className="add-node-menu nodrag nopan">
          <button type="button" className="back-button" onClick={resetAddMenuCategory}>Back</button>
          {EFFECT_CATALOG.filter(d => d.kind !== 'toneMap').map(d => {
            const Icon = FX_ICONS[d.icon] ?? Box;
            return (
              <button key={d.kind} type="button" className="add-effect-button" title={d.label} aria-label={d.label} onClick={() => addFxNode(d.kind)}>
                <Icon size={16} />
              </button>
            );
          })}
        </div>
      );
    }

    return (
      <div className="add-node-menu nodrag nopan">
        <button type="button" className="back-button" onClick={resetAddMenuCategory}>Back</button>
        {OPERATOR_LIBRARY.map(item => (
          <button key={item.kind} type="button" onClick={() => addOperatorNode(item.kind)}>
            {item.label}
          </button>
        ))}
      </div>
    );
  }, [addClockNode, addFxNode, addMenuCategory, addOperatorNode, chooseAddCategory, isAddMenuOpen, resetAddMenuCategory]);

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
      const currentById = new Map(current.map(node => [node.id, node]));
      const extra = current.filter(node => !baseIds.has(node.id));
      return [...baseNodes.map(node => {
        const existing = currentById.get(node.id);
        return {
          ...node,
          data: existing?.data ?? node.data,
        };
      }), ...extra].map(node => ({ ...node, selected: false }));
    });
    setEdges(current => {
      const nodeIds = new Set(nodes.map(node => node.id));
      for (const node of baseNodes) nodeIds.add(node.id);
      return initialEdges
        .filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target))
        .concat(current.filter(edge => !initialEdges.some(item => item.id === edge.id) && !isObsoletePipelineEdge(edge)));
    });
    setSelection({ nodes: [], edges: [] });
    setLayoutRequest(request => request + 1);
  }, [baseNodes, initialEdges, nodes, setEdges, setNodes]);

  const onSelectionChange = useCallback((params: FlowSelection) => {
    setSelection(current => sameSelection(current, params) ? current : params);
  }, []);

  const startMiddleZoom = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    setMiddleZoom({ y: event.clientY, zoom: viewport.zoom });
  }, [viewport.zoom]);

  const suppressMiddleAuxClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);

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

  useEffect(() => {
    const shell = flowShellRef.current;
    const toolbar = flowToolbarRef.current;
    if (!shell || !toolbar) return;

    const updateFlowChrome = () => {
      const shellRect = shell.getBoundingClientRect();
      const toolbarRect = toolbar.getBoundingClientRect();
      const controls = shell.querySelector('.flow-controls');
      const controlsRect = controls?.getBoundingClientRect();
      const top = Math.max(0, Math.ceil(toolbarRect.bottom - shellRect.top));
      const left = controlsRect ? Math.max(0, Math.ceil(controlsRect.right - shellRect.left)) : 0;
      setFlowChromeTop(current => current === top ? current : top);
      setFlowChromeLeft(current => current === left ? current : left);
      setFlowSize(current => {
        const next = {
          height: Math.ceil(shellRect.height),
          width: Math.ceil(shellRect.width),
        };
        return current.height === next.height && current.width === next.width ? current : next;
      });
      setFlowChromeMeasured(true);
    };

    updateFlowChrome();
    const observer = new ResizeObserver(updateFlowChrome);
    observer.observe(shell);
    observer.observe(toolbar);
    const controls = shell.querySelector('.flow-controls');
    if (controls) observer.observe(controls);
    const frame = window.requestAnimationFrame(updateFlowChrome);
    window.addEventListener('resize', updateFlowChrome);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', updateFlowChrome);
    };
  }, []);

  return (
    <div
      ref={flowShellRef}
      className={`control-flow-shell${snapEnabled ? ' snap-grid-on' : ''}`}
      onMouseDownCapture={startMiddleZoom}
      onAuxClickCapture={suppressMiddleAuxClick}
    >
      <ReactFlow
        nodes={nodes}
        edges={displayedEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        isValidConnection={connection => isValidGraphConnection(connection, nodes)}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onEdgesChange={onEdgesChange}
        onNodesChange={onNodesChange}
        onBeforeDelete={onBeforeDelete}
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
        <MeasuredLayout
          metrics={flowFitMetrics}
          request={layoutRequest}
          ready={flowFitReady}
          setNodes={setNodes}
        />
        <Panel ref={flowToolbarRef} position="top-left" className="flow-panel nodrag nopan">
          <button type="button" onClick={resetLayout} title="Reset graph" aria-label="Reset graph">
            <RotateCcw size={14} />
          </button>
          <FlowFitButton metrics={flowFitMetrics} />
          <button
            type="button"
            className={snapEnabled ? 'active' : ''}
            onClick={() => setSnapEnabled(value => !value)}
            title={`Snap ${snapEnabled ? 'on' : 'off'}`}
            aria-label={`Snap ${snapEnabled ? 'on' : 'off'}`}
          >
            <Grid3x3 size={14} />
          </button>
          <button type="button" onClick={snapCurrentLayout} title="Snap now" aria-label="Snap now">
            <AlignStartVertical size={14} />
          </button>
          <div className="drag-mode-toggle" role="group" aria-label="Slider drag behavior">
            <button
              type="button"
              className={props.dragMode === 'ride' ? 'active' : ''}
              onClick={() => props.onDragMode('ride')}
              title="Ride"
              aria-label="Ride"
            >
              <Activity size={14} />
            </button>
            <button
              type="button"
              className={props.dragMode === 'hold' ? 'active' : ''}
              onClick={() => props.onDragMode('hold')}
              title="Hold"
              aria-label="Hold"
            >
              <Lock size={14} />
            </button>
          </div>
          <button type="button" onClick={saveGraphPreset} title="Save graph" aria-label="Save graph">
            <Save size={14} />
          </button>
          <button
            type="button"
            onClick={() => graphPresetInputRef.current?.click()}
            title="Load graph"
            aria-label="Load graph"
          >
            <Upload size={14} />
          </button>
          <input
            ref={graphPresetInputRef}
            className="graph-preset-input"
            type="file"
            accept="application/json,.json"
            onChange={loadGraphPresetFile}
          />
          <button type="button" onClick={restoreLinks} title="Restore links" aria-label="Restore links">
            <Link2 size={14} />
          </button>
          <button
            type="button"
            className={hasSelectedEdges ? 'link-delete-ready' : ''}
            aria-disabled={!hasSelectedEdges}
            onClick={deleteSelectedLinks}
            title="Delete link"
            aria-label="Delete link"
          >
            <Unlink size={14} />
          </button>
          <button
            type="button"
            className={isAddMenuOpen ? 'active' : ''}
            onClick={toggleAddMenu}
            title="Add"
            aria-label="Add"
          >
            <Plus size={14} />
          </button>
          {addMenuContent}
        </Panel>
        <Background gap={22} size={1} color={snapEnabled ? 'rgba(246, 241, 232, 0.18)' : 'rgba(246, 241, 232, 0.035)'} />
        <FlowControls metrics={flowFitMetrics} />
        <MiniMap pannable zoomable nodeColor={node => nodeColor(String(node.type ?? ''))} />
      </ReactFlow>
    </div>
  );
}

type MeasuredLayoutProps = {
  metrics: FlowFitMetrics;
  request: number;
  ready: boolean;
  setNodes: Dispatch<SetStateAction<Node[]>>;
};

function MeasuredLayout({ metrics, ready, request, setNodes }: MeasuredLayoutProps) {
  const nodesReady = useNodesInitialized();
  const flow = useReactFlow();
  const appliedRequest = useRef<number | null>(null);

  useEffect(() => {
    if (!ready || !nodesReady || appliedRequest.current === request) return;
    let frame = 0;
    let lastSignature = '';
    let stableFrames = 0;
    const tick = () => {
      const currentNodes = flow.getNodes();
      if (!allNodesMeasured(currentNodes)) {
        frame = window.requestAnimationFrame(tick);
        return;
      }

      const signature = measuredLayoutSignature(currentNodes);
      if (signature === lastSignature) {
        stableFrames += 1;
      } else {
        lastSignature = signature;
        stableFrames = 1;
      }

      if (stableFrames < 2) {
        frame = window.requestAnimationFrame(tick);
        return;
      }

      appliedRequest.current = request;
      const nextPositions = measuredLayoutPositions(currentNodes);
      const arrangedNodes = currentNodes.map(node => ({
        ...node,
        position: nextPositions.get(node.id) ?? node.position,
        // Even-gap regulation: grow each node to fill its grid-snapped slot so
        // the space below every node lands on the same grid line and the row
        // gaps stay uniform. layoutAdvanceHeight already snaps the node
        // body+port-rail up to the next grid cell.
        style: { ...node.style, minHeight: layoutAdvanceHeight(node.id, node) },
      }));
      setNodes(() => arrangedNodes);
      window.requestAnimationFrame(() => {
        void applyAlignedFlowFit(flow, arrangedNodes, metrics, 160);
      });
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [flow, metrics, nodesReady, ready, request, setNodes]);

  return null;
}

function FlowFitButton({ metrics }: { metrics: FlowFitMetrics }) {
  const flow = useReactFlow();
  const fit = useCallback(() => {
    void applyAlignedFlowFit(flow, flow.getNodes(), metrics, 180);
  }, [flow, metrics]);
  return <button type="button" onClick={fit} title="Fit" aria-label="Fit"><Maximize2 size={14} /></button>;
}

function FlowControls({ metrics }: { metrics: FlowFitMetrics }) {
  const flow = useReactFlow();
  const fit = useCallback(() => {
    void applyAlignedFlowFit(flow, flow.getNodes(), metrics, 180);
  }, [flow, metrics]);
  return (
    <Controls showInteractive showFitView={false} className="flow-controls">
      <ControlButton
        className="flow-controls-fit"
        title="Fit view"
        aria-label="Fit view"
        onClick={fit}
      >
        <Maximize2 size={14} />
      </ControlButton>
    </Controls>
  );
}

