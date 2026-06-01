import type { BufferGeometry } from 'three/webgpu';
import type { Oklch, Palette } from './color/palette';
import type { Settings } from './settings/androidSettings';

export type Point = [number, number];
export type Point3 = [number, number, number];

export type Tile = {
  type: number;
  verts: Point[];
};

export type Patch = {
  family: number;
  seed: number;
  generation: number;
  tiles: Tile[];
};

export type AtlasItem = {
  id: string;
  name: string;
  geometry?: string;
  settings?: Partial<Settings>;
};

export type AtlasCategory = {
  id: string;
  label: string;
  defaults?: Partial<Settings>;
  items: AtlasItem[];
};

export type AtlasManifest = {
  categories: AtlasCategory[];
};

export type GeometryBuild = {
  geometry: BufferGeometry;
  edgeGeometry: BufferGeometry | null;
  palette: Palette;
};

export type AudioFeatures = {
  bass: number;
  mid: number;
  high: number;
  rms: number;
  spectralFlux: number;
  onsetStrength: number;
  cwtTransient: number;
  crestFactor: number;
};

export type AudioTransport = {
  duration: number;
  currentTime: number;
  playing: boolean;
  loop: boolean;
  sourceName: string;
  volume: number;
};

export type AudioStatus = 'idle' | 'mic' | 'file';

export type AudioSnapshot = {
  features: AudioFeatures;
  status: AudioStatus;
  transport: AudioTransport;
};

export type WebAudioGraph = {
  getSnapshot: () => AudioSnapshot;
  startMic: () => Promise<void>;
  loadFile: (file: File | undefined) => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  seek: (time: number) => void;
  setLoop: (loop: boolean) => void;
  setVolume: (volume: number) => void;
  stop: () => void;
  subscribe: (listener: () => void) => () => void;
  subscribeUi: (listener: () => void) => () => void;
};

export type Gains = {
  relief: number;
  emissive: number;
  film: number;
  metal: number;
};

export type DragMode = 'ride' | 'hold';

export type BoostPosition = {
  x: number;
  y: number;
};

export type LiveBoostStore = {
  getSnapshot: () => BoostPosition | null;
  set: (value: BoostPosition | null) => void;
  subscribe: (listener: () => void) => () => void;
};

export type AudioDriveEditState = {
  dragMode: DragMode;
  heldParams: Record<string, boolean | undefined>;
};

// Graph output keyed by target handle. Values are normalized modulation
// signals; targets apply them by ranged delta over their live base values.
export type AudioModulationValues = Record<string, number | undefined>;

// Ordered, serializable description of the screen post-FX chain the renderer
// compiles. params already include this frame's resolved node-scoped modulation.
export type PostChainNode = {
  id: string;
  kind: string;
  bypass: boolean;
  params: Record<string, number>;
  selects: Record<string, string>;
};

export type PostChainSpec = PostChainNode[];

// Which renderer inputs the graph topology currently connects. The renderer
// consumes only connected inputs: geometry hidden when the source->sink chain is
// broken, lighting off when lighting->renderer is cut. Derived from edges.
// One extra (non-default) field source's wave parameters, pushed to a renderer
// slot. freq/speed are spatial frequency + temporal speed; relief/undulate/color
// are this source's wave amplitudes (already §0-gated by the graph: 0 if a field
// is unwired).
export type FieldSlot = {
  freq: number;
  speed: number;
  // 0..1 phase from a Clock source. phaseConnected gates it because 0 is also a
  // valid wrapped phase value.
  phase: number;
  phaseConnected: boolean;
  relief: number;
  undulate: number;
  undulateFreq: number;
  color: number;
};

export type RenderInputs = {
  geometry: boolean;
  lighting: boolean;
  // palette->material:color. Cut it and material color falls back to neutral,
  // regardless of whether the material color output is routed to the scene.
  color: boolean;
  // material->renderer:surface. Cut it and physical material settings go neutral.
  material: boolean;
  // Surface material color/relief lanes into the Scene Pass, either directly or
  // through an optional Field Source processor. These are separate from the
  // palette input and from the field-source modulation outlets.
  materialColor: boolean;
  materialRelief: boolean;
  projection: boolean;
  // Three field-source outlets -> renderer inlets, one per field: displacement
  // bulge, relief wave, colour wave. Cut one and only that field stops; cut all
  // three and the surface is flat (modulo the scalar relief).
  fieldDisplace: boolean;
  fieldRelief: boolean;
  fieldColor: boolean;
  fieldUndulate: boolean;
  // Clock -> Field Source: gates procedural phase. Cut it and field waves stop
  // moving even if their amplitude/speed controls are non-zero.
  fieldPhase: boolean;
  // The Border node -> renderer:border wire. Cut it and the tile borders (the
  // edge mesh) stop rendering — a scene-composition node with zero effect when
  // disconnected.
  border: boolean;
};

export type GamutLabel = string;

export type CustomColors = Oklch[] | null;

export type GraphPresetAppState = {
  categoryId: string;
  customColors: CustomColors;
  dragMode: DragMode;
  gains: Partial<Gains>;
  selectedColor: number;
  settings: Partial<Settings>;
  targetId: string;
};

export type ProjectionGesture = {
  settings: Settings;
  onBoostPreview: (x: number, y: number) => void;
  onBoostCommit: (x: number, y: number) => void;
};
