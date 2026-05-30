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
export type RenderInputs = {
  geometry: boolean;
  lighting: boolean;
  color: boolean;
  material: boolean;
  projection: boolean;
  // Three field-source outlets -> renderer inlets, one per field: displacement
  // bulge, relief wave, colour wave. Cut one and only that field stops; cut all
  // three and the surface is flat (modulo the scalar relief).
  fieldDisplace: boolean;
  fieldRelief: boolean;
  fieldColor: boolean;
  fieldUndulate: boolean;
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
