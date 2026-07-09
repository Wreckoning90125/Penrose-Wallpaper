// Per-node data shapes the ControlGraph orchestrator builds and hands to each node
// component via `NodeComponentProps<TData>`, plus the shared edit-callback mixin.
// Types only — kept in one module so the orchestrator (which builds the data) and
// the node components (which consume it) share one definition.
import type { AtlasCategory, LiveBoostStore, WebAudioGraph } from '../types';
import type { Settings, SettingKey, SettingValue } from '../settings/androidSettings';
import type { Oklch, Palette } from '../color/palette';
import type { GainKey } from './graphPreset';
import type { OperatorSignalStore } from './operatorSignals';
import type { OperatorSpec } from './operatorSpecs';

export type AtlasNodeData = {
  activeOutputs?: string[];
  categories: AtlasCategory[];
  items: AtlasCategory['items'];
  categoryId: string;
  targetId: string;
  currentValue: string;
  onCategory: (categoryId: string) => void;
  onTarget: (targetId: string) => void;
};

export type EditCallbacks = {
  onBeginEdit: (paramKey: string) => void;
  onEndEdit: (paramKey: string) => void;
};

export type TilingNodeData = {
  activeInputs?: string[];
  activeOutputs?: string[];
  settings: Settings;
  seedOptions: { value: string; label: string }[];
  maxGeneration: number;
  onFamily: (family: string) => void;
  onSetting: (key: SettingKey, value: SettingValue) => void;
  onPreviewSetting: (key: SettingKey, value: SettingValue) => void;
} & EditCallbacks;

export type IfsAttractorNodeData = {
  activeOutputs?: string[];
};

export type PaletteNodeData = {
  activeInputs?: string[];
  activeOutputs?: string[];
  settings: Settings;
  palette: Palette;
  colorCount: number;
  selectedColor: number;
  selectedColorValue: Oklch;
  gamut: string;
  onPalette: (palette: string) => void;
  onSetting: (key: SettingKey, value: SettingValue) => void;
  onPreviewSetting: (key: SettingKey, value: SettingValue) => void;
  onSelectedColor: (index: number) => void;
  onPreviewCustomColor: (updater: (color: Oklch) => Oklch) => void;
  onCommitCustomColor: () => void;
} & EditCallbacks;

export type SettingsNodeData = {
  activeInputs?: string[];
  activeOutputs?: string[];
  settings: Settings;
  onSetting: (key: SettingKey, value: SettingValue) => void;
  onPreviewSetting: (key: SettingKey, value: SettingValue) => void;
} & EditCallbacks;

export type ProjectionNodeData = SettingsNodeData & {
  liveBoostStore: LiveBoostStore;
  onResetBoost: () => void;
  onResetView: () => void;
};

export type ClockNodeData = SettingsNodeData & {
  deletable?: boolean;
  id?: string;
  onResetClock: () => void;
};

export type AudioTransportNodeData = {
  activeOutputs?: string[];
  audio: WebAudioGraph;
};

export type AudioAnalysisNodeData = {
  activeInputs?: string[];
  activeOutputs?: string[];
  audio: WebAudioGraph;
};

export type OperatorNodeData = {
  activeInputs?: string[];
  activeOutputs?: string[];
  gainKey?: GainKey;
  id: string;
  onGain?: (key: GainKey, value: number) => void;
  onBeginEdit: (paramKey: string) => void;
  onEndEdit: (paramKey: string) => void;
  onOperatorPreview?: (id: string, values: Record<string, number>, selectValues: Record<string, string>) => void;
  operatorSignals: OperatorSignalStore;
  spec: OperatorSpec;
  selectValues: Record<string, string>;
  values: Record<string, number>;
};

export type RendererNodeData = {
  activeInputs?: string[];
  activeOutputs?: string[];
  tiles: number;
  unit: string;
  loading: string;
};

export type DisplayNodeData = {
  activeInputs?: string[];
};

export type NodeComponentProps<TData> = {
  data: TData;
};

export type FxNodeData = {
  activeInputs?: string[];
  activeOutputs?: string[];
  domainWarning?: boolean;
  id: string;
  kind: string;
  bypass: boolean;
  values: Record<string, number>;
  selects: Record<string, string>;
  onBeginEdit: (paramKey: string) => void;
  onEndEdit: (paramKey: string) => void;
  onFxValue?: (id: string, key: string, value: number) => void;
  onFxSelect?: (id: string, key: string, value: string) => void;
  onFxBypass?: (id: string, bypass: boolean) => void;
};

export type FieldSourceNodeData = {
  activeInputs?: string[];
  activeOutputs?: string[];
  id: string;
  values: Record<string, number>;
  onBeginEdit: (paramKey: string) => void;
  onEndEdit: (paramKey: string) => void;
  onFieldValue?: (id: string, key: string, value: number) => void;
};
