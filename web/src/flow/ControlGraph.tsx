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
import type { Connection, Edge, Node, OnBeforeDelete, OnMove, ReactFlowInstance, Viewport } from '@xyflow/react';
import {
  Activity,
  AlignStartVertical,
  Grid3x3,
  Link2,
  Lock,
  Maximize2,
  Plus,
  RotateCcw,
  Save,
  Unlink,
  Upload,
} from 'lucide-react';
import { EFFECT_CATALOG, fxParamDefaults, fxSelectDefaults, isFxKind } from '../render/postFxCatalog';
import { fxIconComponent } from './fxIcons';
import { clockTransportPhase, isSignalSource, isSignalTarget, signalKey } from './signalUtils';
import { LIGHT_CHOREO_PHASE_INLET } from './controlSpecs';
import { spliceMaterialFieldBypasses } from './materialLanes';
import {
  evaluateSignals,
  fieldModulatedValues,
  fxModulatedParams,
  modulationsFromSignals,
  type AudioOperatorRuntimeState,
  type LiveOperatorData,
  type LiveOperatorDataMap,
} from './signalEval';
import { deriveFieldSlots, FIELD_SOURCE_PHASE_INLET, fieldParamDefaults } from './fieldSourceSpec';
import { createOperatorSignalStore, operatorSignalSnapshot, type OperatorSignalStore } from './operatorSignals';
import {
  derivePostChain,
  domainMismatchedFxIds,
  canAddGraphConnection,
  edgeConflictsWithConnection,
  edgesWithoutConnectionConflicts,
  type GraphConnectionLike,
} from './graphTopology';
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
  autoLayoutNodes,
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
  FieldSourceNode,
  FxNode,
  IfsAttractorNode,
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
  FieldSlot,
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

function postChainRuntimeSignature(chain: PostChainSpec): string {
  return chain
    .map(node => `${node.id}:${node.kind}:${node.bypass ? 1 : 0}:${numberRecordSignature(node.params)}:${stringRecordSignature(node.selects)}`)
    .join('|');
}

const ADD_CATEGORIES: AddCategorySpec[] = [
  { id: 'sources', label: 'Sources' },
  { id: 'operators', label: 'Operators' },
  { id: 'effects', label: 'Effects' },
];

type DefaultGainOperator = {
  gainKey: GainKey;
  id: string;
  label: string;
};

const DEFAULT_GAIN_OPERATORS: readonly DefaultGainOperator[] = [
  { id: 'operator-gain-metal', gainKey: 'metal', label: 'Gain' },
  { id: 'operator-gain-film', gainKey: 'film', label: 'Gain' },
  { id: 'operator-gain-glow', gainKey: 'emissive', label: 'Gain' },
  { id: 'operator-gain-relief', gainKey: 'relief', label: 'Gain' },
];

function pendingLayoutPosition(): { x: number; y: number } {
  // Placeholder only; autoLayoutNodes assigns the real default-preset positions.
  return { x: 0, y: 0 };
}

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
  renderUnit: string;
  loading: string;
  gamut: string;
  onCategory: (categoryId: string) => void;
  onTarget: (targetId: string) => void;
  onFamily: (family: string) => void;
  onSetting: (key: SettingKey, value: SettingValue) => void;
  onPreviewSetting: (key: SettingKey, value: SettingValue) => void;
  onPalette: (palette: string) => void;
  onSelectedColor: (index: number) => void;
  onPreviewCustomColor: (updater: (color: Oklch) => Oklch) => void;
  onCommitCustomColor: () => void;
  onGain: (key: GainKey, value: number) => void;
  onAudioModulation: (values: AudioModulationValues) => void;
  onPostChain: (spec: PostChainSpec) => void;
  onRenderInputs: (inputs: RenderInputs) => void;
  onFieldPhase: (phase: number) => void;
  onChoreoPhase: (phase: number) => void;
  onFieldSlots: (slots: FieldSlot[]) => void;
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
const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 0.62 };
const PROTECTED_NODE_IDS = new Set([
  'atlas',
  'tiling',
  'ifs',
  'palette',
  'projection',
  'material',
  'lighting',
  'edgeProfile',
  'transport',
  'analysis',
  'clock',
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
  'postfx',
]);

function emptyAudioOperatorState(): AudioOperatorRuntimeState {
  return { gateChangedAt: {}, gateOpen: {}, held: {}, previous: {}, triggerHigh: {} };
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
  ifs: IfsAttractorNode,
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
  fieldSource: FieldSourceNode,
  fx: FxNode,
  renderer: RendererNode,
  display: DisplayNode,
};


function initialOperatorValues(spec: OperatorSpec): Record<string, number> {
  const values: Record<string, number> = {};
  for (const [key, _label, min] of spec.controls) {
    values[key] = spec.defaults?.[key] ?? min;
  }
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
  operatorSignals: OperatorSignalStore,
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
      operatorSignals,
      spec,
      selectValues: initialOperatorSelectValues(spec),
      values: initialOperatorValues(spec),
    },
    dragHandle: '.flow-node-title',
  };
}

function createGainOperatorNode(
  operator: DefaultGainOperator,
  position: { x: number; y: number },
  gain: number,
  onGain: (key: GainKey, value: number) => void,
  editCallbacks: EditCallbacks,
  onOperatorPreview: OperatorNodeData['onOperatorPreview'],
  operatorSignals: OperatorSignalStore,
): Node {
  const spec = { ...operatorSpec('gain'), label: operator.label };
  return {
    id: operator.id,
    type: 'operator',
    position,
    data: {
      gainKey: operator.gainKey,
      id: operator.id,
      onBeginEdit: editCallbacks.onBeginEdit,
      onEndEdit: editCallbacks.onEndEdit,
      onGain,
      onOperatorPreview,
      operatorSignals,
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

function isPaletteEditKey(paramKey: string | null): boolean {
  return editKeyIsIn(paramKey, PALETTE_SETTING_KEYS) || (paramKey?.startsWith('custom_color_') ?? false);
}

function sortedRecordSignature(record: Record<string, number | string | boolean | null | undefined>): string {
  return Object.keys(record).sort().map(key => `${key}:${String(record[key])}`).join(',');
}

function numberRecordSignature(record: Record<string, number>): string {
  return sortedRecordSignature(record);
}

function stringRecordSignature(record: Record<string, string>): string {
  return sortedRecordSignature(record);
}

function looseSettingsSignature(value: object | null, keys: readonly SettingKey[]): string {
  if (!value) return '';
  return keys.map(key => `${key}:${String(Object.getOwnPropertyDescriptor(value, key)?.value)}`).join('|');
}

function runtimeNodeSignature(node: Node): string {
  const type = String(node.type ?? '');
  if (type === 'fx') {
    return [
      node.id,
      type,
      dataString(node.data, 'kind'),
      dataBoolean(node.data, 'bypass') ? '1' : '0',
      numberRecordSignature(numberRecordFromObject(dataObject(node.data, 'values'))),
      stringRecordSignature(stringRecordFromObject(dataObject(node.data, 'selects'))),
    ].join(':');
  }
  if (type === 'operator') {
    const spec = dataObject(node.data, 'spec');
    return [
      node.id,
      type,
      spec ? dataString(spec, 'kind') : '',
      dataString(node.data, 'gainKey'),
      numberRecordSignature(numberRecordFromObject(dataObject(node.data, 'values'))),
      stringRecordSignature(stringRecordFromObject(dataObject(node.data, 'selectValues'))),
    ].join(':');
  }
  if (type === 'fieldSource') {
    return [
      node.id,
      type,
      numberRecordSignature(numberRecordFromObject(dataObject(node.data, 'values'))),
    ].join(':');
  }
  if (type === 'clock') {
    return [
      node.id,
      type,
      looseSettingsSignature(dataObject(node.data, 'settings'), CLOCK_SETTING_KEYS),
    ].join(':');
  }
  return `${node.id}:${type}`;
}

function runtimeEdgeSignature(edge: Edge): string {
  return [
    edge.id,
    edge.source,
    edge.sourceHandle ?? '',
    edge.target,
    edge.targetHandle ?? '',
  ].join(':');
}

function graphRuntimeSignature(nodes: readonly Node[], edges: readonly Edge[]): string {
  return [
    nodes.map(runtimeNodeSignature).sort().join('|'),
    edges.map(runtimeEdgeSignature).sort().join('|'),
  ].join('||');
}


function clockNodeRunning(node: Node): boolean {
  if (node.type !== 'clock') return false;
  const settings = dataObject(node.data, 'settings');
  const enabled = String(Object.getOwnPropertyDescriptor(settings, 'clock_enabled')?.value ?? '1') !== '0';
  const parsedRate = Number.parseInt(String(Object.getOwnPropertyDescriptor(settings, 'clock_rate')?.value ?? '100'), 10);
  return enabled && Number.isFinite(parsedRate) && parsedRate > 0;
}


export function ControlGraph(props: ControlGraphProps) {
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
  const flowInstanceRef = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const viewportRef = useRef<Viewport>(DEFAULT_VIEWPORT);
  const graphPresetInputRef = useRef<HTMLInputElement | null>(null);
  const initialAudioRef = useRef(props.audio);
  const initialSettingsRef = useRef(props.settings);
  const initialGainsRef = useRef(props.gains);
  const operatorSignalStore = useMemo(() => createOperatorSignalStore(), []);
  const audioOperatorStateRef = useRef<AudioOperatorRuntimeState>(emptyAudioOperatorState());
  const liveOperatorDataRef = useRef<LiveOperatorDataMap>({});
  const nodesRef = useRef<readonly Node[]>([]);
  const edgesRef = useRef<readonly Edge[]>([]);
  const addNodeCounterRef = useRef(0);
  const operatorIdRef = useRef(2);
  const fxIdRef = useRef(1);
  const fxValuesRef = useRef<Record<string, Record<string, number>>>({});
  const fieldIdRef = useRef(1);
  const fieldValuesRef = useRef<Record<string, Record<string, number>>>({});
  const clockIdRef = useRef(2);
  const clockEpochRef = useRef(typeof performance === 'undefined' ? 0 : performance.now());
  const liveClockSettingsRef = useRef<Settings>(props.settings);
  const emitGraphFrameRef = useRef(0);
  const audioModulationSignatureRef = useRef('');
  const postChainSignatureRef = useRef('');
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
  useEffect(() => {
    if (editKeyIsIn(activeEditRef.current, CLOCK_SETTING_KEYS)) return;
    liveClockSettingsRef.current = props.settings;
  }, [props.settings]);
  const resetClock = useCallback(() => {
    clockEpochRef.current = performance.now();
    props.onResetClock();
  }, [props.onResetClock]);
  const onClockPreviewSetting = useCallback((key: SettingKey, value: SettingValue) => {
    if (CLOCK_SETTING_KEYS.some(item => item === key)) {
      liveClockSettingsRef.current = { ...liveClockSettingsRef.current, [key]: value };
    }
    props.onPreviewSetting(key, value);
  }, [props.onPreviewSetting]);
  const onClockSetting = useCallback((key: SettingKey, value: SettingValue) => {
    if (CLOCK_SETTING_KEYS.some(item => item === key)) {
      liveClockSettingsRef.current = { ...liveClockSettingsRef.current, [key]: value };
    }
    props.onSetting(key, value);
  }, [props.onSetting]);
  const runtimeNodes = useCallback((): readonly Node[] => (
    nodesRef.current.map(node => node.type === 'clock'
      ? { ...node, data: { ...node.data, settings: liveClockSettingsRef.current } }
      : node)
  ), []);

  const emitAudioGraph = useCallback(() => {
    const features = props.audio.getSnapshot().features;
    const now = performance.now();
    const nodesForRuntime = runtimeNodes();
    const signals = evaluateSignals(
      features,
      nodesForRuntime,
      edgesRef.current,
      audioOperatorStateRef.current,
      liveOperatorDataRef.current,
      now,
      clockEpochRef.current,
    );
    operatorSignalStore.set(operatorSignalSnapshot(nodesForRuntime, signals));
    // Field-source phase inlets are clock-only transports: they must receive
    // the raw monotonic sawtooth (the renderer unwraps and integrates it), not
    // the clock's waveform-shaped output signal.
    const phaseForNode = (nodeId: string): number => {
      const edge = edgesRef.current.find(item => item.target === nodeId && item.targetHandle === FIELD_SOURCE_PHASE_INLET.id);
      if (!edge) return 0;
      const clock = nodesForRuntime.find(item => item.id === edge.source && item.type === 'clock');
      if (!clock) return 0;
      const value = clockTransportPhase(clock, now, clockEpochRef.current);
      return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    };
    // The lighting choreography phase is an ordinary signal inlet: average
    // whatever is wired in (shaped clock, audio feature, operator blend).
    const choreoEdges = edgesRef.current.filter(item => item.target === 'lighting' && item.targetHandle === LIGHT_CHOREO_PHASE_INLET.id);
    let choreoPhase = 0;
    if (choreoEdges.length > 0) {
      let total = 0;
      for (const edge of choreoEdges) {
        const value = signals.get(signalKey(edge.source, edge.sourceHandle));
        total += typeof value === 'number' && Number.isFinite(value) ? value : 0;
      }
      choreoPhase = Math.max(0, Math.min(1, total / choreoEdges.length));
    }
    const modulations = modulationsFromSignals(signals, edgesRef.current);
    const modulationSignature = Object.entries(modulations)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${typeof value === 'number' ? value : ''}`)
      .join('|');
    if (audioModulationSignatureRef.current !== modulationSignature) {
      audioModulationSignatureRef.current = modulationSignature;
      props.onAudioModulation(modulations);
    }
    const chain = derivePostChain(nodesForRuntime, edgesRef.current).map(node => {
      const flowNode = nodesForRuntime.find(item => item.id === node.id);
      if (!flowNode) return node;
      return { ...node, params: fxModulatedParams(flowNode, edgesRef.current, signals, activeEditRef.current, props.dragMode) };
    });
    const postChainSignature = postChainRuntimeSignature(chain);
    if (postChainSignatureRef.current !== postChainSignature) {
      postChainSignatureRef.current = postChainSignature;
      props.onPostChain(chain);
    }
    props.onFieldPhase(phaseForNode('postfx'));
    props.onChoreoPhase(choreoPhase);
    props.onFieldSlots(deriveFieldSlots(
      nodesForRuntime,
      edgesRef.current,
      node => fieldModulatedValues(node, edgesRef.current, signals, activeEditRef.current, props.dragMode),
      node => phaseForNode(node.id),
    ));
  }, [operatorSignalStore, props.audio, props.dragMode, props.onAudioModulation, props.onChoreoPhase, props.onFieldPhase, props.onFieldSlots, props.onPostChain, runtimeNodes]);

  const scheduleEmitAudioGraph = useCallback(() => {
    if (emitGraphFrameRef.current) return;
    emitGraphFrameRef.current = requestAnimationFrame(() => {
      emitGraphFrameRef.current = 0;
      emitAudioGraph();
    });
  }, [emitAudioGraph]);
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
  const baseNodes = useMemo<Node[]>(() => autoLayoutNodes([
    {
      id: 'atlas',
      type: 'atlas',
      position: pendingLayoutPosition(),
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
      position: pendingLayoutPosition(),
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
      position: pendingLayoutPosition(),
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
        onPreviewCustomColor: props.onPreviewCustomColor,
        onCommitCustomColor: props.onCommitCustomColor,
      },
    },
    {
      id: 'ifs',
      type: 'ifs',
      position: pendingLayoutPosition(),
      data: {},
    },
    {
      id: 'projection',
      type: 'projection',
      position: pendingLayoutPosition(),
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
      position: pendingLayoutPosition(),
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
      position: pendingLayoutPosition(),
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
      position: pendingLayoutPosition(),
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
      position: pendingLayoutPosition(),
      data: {
        audio: initialAudioRef.current,
      },
    },
    {
      id: 'analysis',
      type: 'analysis',
      position: pendingLayoutPosition(),
      data: {
        audio: initialAudioRef.current,
      },
    },
    {
      id: 'clock',
      type: 'clock',
      position: pendingLayoutPosition(),
      data: {
        settings: initialSettingsRef.current,
        onBeginEdit: editCallbacks.onBeginEdit,
        onEndEdit: editCallbacks.onEndEdit,
        onSetting: onClockSetting,
        onPreviewSetting: onClockPreviewSetting,
        onResetClock: resetClock,
      },
    },
    ...DEFAULT_GAIN_OPERATORS.map(operator => createGainOperatorNode(
      operator,
      pendingLayoutPosition(),
      initialGainsRef.current[operator.gainKey],
      props.onGain,
      editCallbacks,
      onOperatorPreview,
      operatorSignalStore,
    )),
    createOperatorNode('operator-invert-1', 'invert', pendingLayoutPosition(), editCallbacks, onOperatorPreview, operatorSignalStore),
    {
      id: 'postfx',
      type: 'postfx',
      position: pendingLayoutPosition(),
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
      position: pendingLayoutPosition(),
      data: {
        tiles: props.tiles,
        unit: props.renderUnit,
        loading: props.loading,
      },
    },
    {
      id: 'tonemap',
      type: 'fx',
      position: pendingLayoutPosition(),
      data: {
        id: 'tonemap', kind: 'toneMap', bypass: false, values: {}, selects: {},
        onBeginEdit: editCallbacks.onBeginEdit,
        onEndEdit: editCallbacks.onEndEdit,
      },
    },
    {
      id: 'display',
      type: 'display',
      position: pendingLayoutPosition(),
      data: {},
    },
  ].map(node => ({ ...node, dragHandle: '.flow-node-title' }))), [
    editCallbacks,
    onClockPreviewSetting,
    onClockSetting,
    onOperatorPreview,
    operatorSignalStore,
    props.liveBoostStore,
    props.onGain,
    props.onPreviewSetting,
    props.onResetBoost,
    resetClock,
    props.onResetView,
    props.onSetting,
  ]);

  const initialEdges = useMemo<Edge[]>(() => [
    { id: 'atlas-tiling', source: 'atlas', sourceHandle: 'out', target: 'tiling', targetHandle: 'in', animated: true },
    { id: 'tiling-projection', source: 'tiling', sourceHandle: 'out', target: 'projection', targetHandle: 'in' },
    { id: 'projection-palette', source: 'projection', sourceHandle: 'out', target: 'palette', targetHandle: 'in', animated: true },
    { id: 'palette-material', source: 'palette', sourceHandle: 'color', target: 'material', targetHandle: 'color' },
    { id: 'material-renderer', source: 'material', sourceHandle: 'surface', target: 'renderer', targetHandle: 'surface' },
    { id: 'ifs-renderer-attractor', source: 'ifs', sourceHandle: 'points', target: 'renderer', targetHandle: 'attractor' },
    { id: 'material-postfx-relief', source: 'material', sourceHandle: 'relief', target: 'postfx', targetHandle: 'relief' },
    { id: 'material-postfx-color', source: 'material', sourceHandle: 'color', target: 'postfx', targetHandle: 'color' },
    { id: 'clock-postfx-phase', source: 'clock', sourceHandle: 'out', target: 'postfx', targetHandle: FIELD_SOURCE_PHASE_INLET.id, animated: true },
    // Choreography is wire-driven: the default graph animates the lights from
    // the clock, and rewiring (beat, operators) changes the source — there is
    // no dropdown.
    { id: 'clock-lighting-phase', source: 'clock', sourceHandle: 'out', target: 'lighting', targetHandle: LIGHT_CHOREO_PHASE_INLET.id, animated: true },
    { id: 'lighting-renderer', source: 'lighting', sourceHandle: 'out', target: 'renderer', targetHandle: 'lighting' },
    { id: 'postfx-renderer-displace', source: 'postfx', sourceHandle: 'displace', target: 'renderer', targetHandle: 'displace' },
    { id: 'postfx-renderer-relief', source: 'postfx', sourceHandle: 'relief', target: 'renderer', targetHandle: 'relief' },
    { id: 'postfx-renderer-color', source: 'postfx', sourceHandle: 'color', target: 'renderer', targetHandle: 'color' },
    { id: 'postfx-renderer-undulate', source: 'postfx', sourceHandle: 'undulate', target: 'renderer', targetHandle: 'undulate' },
    { id: 'edgeProfile-renderer-border', source: 'edgeProfile', sourceHandle: 'border', target: 'renderer', targetHandle: 'border' },
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
  const runtimeGraphKey = useMemo(() => graphRuntimeSignature(nodes, edges), [edges, nodes]);
  const clockGraphActive = useMemo(() => {
    const nodeLookup = new Map(nodes.map(node => [node.id, node]));
    return edges.some(edge => {
      const source = nodeLookup.get(edge.source);
      return source?.type === 'clock' && edge.sourceHandle === 'out' && clockNodeRunning(source);
    });
  }, [edges, nodes]);
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
    if (isPaletteEditKey(activeEditRef.current)) return;
    setNodes(current => current.map(node => node.id === 'palette'
      ? {
          ...node,
          data: {
            ...node.data,
            colorCount: props.colorCount,
            gamut: props.gamut,
            onBeginEdit: editCallbacks.onBeginEdit,
            onPreviewCustomColor: props.onPreviewCustomColor,
            onCommitCustomColor: props.onCommitCustomColor,
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
    props.onCommitCustomColor,
    props.onPalette,
    props.onPreviewCustomColor,
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
            unit: props.renderUnit,
          },
        }
      : node));
  }, [props.loading, props.renderUnit, props.tiles, setNodes]);

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
            onResetClock: resetClock,
            onSetting: onClockSetting,
            onPreviewSetting: onClockPreviewSetting,
            settings: props.settings,
          },
        }
      : node));
  }, [
    clockSettingsKey,
    editCallbacks,
    editFlush,
    onClockPreviewSetting,
    onClockSetting,
    resetClock,
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
            operatorSignals: operatorSignalStore,
          },
      }
      : node));
  }, [editCallbacks, onOperatorPreview, operatorSignalStore, props.onGain, setNodes]);

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

  // The domain warning depends on each FX node's kind + bypass (a bypassed
  // tone-map removes the boundary), which are node data, not edges. This cheap
  // content signature lets the sync effect re-run when a bypass toggles without
  // re-running on every position drag (which a raw `nodes` dep would cause).
  const fxBypassSignature = useMemo(
    () => nodes.filter(node => node.type === 'fx').map(node => `${node.id}:${dataBoolean(node.data, 'bypass') ? 1 : 0}`).join(','),
    [nodes],
  );

  useEffect(() => {
    setNodes(current => {
      const warned = domainMismatchedFxIds(current, edges);
      return current.map(node => {
        const activeInputs = activeHandles(edges, node.id, 'target');
        const activeOutputs = activeHandles(edges, node.id, 'source');
        const domainWarning = node.type === 'fx' && warned.has(node.id);
        const previousInputs = Array.isArray(node.data['activeInputs']) ? node.data['activeInputs'].map(String) : [];
        const previousOutputs = Array.isArray(node.data['activeOutputs']) ? node.data['activeOutputs'].map(String) : [];
        const previousWarning = node.data['domainWarning'] === true;
        if (
          sameStringList(previousInputs, activeInputs)
          && sameStringList(previousOutputs, activeOutputs)
          && previousWarning === domainWarning
        ) {
          return node;
        }
        return {
          ...node,
          data: {
            ...node.data,
            activeInputs,
            activeOutputs,
            domainWarning,
          },
        };
      });
    });
  }, [edges, fxBypassSignature, setNodes]);

  useEffect(() => {
    return props.audio.subscribe(scheduleEmitAudioGraph);
  }, [props.audio, scheduleEmitAudioGraph]);

  useEffect(() => () => {
    if (emitGraphFrameRef.current) cancelAnimationFrame(emitGraphFrameRef.current);
  }, []);

  useEffect(() => {
    if (!clockGraphActive) return undefined;
    let frame = 0;
    const tick = () => {
      scheduleEmitAudioGraph();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      if (frame) cancelAnimationFrame(frame);
    };
  }, [clockGraphActive, scheduleEmitAudioGraph]);

  useEffect(() => {
    emitAudioGraph();
  }, [emitAudioGraph, runtimeGraphKey]);

  useEffect(() => {
    props.onRenderInputs(renderInputsFromEdges(nodesRef.current, edgesRef.current));
  }, [props.onRenderInputs, runtimeGraphKey]);

  const onConnect = useCallback((connection: Connection) => {
    if (!canAddGraphConnection(connection, nodes, edgesWithoutConnectionConflicts(edges, connection))) return;
    setEdges(current => {
      const next = edgesWithoutConnectionConflicts(current, connection);
      return addEdge({ ...connection, animated: true }, next);
    });
  }, [edges, nodes, setEdges]);

  const onReconnect = useCallback((oldEdge: Edge, connection: Connection) => {
    const edgesWithoutOld = edges.filter(edge => edge.id !== oldEdge.id);
    if (!canAddGraphConnection(connection, nodes, edgesWithoutConnectionConflicts(edgesWithoutOld, connection))) return;
    setEdges(current => {
      const withoutTargetConflict = current.filter(edge => edge.id === oldEdge.id || !edgeConflictsWithConnection(edge, connection));
      return reconnectEdge(oldEdge, connection, withoutTargetConflict);
    });
  }, [edges, nodes, setEdges]);

  const onBeforeDelete = useCallback<OnBeforeDelete<Node, Edge>>(async ({ nodes: deletingNodes, edges: deletingEdges }) => {
    const deletableNodeIds = new Set(deletingNodes.filter(node => !PROTECTED_NODE_IDS.has(node.id)).map(node => node.id));
    const allNodes = nodesRef.current;
    const nodeOf = (nid: string | null): Node | null => (nid ? allNodes.find(node => node.id === nid) ?? null : null);
    setEdges(current => {
      let next = current;
      for (const id of deletableNodeIds) {
        const deletedNode = nodeOf(id);
        if (deletedNode?.id === 'postfx' || deletedNode?.type === 'fieldSource') {
          next = spliceMaterialFieldBypasses(next, id);
          continue;
        }
        // Type-aware heal (§0 revised). Frame chain: bridge a deleted FX/tone-map
        // node's frame-in.source → frame-out.target so removing an effect splices
        // its neighbours instead of black-screening the render.
        const inEdge = next.find(edge => edge.target === id && edge.targetHandle === 'frame');
        const outEdge = next.find(edge => edge.source === id && edge.sourceHandle === 'frame');
        if (inEdge && outEdge) {
          next = next.filter(edge => edge !== inEdge && edge !== outEdge);
          next = [...next, {
            id: `${inEdge.source}-${outEdge.target}`,
            source: inEdge.source, sourceHandle: inEdge.sourceHandle ?? null,
            target: outEdge.target, targetHandle: outEdge.targetHandle ?? null, animated: true,
          }];
          continue;
        }
        // Operator signal chain: bridge a deleted operator's single signal-in →
        // single signal-out, but never collapse into a raw feature → target-uniform
        // mainline (that must be a deliberate rewire). Multi-input operators with
        // more than one wired inlet are ambiguous and drop without bridging.
        if (deletedNode?.type !== 'operator') continue;
        const signalIn = next.filter(edge => edge.target === id && isSignalTarget(deletedNode, edge.targetHandle ?? null));
        const signalOut = next.filter(edge => edge.source === id && isSignalSource(deletedNode, edge.sourceHandle ?? null));
        if (signalIn.length !== 1 || signalOut.length !== 1) continue;
        const fromEdge = signalIn[0]!;
        const toEdge = signalOut[0]!;
        const bridge = {
          source: fromEdge.source, sourceHandle: fromEdge.sourceHandle ?? null,
          target: toEdge.target, targetHandle: toEdge.targetHandle ?? null,
        };
        const sourceNode = nodeOf(bridge.source);
        const targetNode = nodeOf(bridge.target);
        const featureMainline = sourceNode?.id === 'analysis' && targetNode?.type !== 'operator';
        const candidateEdges = next.filter(edge => edge !== fromEdge && edge !== toEdge);
        if (featureMainline || !canAddGraphConnection(bridge, allNodes, candidateEdges)) continue;
        next = [...candidateEdges, {
          id: `${bridge.source}-${bridge.target}-${bridge.targetHandle ?? 'signal'}`,
          source: bridge.source, sourceHandle: bridge.sourceHandle,
          target: bridge.target, targetHandle: bridge.targetHandle, animated: true,
        }];
      }
      // Safety net: drop any edge still touching a deleted node. Bridges we keep
      // connect two *surviving* nodes, so this only removes the deleted nodes' own
      // edges and any intermediate bridge stranded by a multi-node delete (e.g.
      // deleting two adjacent operators whose collapse hit the mainline guard) —
      // never a dangling edge into a node that no longer exists.
      next = next.filter(edge => !deletableNodeIds.has(edge.source) && !deletableNodeIds.has(edge.target));
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
    const currentViewport = viewportRef.current;
    const savedViewport = NORMALIZE_GRAPH_PRESET_VIEWPORT_ON_SAVE
      ? alignedViewportForNodes(nodes, flowFitMetrics) ?? currentViewport
      : currentViewport;
    const preset = graphPresetFromState(nodes, edges, savedViewport, snapEnabled, graphPresetAppStateFromProps(props));
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'penrose-graph-preset.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [edges, flowFitMetrics, nodes, props, snapEnabled]);

  const applyGraphPreset = useCallback((preset: GraphPreset) => {
    if (preset.appState) props.onGraphPresetState(preset.appState);
    const presetById = new Map<string, GraphPreset['nodes'][number]>();
    for (const node of preset.nodes) {
      if (!presetById.has(node.id)) presetById.set(node.id, node);
    }
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
          operatorSignalStore,
        );
      }
      if (presetNode.type === 'clock' && presetNode.data.deletableClock) {
        nextNode = createClockNode(
          presetNode.id,
          presetNode.position,
          props.settings,
          onClockSetting,
          onClockPreviewSetting,
          resetClock,
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
      if (presetNode.type === 'fieldSource') {
        nextNode = {
          id: presetNode.id,
          type: 'fieldSource',
          position: presetNode.position,
          dragHandle: '.flow-node-title',
          data: {
            id: presetNode.id,
            values: fieldParamDefaults(),
            onBeginEdit: editCallbacks.onBeginEdit,
            onEndEdit: editCallbacks.onEndEdit,
            onFieldValue,
          },
        };
      }
      if (nextNode) nextNodes.push(nodeWithPresetData(nextNode, presetNode));
    }
    const seenNodeIds = new Set<string>();
    for (let i = 0; i < nextNodes.length; i += 1) {
      const node = nextNodes[i]!;
      if (seenNodeIds.has(node.id)) {
        nextNodes.splice(i, 1);
        i -= 1;
        continue;
      }
      seenNodeIds.add(node.id);
    }

    const nodeIds = new Set(nextNodes.map(node => node.id));
    const nextEdges: Edge[] = [];
    const pushRequiredEdge = (edge: Edge): void => {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return;
      const candidateEdges = edgesWithoutConnectionConflicts(nextEdges, edge);
      if (candidateEdges.some(item => item.id === edge.id)) return;
      if (!canAddGraphConnection(edge, nextNodes, candidateEdges)) return;
      nextEdges.splice(0, nextEdges.length, ...candidateEdges);
      nextEdges.push(edge);
    };
    for (const edge of preset.edges) {
      const next = edgeFromPreset(edge);
      if (nodeIds.has(next.source) && nodeIds.has(next.target)) {
        pushRequiredEdge(next);
      }
    }
    liveOperatorDataRef.current = liveOperatorDataFromNodes(nextNodes);
    audioOperatorStateRef.current = emptyAudioOperatorState();
    // Seed the FX value cache for loaded fx nodes, otherwise the first slider
    // drag on a loaded effect (onFxValue merges off this ref) would wipe its
    // other values.
    const nextFxValues: Record<string, Record<string, number>> = {};
    const nextFieldValues: Record<string, Record<string, number>> = {};
    for (const node of nextNodes) {
      if (node.type === 'fx') nextFxValues[node.id] = numberRecordFromObject(dataObject(node.data, 'values'));
      if (node.type === 'fieldSource') nextFieldValues[node.id] = numberRecordFromObject(dataObject(node.data, 'values'));
    }
    fxValuesRef.current = nextFxValues;
    fieldValuesRef.current = nextFieldValues;
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSnapEnabled(preset.snapEnabled);
    viewportRef.current = preset.viewport;
    void flowInstanceRef.current?.setViewport(preset.viewport, { duration: 0 });
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
      if (suffix !== null && presetNode.id.startsWith('fieldSource-')) {
        fieldIdRef.current = Math.max(fieldIdRef.current, suffix + 1);
      }
    }
  }, [baseNodes, editCallbacks, onOperatorPreview, operatorSignalStore, props, setEdges, setNodes]);

  const loadGraphPresetFile = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    if (!file) return;
    void file.text()
      .then(text => {
        const preset = graphPresetFromText(text);
        if (!preset) throw new Error('Invalid graph preset file');
        applyGraphPreset(preset);
      })
      .catch(caught => {
        const message = caught instanceof Error ? caught.message : String(caught);
        console.error('[graph-preset] load failed', caught);
        window.alert(`Failed to load graph preset: ${message}`);
      });
  }, [applyGraphPreset]);

  const nextAddPosition = useCallback(() => {
    const index = addNodeCounterRef.current;
    addNodeCounterRef.current += 1;
    const column = index % 3;
    const row = Math.floor(index / 3);
    const viewport = viewportRef.current;
    return {
      x: snapValue((160 - viewport.x) / Math.max(viewport.zoom, MIN_FLOW_ZOOM) + column * 96),
      y: snapValue((180 - viewport.y) / Math.max(viewport.zoom, MIN_FLOW_ZOOM) + column * 64 + row * 216),
    };
  }, []);

  const addOperatorNode = useCallback((kind: OperatorKind) => {
    const id = `operator-${kind}-${operatorIdRef.current}`;
    operatorIdRef.current += 1;
    setNodes(current => [...current, createOperatorNode(id, kind, nextAddPosition(), editCallbacks, onOperatorPreview, operatorSignalStore)]);
    setIsAddMenuOpen(false);
    setAddMenuCategory(null);
  }, [editCallbacks, nextAddPosition, onOperatorPreview, operatorSignalStore, setNodes]);

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

  const onFieldValue = useCallback((id: string, key: string, value: number) => {
    const current = fieldValuesRef.current[id] ?? {};
    fieldValuesRef.current = { ...fieldValuesRef.current, [id]: { ...current, [key]: value } };
    setNodes(nodes => nodes.map(node => node.id === id
      ? { ...node, data: { ...node.data, values: fieldValuesRef.current[id] } }
      : node));
  }, [setNodes]);

  const addFieldSourceNode = useCallback(() => {
    const id = `fieldSource-${fieldIdRef.current}`;
    fieldIdRef.current += 1;
    const values = fieldParamDefaults();
    fieldValuesRef.current = { ...fieldValuesRef.current, [id]: values };
    setNodes(current => [...current, {
      id,
      type: 'fieldSource',
      position: nextAddPosition(),
      dragHandle: '.flow-node-title',
      data: {
        id, values,
        onBeginEdit: editCallbacks.onBeginEdit,
        onEndEdit: editCallbacks.onEndEdit,
        onFieldValue,
      },
    }]);
    // Auto-wire the material lanes through the new field source and into the
    // renderer so it composes immediately. Displace/undulate are independent
    // field outputs; relief/color consume the material lane first.
    setEdges(current => {
      const replacedSceneHandles = new Set(['relief', 'color', 'undulate']);
      const replacedMaterialHandles = new Set(['relief', 'color']);
      const kept = current.filter(edge => {
        if (edge.target === 'renderer' && replacedSceneHandles.has(edge.targetHandle ?? '')) return false;
        if (edge.source === 'material' && replacedMaterialHandles.has(edge.sourceHandle ?? '')) return false;
        return true;
      });
      return [
        ...kept,
        { id: `clock-${id}-phase`, source: 'clock', sourceHandle: 'out', target: id, targetHandle: FIELD_SOURCE_PHASE_INLET.id, animated: true },
        { id: `material-${id}-relief`, source: 'material', sourceHandle: 'relief', target: id, targetHandle: 'relief', animated: true },
        { id: `material-${id}-color`, source: 'material', sourceHandle: 'color', target: id, targetHandle: 'color', animated: true },
        { id: `${id}-renderer-relief`, source: id, sourceHandle: 'relief', target: 'renderer', targetHandle: 'relief', animated: true },
        { id: `${id}-renderer-undulate`, source: id, sourceHandle: 'undulate', target: 'renderer', targetHandle: 'undulate', animated: true },
        { id: `${id}-renderer-color`, source: id, sourceHandle: 'color', target: 'renderer', targetHandle: 'color', animated: true },
      ];
    });
    setIsAddMenuOpen(false);
    setAddMenuCategory(null);
  }, [editCallbacks, nextAddPosition, onFieldValue, setEdges, setNodes]);

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
      createClockNode(id, nextAddPosition(), props.settings, onClockSetting, onClockPreviewSetting, resetClock, editCallbacks),
    ]);
    setIsAddMenuOpen(false);
    setAddMenuCategory(null);
  }, [editCallbacks, nextAddPosition, onClockPreviewSetting, onClockSetting, props.settings, resetClock, setNodes]);

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
          <button type="button" onClick={addFieldSourceNode}>Field +</button>
        </div>
      );
    }

    if (addMenuCategory === 'effects') {
      return (
        <div className="add-node-menu nodrag nopan">
          <button type="button" className="back-button" onClick={resetAddMenuCategory}>Back</button>
          {EFFECT_CATALOG.filter(d => d.kind !== 'toneMap').map(d => {
            const Icon = fxIconComponent(d.icon);
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
  }, [addClockNode, addFieldSourceNode, addFxNode, addMenuCategory, addOperatorNode, chooseAddCategory, isAddMenuOpen, resetAddMenuCategory]);

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
      const extraNodes = nodes.filter(node => !baseNodes.some(item => item.id === node.id));
      const graphNodes = [...baseNodes, ...extraNodes];
      const nodeIds = new Set(graphNodes.map(node => node.id));
      const kept: Edge[] = [];
      for (const edge of current) {
        if (initialEdges.some(item => item.id === edge.id)) continue;
        if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
        const candidateEdges = edgesWithoutConnectionConflicts(kept, edge);
        if (!canAddGraphConnection(edge, graphNodes, candidateEdges)) continue;
        kept.splice(0, kept.length, ...candidateEdges);
        kept.push(edge);
      }
      // A kept edge means the user rewired that connection point. Restoring a default
      // edge that shares either endpoint handle would re-add the scene→tonemap bypass
      // alongside the inserted FX and short it out — so skip those. Each chain handle
      // drives/receives a single wire, so a handle collision is a genuine conflict.
      const handle = (node: string, port: string | null | undefined): string => `${node}:${port ?? ''}`;
      const usedSource = new Set(kept.map(edge => handle(edge.source, edge.sourceHandle)));
      const usedTarget = new Set(kept.map(edge => handle(edge.target, edge.targetHandle)));
      const restored = initialEdges.filter(edge => {
        if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return false;
        return !usedSource.has(handle(edge.source, edge.sourceHandle))
          && !usedTarget.has(handle(edge.target, edge.targetHandle));
      });
      return restored.concat(kept);
    });
    setSelection({ nodes: [], edges: [] });
    setLayoutRequest(request => request + 1);
  }, [baseNodes, initialEdges, nodes, setEdges, setNodes]);

  const onSelectionChange = useCallback((params: FlowSelection) => {
    setSelection(current => sameSelection(current, params) ? current : params);
  }, []);

  const isValidConnection = useCallback((connection: GraphConnectionLike) => (
    canAddGraphConnection(connection, nodes, edgesWithoutConnectionConflicts(edges, connection))
  ), [edges, nodes]);

  const startMiddleZoom = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    setMiddleZoom({ y: event.clientY, zoom: viewportRef.current.zoom });
  }, []);

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
      const next = { ...viewportRef.current, zoom };
      viewportRef.current = next;
      void flowInstanceRef.current?.setViewport(next, { duration: 0 });
    };
    const end = () => setMiddleZoom(null);
    window.addEventListener('mousemove', move, { passive: false });
    window.addEventListener('mouseup', end);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
    };
  }, [middleZoom]);

  const handleMoveEnd = useCallback<OnMove>((_event, nextViewport) => {
    viewportRef.current = nextViewport;
  }, []);

  const handleFlowInit = useCallback((instance: ReactFlowInstance<Node, Edge>) => {
    flowInstanceRef.current = instance;
  }, []);

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
        isValidConnection={isValidConnection}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onEdgesChange={onEdgesChange}
        onNodesChange={onNodesChange}
        onBeforeDelete={onBeforeDelete}
        onSelectionChange={onSelectionChange}
        onInit={handleFlowInit}
        defaultViewport={DEFAULT_VIEWPORT}
        onMoveEnd={handleMoveEnd}
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
              title="Ride — slider rides live audio while you drag"
              aria-label="Ride"
            >
              <Activity size={14} />
            </button>
            <button
              type="button"
              className={props.dragMode === 'hold' ? 'active' : ''}
              onClick={() => props.onDragMode('hold')}
              title="Hold — freeze the param from audio while you tune it"
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
