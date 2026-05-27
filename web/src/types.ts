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
  level: number;
  bass: number;
  mid: number;
  treble: number;
  beat: number;
};

export type AudioTransport = {
  duration: number;
  currentTime: number;
  playing: boolean;
  loop: boolean;
};

export type AudioStatus = 'idle' | 'mic' | 'file';

export type WebAudioGraph = {
  features: AudioFeatures;
  status: AudioStatus;
  transport: AudioTransport;
  startMic: () => Promise<void>;
  loadFile: (file: File | undefined) => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  seek: (time: number) => void;
  setLoop: (loop: boolean) => void;
  stop: () => void;
};

export type Gains = {
  relief: number;
  emissive: number;
  film: number;
  metal: number;
};

export type GamutLabel = string;

export type CustomColors = Oklch[] | null;

export type ProjectionGesture = {
  settings: Settings;
  onBoost: (x: number, y: number) => void;
};
