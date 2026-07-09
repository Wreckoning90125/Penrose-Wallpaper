import {
  AgXToneMapping,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  EquirectangularReflectionMapping,
  Group,
  HemisphereLight,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  NoToneMapping,
  OrthographicCamera,
  Points,
  PointsNodeMaterial,
  RGBAFormat,
  RenderPipeline,
  RenderTarget,
  SRGBColorSpace,
  Scene,
  UnsignedByteType,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { MaterialXLoader } from 'three/examples/jsm/loaders/MaterialXLoader.js';
import type Node from 'three/src/nodes/core/Node.js';
import NodeBase from 'three/src/nodes/core/Node.js';
import type UniformNode from 'three/src/nodes/core/UniformNode.js';
import {
  attribute,
  abs,
  atanh,
  clamp,
  cross,
  dFdx,
  dFdy,
  negateOnBackSide,
  float,
  floor,
  max,
  min,
  mix,
  normalize,
  pass,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  tanh,
  transformNormalToView,
  uniform,
  vertexColor,
  vec2,
  vec3,
} from 'three/tsl';
import type { AudioFeatures, FieldSlot, PostChainNode, PostChainSpec, RenderInputs, TilingWindow } from '../types';
import { fxBuilder, afterImageDamp, type FxUniforms, type FxContext } from './postFxRegistry';
import { fxDescriptor, fxStructuralSignature } from './postFxCatalog';
import { intSetting, lightSettings, materialSettings, type MaterialSettings, type Settings } from '../settings/androidSettings';
import { MAX_COLORS, oklchToLinearSrgb, paletteColorAt, topologyPaletteSlot } from '../color/palette';
import type { Palette } from '../color/palette';
import type { AudioDriveEditState, AudioModulationValues, ProjectionGesture } from '../types';
import { clampNumber } from '../util/clamp';
import {
  applyModulationTargetRange,
  editHoldsParam,
  finiteModulation,
  modulationTargetDelta,
} from '../flow/modulationTargetRuntime';
import { audioTargetRange } from '../flow/audioTargets';
import { WINDOW_OVERSCAN } from '../tiling/windowedGeneration';
import penroseSurfaceMaterialX from './materialx/penrose-surface.mtlx?raw';
import { D4_DIAGONAL_STATES } from './truchetLaws';
import { sourceOverlayActiveForStyle } from '../tiling/capabilities';

type RendererUniforms = ReturnType<typeof createRendererUniforms>;
type DragMode = 'boost' | 'zoom' | 'pan' | 'rotate';
export type ViewGestureMode = 'rotate' | 'pan';
type WallpaperRendererOptions = {
  interactive?: boolean;
  pixelRatio?: number;
  onViewWindowChange?: () => void;
};
const TAU = Math.PI * 2;
const DEFAULT_WEBGPU_MAX_BUFFER_SIZE = 256 * 1024 * 1024;
const BORDER_PACKED_STRIDE = 18;
const BORDER_PACKED_ATTRIBUTES = [
  ['tileType', 1, 0],
  ['tileRing', 1, 1],
  ['tileOrient', 2, 2],
  ['tileCenter', 2, 4],
  ['tileRelief', 1, 6],
  ['tileShape', 1, 7],
  ['tileScale', 1, 8],
  ['tileLocal', 2, 9],
  ['tileTopology', 4, 11],
  ['edgeSide', 1, 15],
  ['edgeSlope', 2, 16],
] as const;
const RENDERER_AUDIO_SETTING_KEYS: readonly (keyof Settings)[] = [
  'brightness',
  'field_displace',
  'field_relief',
  'field_color',
  'field_undulate',
  'field_freq',
  'field_undulate_freq',
  'field_speed',
  'field_pattern',
  'hyp_boost_x',
  'hyp_boost_y',
  'hyp_scale',
  'proj_blend',
  'light_ambient',
  'light_angle',
  'light_elevation',
  'light_intensity',
  'light_warmth',
  'light_choreo_amount',
  'mat_anisotropy',
  'mat_clearcoat',
  'mat_emissive',
  'mat_iridescence',
  'mat_metal_mod',
  'mat_metalness',
  'mat_relief',
  'mat_facet_curve',
  'mat_relief_guide',
  'mat_ring_relief',
  'mat_lattice_spline',
  'mat_harnack',
  'mat_rough_mod',
  'mat_roughness',
  'mat_sheen',
  'surface_contour_amount',
  'surface_contour_source',
  'surface_contour_spacing',
  'surface_contour_width',
  'surface_contour_feature',
  'surface_stripe',
  'surface_contour_phase',
  'surface_contour_l',
  'surface_contour_c',
  'surface_contour_h',
  'source_mark_a_l',
  'source_mark_a_c',
  'source_mark_a_h',
  'source_mark_b_l',
  'source_mark_b_c',
  'source_mark_b_h',
  'source_mark_c_l',
  'source_mark_c_c',
  'source_mark_c_h',
  'ornament_amount',
  'ornament_density',
  'ornament_phase',
  'ornament_style',
  'ornament_twist',
  'ornament_width',
  'border_l',
  'border_c',
  'border_h',
  'border_a',
  'edge_profile_width',
  'edge_profile_glow',
  'edge_profile_l',
  'edge_profile_c',
  'edge_profile_h',
];
type DragState = {
  pointerId: number;
  mode: DragMode;
  x: number;
  y: number;
  rx: number;
  ry: number;
  zoom: number;
  panX: number;
  panY: number;
  bx: number;
  by: number;
};
const EMPTY_AUDIO_FEATURES: AudioFeatures = {
  bass: 0,
  mid: 0,
  high: 0,
  rms: 0,
  spectralFlux: 0,
  onsetStrength: 0,
  cwtTransient: 0,
  crestFactor: 0,
  beat: 0,
  beatPhase: 0,
  pulseLfo: 0,
  pulseConfidence: 0,
  beatConfidence: 0,
  tempoConfidence: 0,
  beatStrength: 0,
  tempo: 0,
  bpm: 120,
};
type SurfaceColorNode = NonNullable<MeshPhysicalNodeMaterial['colorNode']>;
type MaterialXStandardSurfaceInputs = {
  baseColor: SurfaceColorNode;
  opacity: Node;
  roughness: Node;
  metalness: Node;
  specular: Node;
  specularColor: Node;
  ior: Node;
  transmission: Node;
  thinFilmWeight: Node;
  thinFilmThickness: Node;
  thinFilmIor: Node;
  anisotropy: Node;
  sheen: Node;
  sheenRoughness: Node;
  coat: Node;
  coatRoughness: Node;
  coatNormal: Node;
  normal: Node;
  emission: Node;
};

function parsePenroseMaterialXSurface(): MeshPhysicalNodeMaterial {
  const parsed = new MaterialXLoader().parse(penroseSurfaceMaterialX);
  const material = parsed.materials['mat_penrose_surface'];
  const surface = material ?? new MeshPhysicalNodeMaterial();
  surface.anisotropyNode = null;
  return surface;
}

function applyMaterialXStandardSurface(material: MeshPhysicalNodeMaterial, inputs: MaterialXStandardSurfaceInputs): void {
  material.colorNode = inputs.baseColor;
  material.opacityNode = inputs.opacity;
  material.roughnessNode = inputs.roughness;
  material.metalnessNode = inputs.metalness;
  material.specularIntensityNode = inputs.specular;
  material.specularColorNode = inputs.specularColor;
  material.iorNode = inputs.ior;
  // Three's anisotropy node path is not equivalent to MaterialX anisotropy here;
  // enabling it flattened the surface response and regressed the first render.
  material.anisotropyNode = null;
  material.transmissionNode = inputs.transmission;
  material.iridescenceNode = inputs.thinFilmWeight;
  material.iridescenceThicknessNode = inputs.thinFilmThickness;
  material.iridescenceIORNode = inputs.thinFilmIor;
  material.sheenNode = inputs.sheen;
  material.sheenRoughnessNode = inputs.sheenRoughness;
  material.clearcoatNode = inputs.coat;
  material.clearcoatRoughnessNode = inputs.coatRoughness;
  material.clearcoatNormalNode = inputs.coatNormal;
  material.normalNode = inputs.normal;
  material.emissiveNode = inputs.emission;
}

function clampLinearColor(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function oklchToClampedLinearSrgb(color: [number, number, number]): [number, number, number] {
  const rgb = oklchToLinearSrgb(color);
  return [clampLinearColor(rgb[0]), clampLinearColor(rgb[1]), clampLinearColor(rgb[2])];
}

// Extra field-source wave slots (beyond the default source on slot 0). Each
// carries an independent spatial frequency and its own relief/undulate/colour
// wave amplitude; the graph fills them from connected field-source nodes.
// `phase` receives the CPU-accumulated (clock progress x slot speed) fract
// phase — speed itself never reaches the GPU. Default zero amplitude -> no
// contribution.
function createFieldSlots() {
  return Array.from({ length: 3 }, () => ({
    freq: uniform(4),
    phase: uniform(0),
    phaseMix: uniform(0),
    relief: uniform(0),
    undulate: uniform(0),
    undulateFreq: uniform(2.5),
    color: uniform(0),
    pattern: uniform(0),
  }));
}

function createRendererUniforms() {
  return {
    fieldSlots: createFieldSlots(),
    roughness: uniform(0.38),
    roughMod: uniform(0.2),
    metalness: uniform(0.35),
    metalMod: uniform(0.2),
    clearcoat: uniform(0.62),
    brushedStrength: uniform(0.28),
    iridescence: uniform(0.44),
    iridThicknessMin: uniform(120),
    iridThicknessMax: uniform(420),
    emissive: uniform(0),
    colorMix: uniform(1),
    materialMix: uniform(1),
    materialReliefMix: uniform(1),
    projectionMix: uniform(1),
    displaceMix: uniform(1),
    reliefMix: uniform(1),
    colorFieldMix: uniform(1),
    undulateMix: uniform(1),
    fieldPhaseMix: uniform(1),
    borderMix: uniform(1),
    bakedProjScale: uniform(1.525),
    bakedProjectionMix: uniform(0),
    projBlend: uniform(0),
    poincareScope: uniform(0),
    projScale: uniform(1.525),
    sheen: uniform(0.12),
    brightness: uniform(1),
    rippleAmp: uniform(0),
    rippleColorAmp: uniform(0),
    undulateAmp: uniform(0),
    rippleFreq: uniform(4),
    undulateFreq: uniform(2.5),
    fieldPattern: uniform(0),
    fieldSpeed: uniform(0.8),
    fieldPhase: uniform(0),
    // Continuous field-wave time base: fract of the CPU-integrated clock
    // progress x fieldSpeed (see setFieldPhase). The GPU must never multiply
    // the wrapped 0..1 clock phase by a non-integer speed — the old
    // speed.round() workaround froze every field_speed below 25.
    fieldWavePhase: uniform(0),
    ornamentStyle: uniform(0),
    ornamentAmount: uniform(0),
    ornamentWidth: uniform(0.45),
    ornamentDensity: uniform(1),
    ornamentPhase: uniform(0),
    ornamentTwist: uniform(0.5),
    surfaceContourAmount: uniform(0),
    surfaceContourSource: uniform(0),
    surfaceContourSpacing: uniform(16),
    surfaceContourWidth: uniform(0.18),
    surfaceContourFeature: uniform(0),
    surfaceStripe: uniform(0),
    surfaceContourPhase: uniform(0),
    surfaceContourR: uniform(0.92),
    surfaceContourG: uniform(0.9),
    surfaceContourB: uniform(0.78),
    borderR: uniform(0.92),
    borderG: uniform(0.86),
    borderB: uniform(0.62),
    borderA: uniform(0.4),
    edgeProfileWidth: uniform(0),
    edgeProfileGlow: uniform(0),
    edgeProfileR: uniform(1),
    edgeProfileG: uniform(1),
    edgeProfileB: uniform(1),
    overlayColorA: uniform(new Color(1.0, 0.08, 0.04)),
    overlayColorB: uniform(new Color(0.08, 0.34, 1.0)),
    overlayColorC: uniform(new Color(0.72, 0.72, 0.72)),
    overlayColorD: uniform(new Color(0.2, 0.2, 1.0)),
    overlayColorE: uniform(new Color(0.7, 0.7, 1.0)),
    overlayColorF: uniform(new Color(0.04, 0.045, 0.05)),
    overlayColorG: uniform(new Color(0.92, 0.88, 0.72)),
    familyId: uniform(0),
    depthScale: uniform(0.42),
    reliefScale: uniform(0.55),
    facetCurve: uniform(0),
    reliefGuide: uniform(0),
    ringRelief: uniform(0),
    latticeSpline: uniform(0),
    harnack: uniform(0),
    edgeDepthBias: uniform(0.0025),
    boostX: uniform(0),
    boostY: uniform(0),
  };
}

function writeFloatUniform(target: UniformNode<'float', number> | undefined, value: number): boolean {
  if (!target || target.value === value) return false;
  target.value = value;
  return true;
}

function writeFeedbackDerivedUniforms(uniforms: FxUniforms, key: string, value: number): boolean {
  if (key === 'rotate') {
    const sinChanged = writeFloatUniform(uniforms['rotateSin'], Math.sin(value));
    const cosChanged = writeFloatUniform(uniforms['rotateCos'], Math.cos(value));
    return sinChanged || cosChanged;
  }
  if (key === 'hue') {
    const angle = value * TAU;
    const sinChanged = writeFloatUniform(uniforms['hueSin'], Math.sin(angle));
    const cosChanged = writeFloatUniform(uniforms['hueCos'], Math.cos(angle));
    return sinChanged || cosChanged;
  }
  return false;
}

function displayScaleFromSettings(settings: Settings | Partial<Settings>): number {
  if (String(settings.projection) === '1') return 1;
  const value = intSetting(settings, 'hyp_scale', 0, 100);
  return 0.35 + value / 100 * 1.95;
}

function poincareScaleFromSettings(settings: Settings | Partial<Settings>): number {
  return 0.05 + intSetting(settings, 'hyp_scale', 0, 100) / 100 * 2.95;
}

export class WallpaperRenderer {
  container: HTMLElement;
  scene: Scene;
  camera: OrthographicCamera;
  group: Group;
  ambientLight: AmbientLight;
  hemiLight: HemisphereLight;
  keyLight: DirectionalLight;
  fillLight: DirectionalLight;
  renderer: WebGPURenderer;
  postPipeline: RenderPipeline | null;
  postChainSpec: PostChainSpec;
  postChainSignature: string;
  postChainUniforms: Map<string, FxUniforms>;
  // The scene pass is created ONCE and reused across pipeline rebuilds — recreating
  // it each rebuild orphaned a full-res HalfFloat render target (the dominant GPU
  // leak), since RenderPipeline.dispose() only frees its quad material.
  scenePassNode: ReturnType<typeof pass> | null;
  // The previous output-node tree, kept so a rebuild can free every render target
  // its addon FX nodes (bloom/anamorphic/RTT/etc.) own before discarding it.
  postOutputNode: Node | null;
  postBg: [number, number, number];
  // Shared scene-background uniform handed to builders via FxContext (the feedback
  // trail reads it for its surface mask); updated when the background changes.
  postBgUniform: UniformNode<'vec3', Vector3>;
  postFxContext: FxContext;
  paletteSignature: string;
  paletteColorAttribute: BufferAttribute | null;
  topologyPaletteColorAttribute: InterleavedBufferAttribute | null;
  uniforms: RendererUniforms;
  material: MeshPhysicalNodeMaterial;
  edgeMaterial: MeshBasicNodeMaterial;
  overlayMaterial: MeshBasicNodeMaterial;
  attractorMaterial: PointsNodeMaterial;
  mesh: Mesh<BufferGeometry, MeshPhysicalNodeMaterial> | null;
  edgeMeshes: Mesh<BufferGeometry, MeshBasicNodeMaterial>[];
  overlayMeshes: Mesh<BufferGeometry, MeshBasicNodeMaterial>[];
  attractorPoints: Points<BufferGeometry, PointsNodeMaterial> | null;
  retiredGeometries: { geometry: BufferGeometry; frames: number }[];
  renderConnected: boolean;
  attractorConnected: boolean;
  borderConnected: boolean;
  lightingConnected: boolean;
  baseMaterial: MaterialSettings;
  baseRippleAmp: number;
  baseDepthScale: number;
  baseScale: number;
  projectionScale: number;
  settings: Partial<Settings>;
  audioBoostX: number | null;
  audioBoostY: number | null;
  audioEditMode: AudioDriveEditState['dragMode'];
  audioFeatures: AudioFeatures;
  dragBoostX: number;
  dragBoostY: number;
  viewZoom: number;
  viewGestureMode: ViewGestureMode;
  viewPanX: number;
  viewPanY: number;
  // Clock-phase integration state (see setFieldPhase): the graph delivers a
  // wrapped 0..1 sawtooth; these accumulate unwrapped progress x speed so the
  // wave/choreography phases stay continuous at any non-integer speed.
  private clockPhasePrev: number;
  private clockHasPhase: boolean;
  private fieldWavePhaseAccum: number;
  private slotPhasePrev: number[];
  private slotPhaseAccum: number[];
  private slotHasPhase: boolean[];
  // Choreography phase arrives over the graph wire into lighting:phase (the
  // wire IS the source — clock/audio/operator); no wire means a static pose.
  private choreoPhase: number;
  private choreoPhaseConnected: boolean;
  // The currently modulated setting keys with their modulated values (null
  // when nothing is modulated). Every dynamic-state consumer reads through
  // effectiveSettings(), so base settings and modulation cannot clobber each
  // other regardless of caller order.
  private modulationOverlay: Partial<Settings> | null;
  initialized: boolean;
  renderFrame: number;
  renderRequested: boolean;
  drag: DragState | null;
  projectionGesture: ProjectionGesture | null;
  resizeObserver: ResizeObserver;
  warmupFrame: number;
  warmupFramesRemaining: number;
  lastResizeWidth: number;
  lastResizeHeight: number;
  deviceLost: boolean;
  onDeviceLost: ((message: string) => void) | null;
  onViewWindowChange: (() => void) | null;

  constructor(container: HTMLElement, options: WallpaperRendererOptions = {}) {
    if (!navigator.gpu) {
      throw new Error('WebGPU is required for this renderer');
    }

    this.container = container;
    this.scene = new Scene();
    this.camera = new OrthographicCamera(-1, 1, 1, -1, -5, 5);
    this.camera.position.set(0, 0, 2.8);
    this.scene.add(this.camera);
    this.group = new Group();
    this.scene.add(this.group);
    this.ambientLight = new AmbientLight(0xffffff, 0.3);
    this.hemiLight = new HemisphereLight(0xbfdcff, 0x24160c, 0.6);
    this.keyLight = new DirectionalLight(0xffffff, 2.2);
    this.fillLight = new DirectionalLight(0xb8d6ff, 0.55);
    this.keyLight.position.set(0.45, 0.7, 1.15);
    this.fillLight.position.set(-0.65, -0.35, 0.75);
    this.scene.add(this.ambientLight, this.hemiLight, this.keyLight, this.fillLight);

    this.renderer = new WebGPURenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(options.pixelRatio ?? Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = AgXToneMapping;
    this.renderer.toneMappingExposure = 1;
    container.appendChild(this.renderer.domElement);
    this.postPipeline = null;
    this.postChainSpec = [];
    this.postChainSignature = '';
    this.postChainUniforms = new Map();
    this.postBgUniform = uniform(new Vector3(0, 0, 0));
    this.postFxContext = { bg: this.postBgUniform };
    this.scenePassNode = null;
    this.postOutputNode = null;
    this.postBg = [0, 0, 0];
    this.paletteSignature = '';
    this.paletteColorAttribute = null;
    this.topologyPaletteColorAttribute = null;

    this.uniforms = createRendererUniforms();

    this.material = this.createMaterial();
    // The border mesh rides the same displaced surface as the fill. Push the fill
    // slightly back in depth, following Three's face/edge overlay pattern, so relief
    // does not depth-fight away strips of the border while depth testing still hides
    // genuinely occluded back-side edges.
    this.material.polygonOffset = true;
    this.material.polygonOffsetFactor = 1;
    this.material.polygonOffsetUnits = 1;
    this.edgeMaterial = new MeshBasicNodeMaterial({
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: DoubleSide,
    });
    this.edgeMaterial.positionNode = this.boostedEdgePositionNode();
    this.overlayMaterial = new MeshBasicNodeMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: DoubleSide,
    });
    this.overlayMaterial.positionNode = this.boostedEdgePositionNode(0.0);
    const overlayType = attribute<'float'>('tileType', 'float');
    this.overlayMaterial.colorNode = overlayType.greaterThan(float(5.5))
      .select(
        this.uniforms.overlayColorG,
        overlayType.greaterThan(float(4.5)).select(
          this.uniforms.overlayColorF,
          overlayType.greaterThan(float(3.5))
            .select(
              this.uniforms.overlayColorE,
              overlayType.greaterThan(float(2.5)).select(
                this.uniforms.overlayColorD,
                overlayType.greaterThan(float(1.5))
                  .select(this.uniforms.overlayColorC, overlayType.lessThan(float(0.5)).select(this.uniforms.overlayColorA, this.uniforms.overlayColorB)),
              ),
            ),
        ),
      );
    this.attractorMaterial = this.createAttractorMaterial();
    this.mesh = null;
    this.edgeMeshes = [];
    this.overlayMeshes = [];
    this.attractorPoints = null;
    this.retiredGeometries = [];
    this.renderConnected = true;
    this.attractorConnected = false;
    this.borderConnected = true;
    this.lightingConnected = true;
    this.baseMaterial = materialSettings({});
    this.baseRippleAmp = 0;
    this.baseDepthScale = 0.42;
    this.baseScale = 1;
    this.projectionScale = 1;
    this.settings = {};
    this.audioBoostX = null;
    this.audioBoostY = null;
    this.audioEditMode = 'ride';
    this.audioFeatures = EMPTY_AUDIO_FEATURES;
    this.dragBoostX = 50;
    this.dragBoostY = 50;
    this.viewZoom = 1;
    this.viewGestureMode = 'rotate';
    this.viewPanX = 0;
    this.viewPanY = 0;
    this.clockPhasePrev = 0;
    this.clockHasPhase = false;
    this.fieldWavePhaseAccum = 0;
    this.choreoPhase = 0;
    this.choreoPhaseConnected = false;
    this.modulationOverlay = null;
    this.slotPhasePrev = this.uniforms.fieldSlots.map(() => 0);
    this.slotPhaseAccum = this.uniforms.fieldSlots.map(() => 0);
    this.slotHasPhase = this.uniforms.fieldSlots.map(() => false);
    this.initialized = false;
    this.renderFrame = 0;
    this.renderRequested = false;
    this.drag = null;
    this.projectionGesture = null;
    this.warmupFrame = 0;
    this.warmupFramesRemaining = 0;
    this.lastResizeWidth = 0;
    this.lastResizeHeight = 0;
    this.deviceLost = false;
    this.onDeviceLost = null;
    this.onViewWindowChange = options.onViewWindowChange ?? null;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    if (options.interactive !== false) {
      this.renderer.domElement.addEventListener('contextmenu', event => event.preventDefault());
      this.renderer.domElement.addEventListener('pointerdown', event => this.startDrag(event));
      this.renderer.domElement.addEventListener('pointermove', event => this.dragPointer(event));
      this.renderer.domElement.addEventListener('pointerup', event => this.endDrag(event));
      this.renderer.domElement.addEventListener('pointercancel', event => this.endDrag(event));
      this.renderer.domElement.addEventListener('wheel', event => this.zoomWheel(event), { passive: false });
    }
  }

  async init(): Promise<void> {
    await this.renderer.init();
    this.initialized = true;
    // WebGPU can drop the device (alt-tab / GPU process change / memory
    // pressure). The canonical signal is the GPUDevice.lost promise (reached via
    // three's backend below) — deterministic, no per-frame pixel polling. Without
    // it the next render after a loss throws and cascades ("Instance dropped in
    // popErrorScope"). Detect it, stop the render/clock loops, surface it cleanly.
    const lost = this.deviceLostPromise();
    // Disposing the renderer calls device.destroy(), which resolves device.lost
    // with reason 'destroyed' — an intentional teardown, NOT a real loss. Ignore
    // it (mirroring three's own backend guard) so normal/StrictMode disposal does
    // not log a spurious device-lost error.
    if (lost) void lost.then(info => {
      if (info?.reason === 'destroyed') return;
      this.handleDeviceLost(info?.message ?? 'unspecified');
    });
    this.scene.environment = this.createEnvironmentTexture();
    this.rebuildPostPipeline();
    this.resize();
  }

  deviceLostPromise(): Promise<{ message?: string; reason?: string }> | null {
    // Reach the GPUDevice.lost promise through three's backend without a cast:
    // the intermediate is typed `object`, so Reflect.get returns a loose value
    // we narrow structurally.
    const backend: object = this.renderer.backend;
    const device = Reflect.get(backend, 'device');
    if (!device || typeof device !== 'object') return null;
    const lost = Reflect.get(device, 'lost');
    return lost instanceof Promise ? lost : null;
  }

  handleDeviceLost(message: string): void {
    if (this.deviceLost) return;
    this.deviceLost = true;
    // Fail hard and visibly — losing the device should NOT happen in this app,
    // so surface it (App shows a fatal screen) rather than silently degrade or
    // recover, to force fixing the root cause.
    console.error('[WallpaperRenderer] WebGPU device lost:', message);
    this.onDeviceLost?.(message);
  }

  createEnvironmentTexture(): DataTexture {
    const width = 32;
    const height = 16;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const t = y / Math.max(1, height - 1);
      for (let x = 0; x < width; x++) {
        const u = x / Math.max(1, width - 1);
        const i = (y * width + x) * 4;
        const band = Math.max(0, 1 - Math.abs(t - 0.42) * 5);
        data[i] = Math.round(18 + 150 * band + 34 * u);
        data[i + 1] = Math.round(20 + 132 * band + 20 * (1 - u));
        data[i + 2] = Math.round(24 + 116 * band + 42 * t);
        data[i + 3] = 255;
      }
    }
    const texture = new DataTexture(data, width, height, RGBAFormat);
    texture.mapping = EquirectangularReflectionMapping;
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  postChainSignatureOf(spec: PostChainSpec): string {
    return spec
      .map(node => `${node.id}:${node.kind}:${node.bypass ? 1 : 0}:${fxStructuralSignature(node.kind, node.params, node.selects)}`)
      .join('|');
  }

  postNodeIsNoop(node: PostChainNode): boolean {
    const p = (key: string, fallback: number): number => {
      const value = node.params[key];
      return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    };
    switch (node.kind) {
      case 'pixelate': return p('size', 1) <= 1;
      case 'posterize': return p('steps', 256) >= 256;
      case 'filmGrain': return p('amount', 0) <= 0;
      case 'rgbShift': return p('amount', 0) <= 0;
      case 'sobel': return p('mix', 0) <= 0;
      case 'afterImage': return p('trail', 0) <= 0;
      case 'chromaticAberration': return p('strength', 0) <= 0;
      case 'sepia': return p('mix', 0) <= 0;
      case 'bleach': return p('opacity', 0) <= 0;
      case 'colorGrade': return p('exposure', 0) === 0
        && p('contrast', 0) === 0
        && p('saturation', 1) === 1
        && p('temperature', 0) === 0
        && p('tint', 0) === 0;
      case 'vignette': return p('amount', 0) <= 0;
      case 'blur': return p('amount', 0) <= 0;
      case 'feedback': return p('trail', 0) <= 0;
      case 'aa': return (node.selects['mode'] ?? 'off') === 'off';
      case 'contours': return p('mix', 0) <= 0;
      default: return false;
    }
  }

  // Free every render target the discarded post-node tree owns. three's
  // RenderPipeline.dispose() frees only its quad material, and base Node.dispose()
  // just fires an event — so addon FX nodes (bloom/anamorphic/afterImage/trails)
  // and convertToTexture's RTTNode leak their GPU render targets across rebuilds
  // unless we walk the old tree and free them. Reused nodes (the scene pass and
  // cached uniforms) are protected so they survive into the next build.
  //
  // Only nodes that actually own a render target are disposed. Plain nodes and
  // shared TSL singletons (screenUV/screenSize are nodeImmutable, referenced app
  // wide) hold no RT, so they are left untouched — disposing them would needlessly
  // tear down a cache that is reused every frame.
  private disposePostTree(root: Node, keep: Set<object>): void {
    const visited = new Set<object>();
    const freeRenderTarget = (value: object): boolean => {
      if (Reflect.get(value, 'isRenderTarget') !== true) return false;
      const rtDispose = Reflect.get(value, 'dispose');
      if (typeof rtDispose === 'function') Reflect.apply(rtDispose, value, []);
      return true;
    };
    root.traverse(node => {
      if (keep.has(node) || visited.has(node)) return;
      visited.add(node);
      const nodeDispose = Reflect.get(node, 'dispose');
      if (typeof nodeDispose === 'function' && nodeDispose !== NodeBase.prototype.dispose) {
        Reflect.apply(nodeDispose, node, []);
        return;
      }
      let ownsRenderTarget = false;
      for (const key of Object.keys(node)) {
        const value = Reflect.get(node, key);
        if (!value || typeof value !== 'object') continue;
        if (freeRenderTarget(value)) {
          ownsRenderTarget = true;
        } else if (Array.isArray(value)) {
          // Bloom keeps arrays of horizontal/vertical blur render targets.
          for (const item of value) {
            if (item && typeof item === 'object' && freeRenderTarget(item)) ownsRenderTarget = true;
          }
        }
      }
      if (ownsRenderTarget && typeof nodeDispose === 'function') Reflect.apply(nodeDispose, node, []);
    });
  }

  rebuildPostPipeline(): void {
    const oldOutput = this.postOutputNode;
    // Reuse the scene pass; recreating it per rebuild leaked a full-res RT each time.
    const scenePass = this.scenePassNode ?? pass(this.scene, this.camera);
    this.scenePassNode = scenePass;
    // Protect everything still in use (scene pass + cached uniforms) from the
    // old-tree disposal below; only genuinely discarded nodes go. Stateful feedback
    // nodes need no special protection: a persisting one stays in the new tree, and
    // a discarded one is freed by disposePostTree like any other RT-owning node.
    const keep = new Set<object>();
    scenePass.traverse(node => keep.add(node));
    for (const uniforms of this.postChainUniforms.values()) {
      for (const value of Object.values(uniforms)) value.traverse(node => keep.add(node));
    }
    this.postPipeline?.dispose();
    if (oldOutput) this.disposePostTree(oldOutput, keep);
    const nextUniforms = new Map<string, FxUniforms>();
    let frame: Node = scenePass;
    // The toneMap node owns AgX only. The RenderPipeline still performs the
    // output color transform below, so bypassing toneMap removes the curve without
    // skipping sRGB encoding.
    let hasToneMap = false;
    for (const node of this.postChainSpec) {
      if (node.bypass) continue;
      if (node.kind === 'aa' && this.postNodeIsNoop(node)) continue;
      const descriptor = fxDescriptor(node.kind);
      if (!descriptor) continue;
      if (node.kind === 'toneMap') {
        hasToneMap = true;
        continue;
      }
      const builder = fxBuilder(node.kind);
      if (!builder) continue;
      const existing = this.postChainUniforms.get(node.id);
      const uniforms = existing ?? builder.createUniforms();
      nextUniforms.set(node.id, uniforms);
      frame = builder.apply(frame, uniforms, node, this.postFxContext);
    }

    this.postChainUniforms = nextUniforms;
    this.postOutputNode = frame;
    this.postPipeline = new RenderPipeline(this.renderer, frame);
    // The toneMap node owns ONLY the AgX tone curve. The sRGB output encode
    // always runs (outputColorTransform = true), so bypassing toneMap drops the
    // curve — highlights clip and wash out — instead of skipping the gamma
    // encode (which would just darken the whole frame). Cut/skip it, the curve
    // stops; the node is downstream of its place on the wire path.
    this.renderer.toneMapping = hasToneMap ? AgXToneMapping : NoToneMapping;
    this.postPipeline.outputColorTransform = true;
    this.postPipeline.needsUpdate = true;
  }

  setPostChain(spec: PostChainSpec): void {
    this.postChainSpec = spec;
    const signature = this.postChainSignatureOf(spec);
    let rebuilt = false;
    if (signature !== this.postChainSignature) {
      this.postChainSignature = signature;
      this.rebuildPostPipeline();
      rebuilt = true;
    }
    const uniformsChanged = this.writePostChainUniforms();
    if (rebuilt || uniformsChanged) this.render();
  }

  writePostChainUniforms(): boolean {
    let changed = false;
    for (const node of this.postChainSpec) {
      const uniforms = this.postChainUniforms.get(node.id);
      if (!uniforms) continue;
      // Feedback-domain effects (afterImage, feedback) map their `trail` 0..1 through
      // afterImageDamp into the decay/damp uniform; their other params write directly.
      const feedbackDomain = fxDescriptor(node.kind)?.compose === 'feedback';
      for (const [key, value] of Object.entries(node.params)) {
        const target = uniforms[key];
        if (!target) continue;
        let next = value;
        if (feedbackDomain && key === 'trail') next = afterImageDamp(value);
        // Dot-screen scale is a normalized 0..1 control mapped to raw scale 8*v^2,
        // so the coarse/useful range gets most of the slider and the degenerate
        // ultra-fine bottom is compressed into the first ~11% of travel.
        if (node.kind === 'dotScreen' && key === 'scale') next = value * value * 8;
        if (writeFloatUniform(target, next)) changed = true;
        if (node.kind === 'feedback' && writeFeedbackDerivedUniforms(uniforms, key, next)) changed = true;
      }
    }
    return changed;
  }

  // atanh's domain is (−1,1), so the negative-blend "expand" branch has to bound
  // its argument u = r·projScale/2. A HARD clamp(u, 0, 0.98) does that but is
  // many-to-one: every source radius past u = 0.98 maps to the SAME expanded
  // radius, collapsing the whole atlas periphery onto a single ring (overlapping
  // "sheets"/clipping and artifacts past the disk) with a C0 slope crease at the
  // boundary — the sharp disk edge, and the reason projTS (measured from this same
  // map) collapsed to ~0 so facet domes / relief vanished outside it. This is a
  // C1, strictly-monotone soft clamp instead: it is the IDENTITY for u ≤ T (so the
  // expand branch, projScale disk interior, proj_blend=0 and the whole positive
  // branch are byte-identical to before) and then bends smoothly toward — without
  // reaching — 1, so the periphery keeps expanding monotonically (no fold, no
  // crease) and dE/du stays > 0 everywhere (projTS never collapses). A final cap
  // < 1 keeps atanh finite for pathological radii; it sits well past any real tile.
  private softClampAtanhArg(u: Node<'float'>): Node<'float'> {
    const T = 0.98;
    const rem = 1 - T; // headroom below 1 that the soft region asymptotes into
    const base = clamp(u, float(0), float(T)); // = min(u, T) for u ≥ 0 (identity below T)
    const over = max(u.sub(T), float(0));
    const soft = base.add(over.mul(rem).div(over.add(rem)));
    return clamp(soft, float(0), float(0.9999));
  }

  // Reusable signed radial warp about the origin. effBlend in [-1,1]:
  // 0 = identity, + = tanh Poincaré compression (crowd toward the rim),
  // - = atanh expansion (bulge outward). Used for both the global projection
  // (about the scene centre) and the per-tile warp (about each tile centre).
  private signedRadialWarp(x: Node<'float'>, y: Node<'float'>, effBlend: Node<'float'>) {
    const r = x.mul(x).add(y.mul(y)).sqrt();
    const safeR = max(r, float(1e-6));
    const dirX = x.div(safeR);
    const dirY = y.div(safeR);
    const posAmount = max(effBlend, float(0));
    const negAmount = max(effBlend.negate(), float(0));
    const compR = tanh(r.mul(this.uniforms.projScale).mul(0.5));
    const expR = atanh(this.softClampAtanhArg(r.mul(this.uniforms.projScale).mul(0.5)))
      .mul(2)
      .div(max(this.uniforms.projScale, float(1e-6)));
    return {
      x: mix(mix(x, dirX.mul(compR), posAmount), dirX.mul(expR), negAmount),
      y: mix(mix(y, dirY.mul(compR), posAmount), dirY.mul(expR), negAmount),
    };
  }

  boostCoordinateNodes(x: Node<'float'>, y: Node<'float'>, tileCenter: Node<'vec2'> | null = null, tileScale: Node<'float'> | null = null) {
    // poincare_scope: 0 = global (whole layout), 1 = per-tile (about each tile
    // centre), 2 = both. Arithmetic gates are exact for the integer uniform.
    const scope = this.uniforms.poincareScope;
    const perTileGate = clamp(scope, 0.0, 1.0);                       // {0,1,1}
    const globalGate = float(1).sub(scope.mul(float(2).sub(scope)));  // {1,0,1}

    // Per-tile pre-warp: warp each tile's interior about its own centre with the
    // same signed radial map, then feed the result to the global stage so
    // scope=2 composes (per-tile first, then whole-layout). Fill and edge both
    // pass tileCenter, so borders stay attached. At projBlend=0 this is identity.
    //
    // The radial map is calibrated for the WHOLE-LAYOUT radius via projScale; a
    // per-tile offset (x-tileCenter) is tiny by comparison, so feeding raw local
    // coords remapped the tile by absolute distance and let it balloon past its
    // own boundary. Normalize the local offset by the tile radius (tileScale)
    // before warping and scale back after, so the disk map acts tile-relatively
    // and the warped interior stays within the tile. Shape of the map is
    // unchanged; only its domain is now the unit tile disk.
    let ix = x;
    let iy = y;
    if (tileCenter) {
      const s = tileScale ? max(tileScale, float(1e-4)) : float(1);
      const w = this.signedRadialWarp(
        x.sub(tileCenter.x).div(s),
        y.sub(tileCenter.y).div(s),
        this.uniforms.projBlend.mul(perTileGate),
      );
      ix = tileCenter.x.add(w.x.mul(s));
      iy = tileCenter.y.add(w.y.mul(s));
    }

    // The CPU mesh can already be baked into a Poincare disk at bakedProjScale.
    // Recover the source radius so the Euclid->Poincare slider still has a real
    // Euclidean endpoint instead of blending between two disk projections.
    const bakedR = ix.mul(ix).add(iy.mul(iy)).sqrt();
    const safeBakedR = max(bakedR, float(1e-6));
    const unprojectedR = atanh(clamp(bakedR, 0.0, 0.9999)).mul(2).div(max(this.uniforms.bakedProjScale, float(1e-6)));
    const rebakedR = tanh(unprojectedR.mul(this.uniforms.projScale).mul(0.5));
    const sourceX = mix(ix, ix.div(safeBakedR).mul(unprojectedR), this.uniforms.bakedProjectionMix);
    const sourceY = mix(iy, iy.div(safeBakedR).mul(unprojectedR), this.uniforms.bakedProjectionMix);
    const projectedX = mix(ix.div(safeBakedR).mul(tanh(bakedR.mul(this.uniforms.projScale).mul(0.5))), ix.div(safeBakedR).mul(rebakedR), this.uniforms.bakedProjectionMix);
    const projectedY = mix(iy.div(safeBakedR).mul(tanh(bakedR.mul(this.uniforms.projScale).mul(0.5))), iy.div(safeBakedR).mul(rebakedR), this.uniforms.bakedProjectionMix);

    // Continuous, SIGNED Euclid <-> Poincaré projection in the vertex shader,
    // gated by globalGate so scope=1 (per-tile only) leaves the whole layout
    // Euclidean. projBlend=0 (default) reproduces prior output for any scope.
    const effBlend = this.uniforms.projBlend.mul(globalGate);
    const posAmount = max(effBlend, float(0));
    const negAmount = max(effBlend.negate(), float(0));
    const expandR = atanh(this.softClampAtanhArg(bakedR.mul(this.uniforms.projScale).mul(0.5)))
      .mul(2)
      .div(max(this.uniforms.projScale, float(1e-6)));
    const expandedX = ix.div(safeBakedR).mul(expandR);
    const expandedY = iy.div(safeBakedR).mul(expandR);
    const px = mix(mix(sourceX, projectedX, posAmount), expandedX, negAmount);
    const py = mix(mix(sourceY, projectedY, posAmount), expandedY, negAmount);
    // projectionMix is the projection->palette inlet: 1 = the wired hyperbolic
    // boost, 0 = identity (flat). Cutting that wire flattens the projection
    // instead of hiding the mesh. bx=by=0 is exactly identity here.
    const bx = this.uniforms.boostX.mul(this.uniforms.projectionMix);
    const by = this.uniforms.boostY.mul(this.uniforms.projectionMix);
    const bb = bx.mul(bx).add(by.mul(by));
    const zz = px.mul(px).add(py.mul(py));
    const zb = px.mul(bx).add(py.mul(by));
    // Guard the Möbius denominator away from 0 (the CPU projectHyp clamps it to
    // 1e-6). Near the singularity — reachable with proj_blend + boost — an
    // unguarded divide yields Inf/NaN positions, and a single NaN pixel poisons
    // the feedback ping-pong buffer permanently (NaN*decay = NaN), which breaks
    // the surface/inverse trail mask. At the default (boost 0) denom = 1, no-op.
    const denom = max(bb.mul(zz).add(zb.mul(2)).add(1), float(1e-4));
    const oneMinusBoost = float(1).sub(bb);
    const boostedWeight = zz.add(zb.mul(2)).add(1);
    const boostedX = oneMinusBoost.mul(px).add(boostedWeight.mul(bx)).div(denom);
    const boostedY = oneMinusBoost.mul(py).add(boostedWeight.mul(by)).div(denom);
    return { x: boostedX, y: boostedY };
  }

  // Post-projection radius of a tile. Tile-normalized surface terms (the facet
  // dome, its guided C² profile, the Harnack field) live in boosted (projected)
  // space but were normalized by the PRE-projection tileScale, so under any
  // projection they no longer peaked at the centre / vanished at the rim. This
  // boosts a point one source tile-radius from the centre through the SAME map
  // the vertices take (global + per-tile + baked all included) and measures its
  // boosted distance from the boosted centre. The Poincaré/Möbius projection is
  // conformal, so this local scale is direction-independent to first order — one
  // sample suffices. In Euclidean the boost is identity, so it equals tileScale
  // and every tile-normalized term is byte-identical to today.
  private projectedTileScaleNode(
    tileCenter: Node<'vec2'>,
    tileScale: Node<'float'>,
    center: { x: Node<'float'>; y: Node<'float'> },
  ): Node<'float'> {
    const edge = this.boostCoordinateNodes(tileCenter.x.add(tileScale), tileCenter.y, tileCenter, tileScale);
    const dx = edge.x.sub(center.x);
    const dy = edge.y.sub(center.y);
    return max(dx.mul(dx).add(dy.mul(dy)).sqrt(), float(1e-4));
  }

  // A unit wave parameterized by spatial frequency plus an optional temporal
  // phase. phaseValue is a continuous 0..1 fract phase pre-integrated on the
  // CPU (clock progress x speed, see setFieldPhase/setFieldSlots), so any
  // real-valued speed animates smoothly and only speed 0 freezes the wave.
  fieldPatternNode(
    x: Node<'float'>,
    y: Node<'float'>,
    freq: Node<'float'>,
    phaseValue: Node<'float'>,
    phaseMix: Node<'float'>,
    pattern: Node<'float'>,
    tileTopology: Node<'vec4'>,
  ): Node<'float'> {
    const f = clamp(freq, 0.0, 20.0);
    const phase = phaseValue.mul(float(Math.PI * 2)).mul(phaseMix);
    const sine = sin(x.mul(f).add(y.mul(f.mul(0.73))).add(phase));
    const q0 = sin(x.mul(f).add(phase));
    const q1 = sin(x.mul(f.mul(-0.5)).add(y.mul(f.mul(0.8660254037844386))).add(phase));
    const q2 = sin(x.mul(f.mul(-0.5)).add(y.mul(f.mul(-0.8660254037844386))).add(phase));
    const quasicrystal = q0.add(q1).add(q2).mul(0.3333333333333333);
    const moire = sin(x.mul(f).add(phase))
      .mul(sin(x.mul(f.mul(0.9659258262890683)).add(y.mul(f.mul(0.25881904510252074))).add(phase)));
    const membrane = sin(x.mul(f.mul(0.62)).add(phase)).mul(sin(y.mul(f.mul(1.91)).add(phase)));
    const chladni = sin(x.mul(f).add(phase)).mul(sin(y.mul(f.mul(1.37)).add(phase))).sub(membrane).mul(0.5);
    const topologyFreq = max(f.mul(0.5), float(1.0));
    const adjacency = sin(clamp(tileTopology.x, 0.0, 1.0).mul(float(Math.PI * 2)).mul(topologyFreq).add(phase));
    const motif = sin(clamp(tileTopology.y, 0.0, 1.0).mul(float(Math.PI * 2)).mul(topologyFreq.add(0.37)).add(phase));
    const relaxed = clamp(tileTopology.z, 0.0, 1.0).mul(2.0).sub(1.0);
    const biharmonic = clamp(tileTopology.w, 0.0, 1.0).mul(2.0).sub(1.0);
    const p = clamp(pattern, 0.0, 7.0);
    return p.lessThan(float(0.5)).select(
      sine,
      p.lessThan(float(1.5)).select(
        quasicrystal,
        p.lessThan(float(2.5)).select(
          moire,
          p.lessThan(float(3.5)).select(
            chladni,
            p.lessThan(float(4.5)).select(
              adjacency,
              p.lessThan(float(5.5)).select(
                motif,
                p.lessThan(float(6.5)).select(relaxed, biharmonic),
              ),
            ),
          ),
        ),
      ),
    );
  }

  ornamentMaskNode(
    tileLocal: Node<'vec2'>,
    tileCenter: { x: Node<'float'>; y: Node<'float'> },
    tileOrient: Node<'vec2'>,
    tileType: Node<'float'>,
    tileScale: Node<'float'>,
  ): Node<'float'> {
    const transformChoice = clamp(this.uniforms.ornamentPhase, 0.0, 1.0).mul(2.0).round();
    const squareCellSize = max(tileScale.mul(1.4142135623730951), float(0.0001));
    const cellX = floor(tileCenter.x.mul(tileOrient.x).add(tileCenter.y.mul(tileOrient.y)).div(squareCellSize));
    const cellY = floor(tileCenter.y.mul(tileOrient.x).sub(tileCenter.x.mul(tileOrient.y)).div(squareCellSize));
    const parityX = cellX.sub(floor(cellX.mul(0.5)).mul(2));
    const parityY = cellY.sub(floor(cellY.mul(0.5)).mul(2));
    const latticeBit = abs(parityX.sub(parityY)).lessThan(float(0.5)).select(float(0), float(1));
    const d4State = clamp(tileType.mul(7.0).round(), 0.0, 7.0);
    const useD4 = abs(this.uniforms.familyId.sub(float(18))).lessThan(float(0.5));
    const baseU = tileLocal.x;
    const baseV = tileLocal.y;
    const weaveChoice = clamp(this.uniforms.ornamentTwist, 0.0, 1.0).mul(3.0).round();
    const flipUv = weaveChoice.greaterThan(float(1.5));
    const rawU = flipUv.select(baseV, baseU);
    const rawV = flipUv.select(baseU, baseV);
    // Notebook transform tile modes: 0 none; 1 inverse reverse; 2 mirror reverse.
    const inverseReverse = transformChoice.lessThan(float(1.5)).and(transformChoice.greaterThan(float(0.5)));
    const mirrorReverse = transformChoice.greaterThanEqual(float(1.5));
    const u = inverseReverse.select(rawU.negate(), mirrorReverse.select(rawU.negate(), rawU));
    const v = mirrorReverse.select(rawV.negate(), rawV);
    // Membership in D4_DIAGONAL_STATES — shared production data that the
    // truchet-sources gate cross-checks against the D4 matrix table.
    const d4TurnsDiagonal = D4_DIAGONAL_STATES
      .map(state => abs(d4State.sub(float(state))).lessThan(float(0.5)))
      .reduce((acc, term) => acc.or(term));
    const d4StateBit = d4TurnsDiagonal.select(float(1), float(0));
    const classBit = useD4.select(d4StateBit, tileType.lessThan(float(0.5)).select(float(0), float(1)));
    const bit = inverseReverse.select(float(1).sub(classBit), classBit);
    const width = mix(float(0.018), float(0.15), clamp(this.uniforms.ornamentWidth, 0.0, 1.0));
    const aa = float(0.006);
    const lineMask = (distance: Node<'float'>): Node<'float'> => (
      float(1).sub(smoothstep(width, width.add(aa), distance))
    );
    const quarterArc = (
      px: Node<'float'>,
      py: Node<'float'>,
      cx: number,
      cy: number,
      radius: number,
      signX: number,
      signY: number,
    ): Node<'float'> => {
      const dx = px.sub(cx);
      const dy = py.sub(cy);
      const quadrant = dx.mul(signX).greaterThanEqual(float(-0.001)).and(dy.mul(signY).greaterThanEqual(float(-0.001)));
      return quadrant.select(lineMask(abs(dx.mul(dx).add(dy.mul(dy)).sqrt().sub(radius))), float(0));
    };
    const truchetArcs = (px: Node<'float'>, py: Node<'float'>, bit: Node<'float'>): Node<'float'> => {
      const arc0 = max(
        quarterArc(px, py, 0.5, 0.5, 0.5, -1, -1),
        quarterArc(px, py, -0.5, -0.5, 0.5, 1, 1),
      );
      const arc1 = max(
        quarterArc(px, py, -0.5, 0.5, 0.5, 1, -1),
        quarterArc(px, py, 0.5, -0.5, 0.5, -1, 1),
      );
      return bit.lessThan(float(0.5)).select(arc0, arc1);
    };
    const truchetLines = (px: Node<'float'>, py: Node<'float'>, bit: Node<'float'>): Node<'float'> => {
      const line0 = lineMask(abs(px.sub(py)).mul(0.7071067811865476));
      const line1 = lineMask(abs(px.add(py)).mul(0.7071067811865476));
      return bit.lessThan(float(0.5)).select(line0, line1);
    };
    const singleArcs = truchetArcs(u, v, bit);
    const singleLines = truchetLines(u, v, bit);
    const d4ConnectedBit = abs(d4StateBit.sub(latticeBit)).greaterThan(float(0.5)).select(float(1), float(0));
    const connectedBit = useD4.select(d4ConnectedBit, abs(classBit.sub(latticeBit)).greaterThan(float(0.5)).select(float(1), float(0)));
    const connectedArcs = truchetArcs(u, v, connectedBit);
    const connectedLines = truchetLines(u, v, connectedBit);
    const style = clamp(this.uniforms.ornamentStyle, 0.0, 4.0);
    const truchet = style.lessThan(float(0.5)).select(
      float(0),
      style.lessThan(float(1.5)).select(
        singleArcs,
        style.lessThan(float(2.5)).select(
          singleLines,
          style.lessThan(float(3.5)).select(
            connectedArcs,
            style.lessThan(float(4.5)).select(float(0), connectedLines),
          ),
        ),
      ),
    );
    const density = clamp(this.uniforms.ornamentDensity, 0.0, 1.0);
    const active = density;
    return clamp(truchet.mul(active).mul(clamp(this.uniforms.ornamentAmount, 0.0, 1.0)).mul(this.uniforms.materialMix), 0.0, 1.0);
  }

  brushedMetalStreakNode(
    tileLocal: Node<'vec2'>,
    tileType: Node<'float'>,
    tileRing: Node<'float'>,
  ): Node<'float'> {
    const along = tileLocal.x;
    const across = tileLocal.y;
    const seed = tileType.mul(17.13).add(tileRing.mul(5.37));
    const warp = this.valueNoiseNode(across.mul(18.0).add(seed), seed.mul(0.23)).sub(0.5).mul(4.0);
    const longScratch = this.valueNoiseNode(
      along.mul(88.0).add(warp).add(seed),
      across.mul(2.5).add(seed.mul(0.19)),
    );
    const hairScratch = this.valueNoiseNode(
      along.mul(330.0).add(seed.mul(3.7)),
      across.mul(11.0).sub(seed.mul(0.31)),
    );
    const softBands = this.valueNoiseNode(
      across.mul(18.0).add(seed.mul(1.9)),
      along.mul(0.35).add(seed.mul(0.11)),
    );
    return clamp(
      longScratch.sub(0.5).mul(0.46).add(0.5)
        .add(hairScratch.sub(0.5).mul(0.30))
        .add(softBands.sub(0.5).mul(0.18)),
      0.0,
      1.0,
    );
  }

  tileMicroGrainNode(tileLocal: Node<'vec2'>, tileType: Node<'float'>, tileRing: Node<'float'>): Node<'float'> {
    const seed = tileType.mul(17.13).add(tileRing.mul(5.37));
    const coarse = this.valueNoiseNode(
      tileLocal.x.mul(31.0).add(seed.mul(0.37)),
      tileLocal.y.mul(31.0).sub(seed.mul(0.19)),
    );
    const fine = this.valueNoiseNode(
      tileLocal.x.mul(83.0).add(tileLocal.y.mul(7.0)).add(seed.mul(2.7)),
      tileLocal.y.mul(83.0).sub(tileLocal.x.mul(5.0)).sub(seed.mul(1.3)),
    );
    const pore = this.valueNoiseNode(
      tileLocal.x.add(tileLocal.y).mul(151.0).add(seed.mul(3.1)),
      tileLocal.x.sub(tileLocal.y).mul(37.0).sub(seed.mul(2.3)),
    );
    const crossHatch = sin(tileLocal.x.add(tileLocal.y).mul(211.0).add(seed.mul(5.29)))
      .mul(sin(tileLocal.x.sub(tileLocal.y).mul(173.0).sub(seed.mul(3.41))));
    return clamp(
      coarse.sub(0.5).mul(0.42).add(0.5)
        .add(fine.sub(0.5).mul(0.28))
        .add(pore.sub(0.5).mul(0.16))
        .add(crossHatch.mul(0.045)),
      0.0,
      1.0,
    );
  }

  hashNoiseNode(x: Node<'float'>, y: Node<'float'>): Node<'float'> {
    const h = sin(x.mul(127.1).add(y.mul(311.7))).mul(43758.5453123);
    return h.sub(floor(h));
  }

  valueNoiseNode(x: Node<'float'>, y: Node<'float'>): Node<'float'> {
    const ix = floor(x);
    const iy = floor(y);
    const fx = x.sub(ix);
    const fy = y.sub(iy);
    const ux = fx.mul(fx).mul(float(3.0).sub(fx.mul(2.0)));
    const uy = fy.mul(fy).mul(float(3.0).sub(fy.mul(2.0)));
    const a = this.hashNoiseNode(ix, iy);
    const b = this.hashNoiseNode(ix.add(1.0), iy);
    const c = this.hashNoiseNode(ix, iy.add(1.0));
    const d = this.hashNoiseNode(ix.add(1.0), iy.add(1.0));
    return mix(mix(a, b, ux), mix(c, d, ux), uy);
  }

  topologyFieldNode(
    tileType: Node<'float'>,
    tileRing: Node<'float'>,
    tileOrient: Node<'vec2'>,
    tileCenter: Node<'vec2'>,
  ): Node<'float'> {
    const axial = tileCenter.x.mul(tileOrient.x).add(tileCenter.y.mul(tileOrient.y));
    const lateral = tileCenter.y.mul(tileOrient.x).sub(tileCenter.x.mul(tileOrient.y));
    const phase = this.uniforms.fieldPhase
      .mul(float(Math.PI * 2))
      .mul(this.uniforms.fieldPhaseMix);
    const ringWave = sin(
      tileRing.mul(float(Math.PI * 2))
        .add(tileType.mul(4.713))
        .add(axial.mul(0.31))
        .add(phase),
    );
    const crossWave = sin(
      lateral.mul(0.27)
        .sub(tileRing.mul(3.883))
        .add(tileType.mul(2.17))
        .sub(phase.mul(0.37)),
    );
    return clamp(ringWave.add(crossWave).mul(0.25).add(0.5), 0.0, 1.0);
  }

  surfaceDepthNode(
    boostedX: Node<'float'>,
    boostedY: Node<'float'>,
    tileRing: Node<'float'>,
    tileOrient: Node<'vec2'>,
    tileCenter: Node<'vec2'>,
  ): Node<'float'> {
    const boostedCenter = this.boostCoordinateNodes(tileCenter.x, tileCenter.y);
    return this.surfaceDepthFromBoostedCenter(boostedX, boostedY, tileRing, tileOrient, boostedCenter);
  }

  surfaceDepthFromBoostedCenter(
    boostedX: Node<'float'>,
    boostedY: Node<'float'>,
    tileRing: Node<'float'>,
    tileOrient: Node<'vec2'>,
    boostedCenter: { x: Node<'float'>; y: Node<'float'> },
  ): Node<'float'> {
    const localX = boostedX.sub(boostedCenter.x);
    const localY = boostedY.sub(boostedCenter.y);
    const directionalDepth = localX.mul(tileOrient.x).add(localY.mul(tileOrient.y))
      .mul(this.uniforms.depthScale)
      .mul(0.12);
    const contourDepth = tileRing.sub(0.5).mul(this.uniforms.depthScale).mul(0.012);
    return directionalDepth.add(contourDepth);
  }

  // The surface z-displacement. The scalar material relief
  // (`tileRelief * reliefScale`) is a routed Surface Material lane: material
  // relief can go straight to the Scene Pass or through a Field Source. Three
  // distinct fields ride on top, each on its own §0 wire:
  //  - DISPLACE (per-tile bulge, gated by displaceMix),
  //  - RELIEF   (a wave that modulates the baked relief, gated by reliefMix),
  //  - UNDULATE (an ADDITIVE wave across the whole atlas — z += sin*amp — so flat
  //    regions undulate too; this is the "big wave", gated by undulateMix).
  // Cut a field's wire -> only that field stops; cut all -> static relief.
  surfaceZNode(
    boostedX: Node<'float'>,
    boostedY: Node<'float'>,
    tileType: Node<'float'>,
    tileRing: Node<'float'>,
    tileOrient: Node<'vec2'>,
    tileCenter: Node<'vec2'>,
    tileScale: Node<'float'>,
    tileRelief: Node<'float'>,
    tileShape: Node<'float'>,
    tileTopology: Node<'vec4'>,
    tileBoundaryRelief: Node<'float'>,
    tileLocal: Node<'vec2'> | null = null,
    boostedCenter?: { x: Node<'float'>; y: Node<'float'> },
    projTileScale?: Node<'float'>,
  ): Node<'float'> {
    const center = boostedCenter ?? this.boostCoordinateNodes(tileCenter.x, tileCenter.y);
    // Tile radius measured in the SAME (projected) space as boostedX/boostedY, so
    // tile-normalized terms below match what happens post-projection. Passed in by
    // surfaceSlopeNode so the 3 finite-difference calls share one evaluation.
    const projTS = projTileScale ?? this.projectedTileScaleNode(tileCenter, tileScale, center);
    const reliefBase = mix(tileRelief, tileBoundaryRelief, clamp(tileShape, 0.0, 1.0));
    const reliefZ = reliefBase
      .mul(this.uniforms.reliefScale)
      .mul(this.uniforms.materialMix)
      .mul(this.uniforms.materialReliefMix);
    const displaceField = this.surfaceDepthFromBoostedCenter(boostedX, boostedY, tileRing, tileOrient, center);
    const wave = this.fieldPatternNode(boostedX, boostedY, this.uniforms.rippleFreq, this.uniforms.fieldWavePhase, this.uniforms.fieldPhaseMix, this.uniforms.fieldPattern, tileTopology);
    const reliefField = reliefZ.mul(wave).mul(this.uniforms.rippleAmp);
    // Undulate is the whole-sheet wave: a 1-D plane wave displacing z (up), so the
    // flat atlas bends like paper. No relief term — any real relief just rides the
    // bent sheet (z heights add). Its frequency is its own driven control; shading
    // stays smooth at ANY frequency because the normal is analytic (surfaceNormalNode),
    // not the polygon face. Frequency sets the bend scale; it does NOT cause faceting.
    const undulateWave = this.fieldPatternNode(boostedX, boostedY, this.uniforms.undulateFreq, this.uniforms.fieldWavePhase, this.uniforms.fieldPhaseMix, this.uniforms.fieldPattern, tileTopology);
    const undulateField = undulateWave.mul(this.uniforms.undulateAmp);
    const fieldAnchor = tileType.mul(0).add(tileScale.mul(0));
    let z = reliefZ
      .add(displaceField.mul(this.uniforms.displaceMix))
      .add(reliefField.mul(this.uniforms.reliefMix))
      .add(undulateField.mul(this.uniforms.undulateMix))
      .add(fieldAnchor);
    // #3 Curved PN-triangle facet: a per-tile quadratic cap — convex dome peaking
    // at the tile centre, zero at its rim — the PN quadratic bulge that rounds a
    // flat facet. The shading normal auto-follows via surfaceSlopeNode's finite
    // differences. mat_facet_curve=0 leaves the surface flat (default), and it
    // rides the same relief gates so cutting the surface wire flattens it too.
    const fcx = boostedX.sub(center.x);
    const fcy = boostedY.sub(center.y);
    const fcr2 = fcx.mul(fcx).add(fcy.mul(fcy)).div(max(projTS.mul(projTS), float(1e-6)));
    // #7 Guided / Evolving-Guide relief: morph the facet cap profile from the C0
    // quadratic (1-r²) toward a C² raised cosine (½+½cos(πr)), which has zero
    // slope AND continuous curvature at the rim — the uniform-highlight-line
    // quality that guided subdivision targets. mat_relief_guide=0 = quadratic.
    const capR = clamp(fcr2.sqrt(), 0.0, 1.0);
    const capQuad = max(float(1).sub(fcr2), float(0));
    const capCos = float(0.5).add(sin(capR.mul(Math.PI).add(Math.PI / 2)).mul(0.5));
    const capProfile = mix(capQuad, capCos, clamp(this.uniforms.reliefGuide, 0.0, 1.0));
    const facetCap = capProfile
      .mul(this.uniforms.facetCurve)
      .mul(this.uniforms.reliefScale)
      .mul(this.uniforms.materialMix)
      .mul(this.uniforms.materialReliefMix)
      .mul(0.3);
    z = z.add(facetCap);
    // #6 Concentric tessellation rings (06ct): concentric relief rings about the
    // scene centre — the nested-ring surface structure of a concentric
    // tesselation map. mat_ring_relief=0 = off (default), rides the relief gates.
    const ringRad = boostedX.mul(boostedX).add(boostedY.mul(boostedY)).sqrt();
    const concentricRings = sin(ringRad.mul(9.0))
      .mul(this.uniforms.ringRelief)
      .mul(this.uniforms.reliefScale)
      .mul(this.uniforms.materialMix)
      .mul(this.uniforms.materialReliefMix)
      .mul(0.12);
    z = z.add(concentricRings);
    // #8 Multigrid <-> root-lattice reconstruction (SurfLab 09root Symmetric
    // Box-Splines on Root Lattices / 23boxcomp Practical Box Spline Compendium).
    // The de Bruijn multigrid that GENERATES the aperiodic tiling and a box spline
    // on the dual root lattice are two views of one cut-and-project lattice; the
    // smooth field a box spline reconstructs on that lattice is the quasiperiodic
    // sum of plane waves along the multigrid's N-fold star. We build that field
    // directly on the 5-fold pentagrid — the genuine multigrid<->lattice content —
    // as a relief. (A true discrete box-spline quasi-interpolant uses negative-lobe
    // weights on sampled lattice NODES; on a single continuous frequency any
    // symmetric stencil only rescales the amplitude, so we do not fake a
    // per-fragment reconstruction here.) lattice_spline = 0 = off (default); rides
    // the shared relief gates and is audio-modulatable.
    const bsFreq = 6.0;
    let boxSpline: Node<'float'> = float(0);
    for (let k = 0; k < 5; k++) {
      const ang = (2 * Math.PI * k) / 5;
      const t = boostedX.mul(Math.cos(ang)).add(boostedY.mul(Math.sin(ang))).mul(bsFreq);
      // cos via sin(x+π/2): cos not imported (matches capCos above).
      boxSpline = boxSpline.add(sin(t.add(Math.PI / 2)));
    }
    const latticeField = boxSpline
      .mul(1 / 5)
      .mul(this.uniforms.latticeSpline)
      .mul(this.uniforms.reliefScale)
      .mul(this.uniforms.materialMix)
      .mul(this.uniforms.materialReliefMix)
      .mul(0.12);
    z = z.add(latticeField);
    // #9 Harnack-traced relief (Gillespie, Yang, Botsch & Crane 2024, "Ray Tracing
    // Harmonic Functions"). Rather than displacing a mesh, that method marches to a
    // level set of a HARMONIC function using the Harnack safe step
    //   ρ = (R/2)(a + 2 − √(a²+8a)),  a = (f_t − c)/(f* − c)
    // (Eqs. 5-7), where c is a lower bound making the field positive on the ball.
    // As a default-off A/B relief law we evaluate the field the paper evaluates in
    // a shader — the homogenized harmonic polynomial Re((x+iy)^m) (Eqs. 1-4), here
    // m=5 so its 5-fold symmetry lines up with the pentagrid — soft-bound it, and
    // use the Harnack step as the height law so the relief contours ARE the
    // harmonic level sets. mat_harnack=0 = off; rides the shared relief gates.
    const hpx = boostedX.sub(center.x).div(max(projTS, float(1e-3)));
    const hpy = boostedY.sub(center.y).div(max(projTS, float(1e-3)));
    const hx2 = hpx.mul(hpx);
    const hy2 = hpy.mul(hpy);
    const hx3 = hpx.mul(hx2);
    // Re((x+iy)^5) = x^5 − 10 x^3 y^2 + 5 x y^4
    const re5 = hx3.mul(hx2).sub(hx3.mul(hy2).mul(10.0)).add(hpx.mul(hy2).mul(hy2).mul(5.0));
    // soft-bound the (unbounded) polynomial into (−1,1) so the ball radius stays valid
    const hf = re5.div(re5.mul(re5).add(1.0).sqrt());
    const harnackC = -8.0;   // lower bound c (shifts f positive on the ball)
    const harnackTarget = 0.0; // target level f*
    const aVal = hf.sub(harnackC).div(float(harnackTarget - harnackC));
    // ρ = (R/2)(a + 2 − √(a²+8a)); clamp the radicand ≥ 0 for shader safety
    const rho = aVal.add(2.0).sub(max(aVal.mul(aVal).add(aVal.mul(8.0)), float(0)).sqrt()).mul(0.5);
    const harnackRelief = rho
      .mul(this.uniforms.harnack)
      .mul(this.uniforms.reliefScale)
      .mul(this.uniforms.materialMix)
      .mul(this.uniforms.materialReliefMix);
    z = z.add(harnackRelief);
    if (tileLocal !== null) {
      const ornamentZ = this.ornamentMaskNode(tileLocal, { x: tileCenter.x, y: tileCenter.y }, tileOrient, tileType, tileScale)
        .mul(this.uniforms.reliefScale)
        .mul(this.uniforms.materialMix)
        .mul(this.uniforms.materialReliefMix)
        .mul(0.012);
      z = z.add(ornamentZ);
    }
    // Extra independent field sources: each adds its own wave's relief + undulate.
    for (const slot of this.uniforms.fieldSlots) {
      const slotWave = this.fieldPatternNode(boostedX, boostedY, slot.freq, slot.phase, slot.phaseMix, slot.pattern, tileTopology);
      const slotUndulate = this.fieldPatternNode(boostedX, boostedY, slot.undulateFreq, slot.phase, slot.phaseMix, slot.pattern, tileTopology);
      z = z.add(reliefZ.mul(slotWave).mul(slot.relief)).add(slotUndulate.mul(slot.undulate));
    }
    return z;
  }

  surfaceSlopeNode(
    boostedX: Node<'float'>,
    boostedY: Node<'float'>,
    tileType: Node<'float'>,
    tileRing: Node<'float'>,
    tileOrient: Node<'vec2'>,
    tileCenter: Node<'vec2'>,
    tileScale: Node<'float'>,
    tileRelief: Node<'float'>,
    tileShape: Node<'float'>,
    tileTopology: Node<'vec4'>,
    tileBoundaryRelief: Node<'float'>,
    tileLocal: Node<'vec2'> | null = null,
    boostedCenter?: { x: Node<'float'>; y: Node<'float'> },
  ): Node<'vec2'> {
    const eps = float(0.005);
    const center = boostedCenter ?? this.boostCoordinateNodes(tileCenter.x, tileCenter.y);
    // Compute the projected tile radius once and share it across the 3 finite-
    // difference samples below (it does not depend on the perturbed position).
    const projTS = this.projectedTileScaleNode(tileCenter, tileScale, center);
    const safeTileScale = max(tileScale, float(0.0001));
    const tileLocalDx = tileLocal
      ? vec2(
        tileLocal.x.add(eps.mul(tileOrient.x).div(safeTileScale)),
        tileLocal.y.sub(eps.mul(tileOrient.y).div(safeTileScale)),
      )
      : null;
    const tileLocalDy = tileLocal
      ? vec2(
        tileLocal.x.add(eps.mul(tileOrient.y).div(safeTileScale)),
        tileLocal.y.add(eps.mul(tileOrient.x).div(safeTileScale)),
      )
      : null;
    const z0 = this.surfaceZNode(boostedX, boostedY, tileType, tileRing, tileOrient, tileCenter, tileScale, tileRelief, tileShape, tileTopology, tileBoundaryRelief, tileLocal, center, projTS);
    const zx = this.surfaceZNode(boostedX.add(eps), boostedY, tileType, tileRing, tileOrient, tileCenter, tileScale, tileRelief, tileShape, tileTopology, tileBoundaryRelief, tileLocalDx, center, projTS);
    const zy = this.surfaceZNode(boostedX, boostedY.add(eps), tileType, tileRing, tileOrient, tileCenter, tileScale, tileRelief, tileShape, tileTopology, tileBoundaryRelief, tileLocalDy, center, projTS);
    return vec2(z0.sub(zx).div(eps), z0.sub(zy).div(eps));
  }

  // Smooth procedural fields use the analytic displacement gradient. Baked relief
  // is added back from the projected tent face normal so relief=0 stays visually
  // flat, while real relief still responds to fill subdivision.
  surfaceNormalNode(
    boostedX: Node<'float'>,
    boostedY: Node<'float'>,
    tileType: Node<'float'>,
    tileRing: Node<'float'>,
    tileOrient: Node<'vec2'>,
    tileCenter: Node<'vec2'>,
    tileScale: Node<'float'>,
    tileRelief: Node<'float'>,
    tileShape: Node<'float'>,
    tileTopology: Node<'vec4'>,
    tileReliefSlope: Node<'vec2'>,
    tileBoundaryRelief: Node<'float'>,
    tileLocal: Node<'vec2'> | null = null,
  ): Node {
    const boostedCenter = this.boostCoordinateNodes(tileCenter.x, tileCenter.y);
    const proceduralSlope = this.surfaceSlopeNode(boostedX, boostedY, tileType, tileRing, tileOrient, tileCenter, tileScale, tileRelief, float(0), tileTopology, tileBoundaryRelief, tileLocal, boostedCenter);
    // Match the drawn projected XY so Poincare scale/boost and high-aspect tiles
    // do not shade against a different surface than the one being rendered.
    const bakedPos = vec3(
      boostedX,
      boostedY,
      tileRelief
        .mul(this.uniforms.reliefScale)
        .mul(this.uniforms.materialMix)
        .mul(this.uniforms.materialReliefMix),
    );
    const nBaked = normalize(cross(dFdx(bakedPos), dFdy(bakedPos)));
    const nBakedUp = nBaked.z.lessThan(float(0)).select(nBaked.negate(), nBaked);
    const bakedZ = max(nBakedUp.z, float(0.08));
    const bgx = clamp(nBakedUp.x.div(bakedZ), float(-4), float(4));
    const bgy = clamp(nBakedUp.y.div(bakedZ), float(-4), float(4));
    const shapeMix = clamp(tileShape, 0.0, 1.0);
    const bakedMix = float(1).sub(shapeMix);
    const reliefMix = this.uniforms.reliefScale.mul(this.uniforms.materialMix).mul(this.uniforms.materialReliefMix);
    const spectreSlope = tileReliefSlope.mul(reliefMix).mul(shapeMix);
    const localNormal = normalize(vec3(
      proceduralSlope.x.add(bgx.mul(bakedMix)).add(spectreSlope.x),
      proceduralSlope.y.add(bgy.mul(bakedMix)).add(spectreSlope.y),
      float(1),
    ));
    const nView = transformNormalToView(localNormal);
    return negateOnBackSide(nView);
  }

  // The boosted (projected) surface coordinates plus the per-tile attributes the
  // surface z / normal nodes need. Shared by the position and normal builders.
  private boostedSurfaceInputs() {
    const tileType = attribute<'float'>('tileType', 'float');
    const tileRing = attribute<'float'>('tileRing', 'float');
    const tileOrient = attribute<'vec2'>('tileOrient', 'vec2');
    const tileCenter = attribute<'vec2'>('tileCenter', 'vec2');
    const tileRelief = attribute<'float'>('tileRelief', 'float');
    const tileShape = attribute<'float'>('tileShape', 'float');
    const tileScale = attribute<'float'>('tileScale', 'float');
    const tileReliefSlope = attribute<'vec2'>('tileReliefSlope', 'vec2');
    const tileTopology = attribute<'vec4'>('tileTopology', 'vec4');
    const boosted = this.boostCoordinateNodes(positionLocal.x, positionLocal.y, tileCenter, tileScale);
    return { boosted, tileType, tileRing, tileOrient, tileCenter, tileRelief, tileShape, tileScale, tileReliefSlope, tileTopology };
  }

  boostedPositionNode() {
    const { boosted, tileType, tileRing, tileOrient, tileCenter, tileScale, tileRelief, tileShape, tileTopology } = this.boostedSurfaceInputs();
    return vec3(
      boosted.x,
      boosted.y,
      this.surfaceZNode(
        boosted.x,
        boosted.y,
        tileType,
        tileRing,
        tileOrient,
        tileCenter,
        tileScale,
        tileRelief,
        tileShape,
        tileTopology,
        positionLocal.z,
        attribute<'vec2'>('tileLocal', 'vec2'),
      ),
    );
  }

  surfaceNormalForMaterial(): Node {
    const { boosted, tileType, tileRing, tileOrient, tileCenter, tileScale, tileRelief, tileShape, tileReliefSlope, tileTopology } = this.boostedSurfaceInputs();
    return this.surfaceNormalNode(boosted.x, boosted.y, tileType, tileRing, tileOrient, tileCenter, tileScale, tileRelief, tileShape, tileTopology, tileReliefSlope, positionLocal.z, attribute<'vec2'>('tileLocal', 'vec2'));
  }

  boostedEdgePositionNode(depthBiasScale = 1.0) {
    const tileType = attribute<'float'>('tileType', 'float');
    const tileRing = attribute<'float'>('tileRing', 'float');
    const tileOrient = attribute<'vec2'>('tileOrient', 'vec2');
    const tileCenter = attribute<'vec2'>('tileCenter', 'vec2');
    const tileRelief = attribute<'float'>('tileRelief', 'float');
    const tileShape = attribute<'float'>('tileShape', 'float');
    const tileScale = attribute<'float'>('tileScale', 'float');
    const tileLocal = attribute<'vec2'>('tileLocal', 'vec2');
    const tileTopology = attribute<'vec4'>('tileTopology', 'vec4');
    const boosted = this.boostCoordinateNodes(positionLocal.x, positionLocal.y, tileCenter, tileScale);
    const edgeSide = attribute<'float'>('edgeSide', 'float');
    const edgeSlope = attribute<'vec2'>('edgeSlope', 'vec2');
    const boostedCenter = this.boostCoordinateNodes(tileCenter.x, tileCenter.y);
    const proceduralSlope = this.surfaceSlopeNode(boosted.x, boosted.y, tileType, tileRing, tileOrient, tileCenter, tileScale, tileRelief, float(0), tileTopology, positionLocal.z, tileLocal, boostedCenter);
    const reliefMix = this.uniforms.reliefScale.mul(this.uniforms.materialMix).mul(this.uniforms.materialReliefMix);
    const localNormal = normalize(vec3(
      proceduralSlope.x.add(edgeSlope.x.mul(reliefMix)),
      proceduralSlope.y.add(edgeSlope.y.mul(reliefMix)),
      float(1),
    ));
    const baseDepthBias = this.uniforms.edgeDepthBias.mul(depthBiasScale);
    const clearance = clamp(
      baseDepthBias.div(max(localNormal.z, float(0.35))),
      baseDepthBias,
      baseDepthBias.mul(2.5),
    ).mul(edgeSide);
    const z = this.surfaceZNode(boosted.x, boosted.y, tileType, tileRing, tileOrient, tileCenter, tileScale, tileRelief, tileShape, tileTopology, positionLocal.z, tileLocal, boostedCenter);
    return vec3(
      boosted.x.add(localNormal.x.mul(clearance)),
      boosted.y.add(localNormal.y.mul(clearance)),
      z.add(localNormal.z.mul(clearance)),
    );
  }

  createMaterial(): MeshPhysicalNodeMaterial {
    const tileType = attribute<'float'>('tileType', 'float');
    const tileRing = attribute<'float'>('tileRing', 'float');
    const tileCenter = attribute<'vec2'>('tileCenter', 'vec2');
    const tileScale = attribute<'float'>('tileScale', 'float');
    const tileRelief = attribute<'float'>('tileRelief', 'float');
    const tileEdgeDistance = attribute<'vec3'>('tileEdgeDistance', 'vec3');
    const tileLocal = attribute<'vec2'>('tileLocal', 'vec2');
    const tileOrient = attribute<'vec2'>('tileOrient', 'vec2');
    const tileTopology = attribute<'vec4'>('tileTopology', 'vec4');
    const topologyPaletteColor = attribute<'vec3'>('topologyPaletteColor', 'vec3');
    const ornament = this.ornamentMaskNode(
      tileLocal,
      { x: tileCenter.x, y: tileCenter.y },
      tileOrient,
      tileType,
      tileScale,
    );
    let rippleColor = this.fieldPatternNode(positionLocal.x, positionLocal.y, this.uniforms.rippleFreq, this.uniforms.fieldWavePhase, this.uniforms.fieldPhaseMix, this.uniforms.fieldPattern, tileTopology).mul(this.uniforms.rippleColorAmp).mul(this.uniforms.colorFieldMix);
    for (const slot of this.uniforms.fieldSlots) {
      rippleColor = rippleColor.add(this.fieldPatternNode(positionLocal.x, positionLocal.y, slot.freq, slot.phase, slot.phaseMix, slot.pattern, tileTopology).mul(slot.color));
    }
    const material = parsePenroseMaterialXSurface();
    material.side = DoubleSide;
    // colorNode reads vertexColor() explicitly below so graph gating can mix it.
    // Leaving vertexColors=true makes NodeMaterial multiply the palette a second
    // time in r184.
    material.vertexColors = false;
    // colorMix is the palette->material:color inlet: 1 = palette color, 0 = flat
    // white. Cutting that wire drops the color (flat tiles) instead of hiding
    // the mesh — the material is downstream of its color inlet.
    // brightness lives on the material node; gate it by matMix so a disconnected
    // material has zero effect (matMix 0 -> neutral 1.0). The colour ripple field
    // is gated separately by colorFieldMix.
    const mtlxSpecularColor = material.specularColorNode ?? vec3(1.0, 1.0, 1.0);
    const mtlxIor = material.iorNode ?? float(1.5);
    const mtlxThinFilmIor = material.iridescenceIORNode ?? float(1.5);
    const mtlxTransmission = material.transmissionNode ?? float(0.0);
    const topologyField = this.topologyFieldNode(tileType, tileRing, tileOrient, tileCenter);
    const structuralField = clamp(
      topologyField.mul(0.52)
        .add(tileTopology.x.mul(0.18))
        .add(tileTopology.y.mul(0.14))
        .add(tileTopology.z.mul(0.16)),
      0.0,
      1.0,
    );
    const biharmonicField = clamp(tileTopology.w, 0.0, 1.0);
    const topologySigned = structuralField.sub(0.5);
    const topologyMotion = clamp(this.uniforms.rippleColorAmp.mul(4.5), 0.0, 1.0)
      .mul(this.uniforms.colorFieldMix)
      .mul(this.uniforms.materialMix);
    const topologyPaletteBlend = clamp(abs(topologySigned).mul(topologyMotion).mul(1.35), 0.0, 0.82);
    const paletteMovedColor = mix(vertexColor(), topologyPaletteColor, topologyPaletteBlend);
    const materialColor = mix(vec3(1.0, 1.0, 1.0), paletteMovedColor, this.uniforms.colorMix);
    const materialBrightness = mix(float(1.0), this.uniforms.brightness, this.uniforms.materialMix).add(rippleColor);
    const tileSurfaceColor = mix(vec3(1.0, 1.0, 1.0), materialColor, this.uniforms.materialMix).mul(materialBrightness);
    const ornamentedColor = mix(tileSurfaceColor, vec3(1.0, 0.78, 0.42), ornament.mul(0.48));
    const brushedStreak = this.brushedMetalStreakNode(tileLocal, tileType, tileRing);
    const brushedSigned = brushedStreak.sub(0.5)
      .mul(clamp(this.uniforms.brushedStrength, 0.0, 1.0))
      .mul(this.uniforms.materialMix);
    const grain = this.tileMicroGrainNode(tileLocal, tileType, tileRing);
    const topologyTint = mix(vec3(0.78, 0.9, 1.0), vec3(1.0, 0.82, 0.56), structuralField);
    const patina = clamp(
      mix(grain, tileRing, 0.55)
        .mul(max(this.uniforms.roughMod, this.uniforms.metalMod))
        .mul(this.uniforms.materialMix),
      0.0,
      1.0,
    );
    const topologyColorGain = topologySigned.mul(topologyMotion);
    const brushedColor = ornamentedColor
      .mul(clamp(float(1).add(brushedSigned.mul(0.12)).sub(patina.mul(0.08)).add(topologyColorGain.mul(0.10)), 0.82, 1.16))
      .add(topologyTint.mul(abs(topologyColorGain).mul(0.045)));
    material.positionNode = this.boostedPositionNode();
    const surfaceNormal = this.surfaceNormalForMaterial();
    // materialMix is the material->renderer:surface inlet: 1 = tuned material,
    // 0 = neutral matte (rough 0.5, no metal/clearcoat/aniso/irid/sheen). Cutting
    // that wire renders a plain surface instead of hiding the mesh — the material
    // is downstream of its surface inlet. Default 1 leaves the look untouched.
    const matMix = this.uniforms.materialMix;
    const edgeDist = clamp(min(min(tileEdgeDistance.x, tileEdgeDistance.y), tileEdgeDistance.z), 0.0, 1.0);
    const trueEdgeSeam = float(1).sub(smoothstep(0.0, 0.11, edgeDist));
    const seamRead = trueEdgeSeam.mul(this.uniforms.roughMod);
    const ridgeBasis = vec3(edgeDist, trueEdgeSeam, tileRelief.mul(this.uniforms.reliefScale));
    const ridgeDx = dFdx(ridgeBasis);
    const ridgeDy = dFdy(ridgeBasis);
    const normalFlux = ridgeDx.x.mul(ridgeDx.x)
      .add(ridgeDx.y.mul(ridgeDx.y))
      .add(ridgeDx.z.mul(ridgeDx.z))
      .add(ridgeDy.x.mul(ridgeDy.x))
      .add(ridgeDy.y.mul(ridgeDy.y))
      .add(ridgeDy.z.mul(ridgeDy.z))
      .sqrt();
    const ridgeHighlight = clamp(
      normalFlux.mul(this.uniforms.reliefScale).mul(this.uniforms.materialReliefMix).mul(matMix).mul(4.5),
      0.0,
      0.18,
    );
    const contactShadow = clamp(
      trueEdgeSeam.mul(this.uniforms.reliefScale).mul(this.uniforms.materialReliefMix).mul(matMix).mul(0.24),
      0.0,
      0.28,
    );
    const contourSource = clamp(this.uniforms.surfaceContourSource, 0.0, 7.0);
    // True surface isolines. Contour the ACTUAL displaced relief surface, not a
    // tile-space scalar: source 0 is the surface HEIGHT (positionWorld.z after the
    // vertex displacement), so the lines are real relief isolines that follow the
    // curved, already-subdivided surface — the guided-subdivision highlight-line
    // inspection. The other sources inspect alternative per-fragment fields
    // (curvature ~ highlight lines, luminance, topology). Every source is drawn at
    // constant SCREEN width below via screen-space derivatives, so nothing smears
    // across whole tiles.
    const surfaceHeight = positionWorld.z;
    const reliefContourScalar = clamp(tileRelief.mul(3.0).add(0.5), 0.0, 1.0);
    const luminanceScalar = clamp(
      brushedColor.x.mul(0.2126).add(brushedColor.y.mul(0.7152)).add(brushedColor.z.mul(0.0722)),
      0.0,
      1.0,
    );
    const curvatureScalar = clamp(normalFlux.mul(18.0), 0.0, 1.0);
    const adjacencyScalar = clamp(tileTopology.x, 0.0, 1.0);
    const motifScalar = clamp(tileTopology.y, 0.0, 1.0);
    const relaxedScalar = clamp(tileTopology.z, 0.0, 1.0);
    const contourScalar = contourSource.lessThan(float(0.5)).select(
      surfaceHeight,
      contourSource.lessThan(float(1.5)).select(
        reliefContourScalar,
        contourSource.lessThan(float(2.5)).select(
          luminanceScalar,
          contourSource.lessThan(float(3.5)).select(
            curvatureScalar,
            contourSource.lessThan(float(4.5)).select(
              adjacencyScalar,
              contourSource.lessThan(float(5.5)).select(
                motifScalar,
                contourSource.lessThan(float(6.5)).select(relaxedScalar, biharmonicField),
              ),
            ),
          ),
        ),
      ),
    );
    // Isoline banding: `banded` increments by 1 per contour line, so the distance
    // to the nearest integer is the distance to a line. The screen-space
    // derivative magnitude of `banded` = how much that value changes per screen
    // pixel; dividing by it makes the lines a
    // constant pixel width regardless of how steep the surface is under projection
    // or how slowly the field varies — this is what stops the old fixed-threshold
    // bands from flooding flat tiles.
    const contourBanded = contourScalar.mul(clamp(this.uniforms.surfaceContourSpacing, 1.0, 64.0)).add(this.uniforms.surfaceContourPhase);
    const contourDistToLine = abs(contourBanded.sub(floor(contourBanded.add(0.5))));
    // Screen-space derivative magnitude of contourBanded (|dFdx|+|dFdy|). The TSL
    // derivative nodes take a vector, so pack the scalar into a vec3 and read one
    // component.
    const contourBandedVec = vec3(contourBanded, contourBanded, contourBanded);
    const contourAa = max(abs(dFdx(contourBandedVec).x).add(abs(dFdy(contourBandedVec).x)), float(1e-5));
    const contourHalfWidth = clamp(this.uniforms.surfaceContourWidth.mul(8.0), 0.5, 4.0);
    const contourBands = float(1).sub(smoothstep(contourHalfWidth.mul(contourAa), contourHalfWidth.add(1.0).mul(contourAa), contourDistToLine))
      .mul(clamp(this.uniforms.surfaceContourAmount, 0.0, 1.0))
      .mul(matMix);
    // Feature-curve profile (Parilov–Zorin): a resolution-independent crisp edge
    // band shaped by the true tile-edge distance field, blended in by
    // surface_contour_feature. 0 = plain periodic bands (unchanged default).
    const featureWidth = clamp(this.uniforms.surfaceContourWidth.mul(2.0), 0.02, 0.6);
    const featureProfile = float(1).sub(smoothstep(0.0, featureWidth, edgeDist));
    const featureBand = featureProfile.mul(featureProfile)
      .mul(clamp(this.uniforms.surfaceContourAmount, 0.0, 1.0))
      .mul(matMix);
    const contourMask = mix(
      contourBands,
      max(contourBands, featureBand),
      clamp(this.uniforms.surfaceContourFeature, 0.0, 1.0),
    );
    const roughnessInput = this.uniforms.roughness
      .add(tileRing.mul(this.uniforms.roughMod))
      .add(seamRead.mul(0.65))
      .add(abs(brushedSigned).mul(0.16))
      .add(patina.mul(0.14))
      .add(abs(topologySigned).mul(topologyMotion).mul(0.08))
      .add(abs(biharmonicField.sub(0.5)).mul(topologyMotion).mul(0.06))
      .sub(ornament.mul(0.18));
    const roughnessNode = clamp(
      mix(float(0.5), roughnessInput, matMix),
      0.035,
      1.0,
    );
    const metalnessInput = this.uniforms.metalness
      .add(tileType.mul(this.uniforms.metalMod))
      .add(trueEdgeSeam.mul(this.uniforms.metalMod).mul(0.12))
      .add(ornament.mul(0.22))
      .sub(patina.mul(this.uniforms.metalMod).mul(0.08));
    const specularWeight = clamp(float(0.5).mul(float(0.85).sub(roughnessNode.mul(0.25))), 0.18, 0.7).mul(matMix);
    const coatWeight = this.uniforms.clearcoat.mul(matMix).mul(float(0.85).sub(roughnessNode.mul(0.2)));
    const thinFilmWeight = clamp(this.uniforms.iridescence.mul(float(0.7).add(tileRing.mul(0.3))), 0.0, 0.82).mul(matMix);
    const thinFilmThickness = clamp(
      this.uniforms.iridThicknessMin.add(
        this.uniforms.iridThicknessMax.sub(this.uniforms.iridThicknessMin)
          .mul(clamp(tileRing.mul(0.46).add(structuralField.mul(0.32)).add(biharmonicField.mul(0.22)), 0.0, 1.0)),
      ),
      1.0,
      1200.0,
    );
    const anisotropyStrength = clamp(this.uniforms.brushedStrength, 0.0, 1.0)
      .mul(matMix)
      .mul(float(1).sub(roughnessNode.mul(0.35)));
    const tileEmissive = vertexColor().mul(
      this.uniforms.emissive.add(max(rippleColor, 0.0).mul(0.35)).add(ornament.mul(0.14)).add(structuralField.mul(topologyMotion).mul(0.08)),
    );
    const shadedSurfaceColor = brushedColor
      .mul(float(1).sub(seamRead.mul(matMix).mul(0.14)).sub(contactShadow))
      .add(vec3(1.0, 0.92, 0.72).mul(ridgeHighlight));
    const edgeProfileAmount = clamp(this.uniforms.edgeProfileWidth, 0.0, 1.0)
      .mul(matMix)
      .mul(this.uniforms.borderMix);
    const edgeProfileSpan = max(edgeProfileAmount.mul(0.18), float(0.001));
    const edgeProfileMask = float(1).sub(smoothstep(edgeProfileSpan, edgeProfileSpan.add(0.035), edgeDist))
      .mul(edgeProfileAmount);
    const edgeProfileColor = vec3(this.uniforms.edgeProfileR, this.uniforms.edgeProfileG, this.uniforms.edgeProfileB);
    const profiledEdgeColor = mix(
      shadedSurfaceColor,
      edgeProfileColor,
      clamp(edgeProfileMask.mul(0.82), 0.0, 0.88),
    ).add(edgeProfileColor.mul(edgeProfileMask).mul(clamp(this.uniforms.edgeProfileGlow, 0.0, 1.0)).mul(0.26));
    const surfaceContourColor = mix(
      profiledEdgeColor,
      vec3(this.uniforms.surfaceContourR, this.uniforms.surfaceContourG, this.uniforms.surfaceContourB),
      contourMask,
    );
    // #1 Direction-field stripes (Crane 046): evenly-spaced bands aligned to the
    // per-tile orientation field (tileOrient) — the field-aligned line-family
    // idea underneath a de Bruijn pencil, evaluated per pixel so it reads across
    // every family. surface_stripe=0 leaves colour untouched (default).
    const stripeCoord = positionLocal.x.mul(tileOrient.x).add(positionLocal.y.mul(tileOrient.y));
    const stripePhase = stripeCoord.mul(18.0);
    const stripeCell = abs(stripePhase.sub(floor(stripePhase)).sub(0.5));
    const stripeMask = float(1).sub(smoothstep(0.14, 0.2, stripeCell))
      .mul(clamp(this.uniforms.surfaceStripe, 0.0, 1.0))
      .mul(matMix);
    const stripedColor = mix(surfaceContourColor, surfaceContourColor.mul(0.35), stripeMask);
    applyMaterialXStandardSurface(material, {
      baseColor: clamp(stripedColor, 0.0, 1.0),
      opacity: float(1.0),
      roughness: roughnessNode,
      metalness: clamp(metalnessInput, 0.0, 1.0).mul(matMix),
      specular: specularWeight,
      specularColor: mtlxSpecularColor,
      ior: mtlxIor,
      transmission: mtlxTransmission,
      thinFilmWeight,
      thinFilmThickness,
      thinFilmIor: mtlxThinFilmIor,
      anisotropy: vec2(anisotropyStrength, float(0)),
      sheen: this.uniforms.sheen.mul(matMix),
      sheenRoughness: float(0.5),
      coat: clamp(coatWeight, 0.0, 1.0),
      coatRoughness: roughnessNode,
      coatNormal: surfaceNormal,
      normal: surfaceNormal,
      emission: tileEmissive,
    });
    return material;
  }

  createAttractorMaterial(): PointsNodeMaterial {
    const material = new PointsNodeMaterial({
      colorNode: vertexColor(),
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      depthTest: false,
    });
    material.vertexColors = false;
    material.toneMapped = true;
    return material;
  }

  applyPaletteColors(palette: Palette, topologyPaletteColor: Float32Array | null = null): void {
    if (!this.mesh) return;
    const colorAttribute = this.mesh.geometry.getAttribute('color');
    const slotAttribute = this.mesh.geometry.getAttribute('paletteSlot');
    const topologyPaletteAttribute = this.mesh.geometry.getAttribute('topologyPaletteColor');
    const topologyAttribute = this.mesh.geometry.getAttribute('tileTopology');
    const ringAttribute = this.mesh.geometry.getAttribute('tileRing');
    if (!(colorAttribute instanceof BufferAttribute) || !(slotAttribute instanceof BufferAttribute)) return;
    const signature = `${intSetting(this.settings, 'color_count', 1, MAX_COLORS)}:${palette.colors.map(color => color.join(',')).join('|')}`;
    const sameTopologyAttribute = topologyPaletteAttribute instanceof InterleavedBufferAttribute
      && this.topologyPaletteColorAttribute === topologyPaletteAttribute;
    if (this.paletteSignature === signature && this.paletteColorAttribute === colorAttribute && sameTopologyAttribute) return;
    const colorArray = colorAttribute.array;
    const slotArray = slotAttribute.array;
    if (!(colorArray instanceof Float32Array) || !(slotArray instanceof Float32Array)) return;
    const colorCount = intSetting(this.settings, 'color_count', 1, MAX_COLORS);
    for (let i = 0; i < slotArray.length; i += 1) {
      const rgb = oklchToClampedLinearSrgb(paletteColorAt(palette.colors, slotArray[i] ?? 0));
      const p = i * 3;
      colorArray[p] = rgb[0];
      colorArray[p + 1] = rgb[1];
      colorArray[p + 2] = rgb[2];
    }
    colorAttribute.needsUpdate = true;
    if (
      topologyPaletteAttribute instanceof InterleavedBufferAttribute
      && topologyAttribute instanceof InterleavedBufferAttribute
      && ringAttribute instanceof InterleavedBufferAttribute
      && topologyAttribute.itemSize >= 4
      && topologyPaletteAttribute.itemSize >= 3
    ) {
      const topologyPaletteArray = topologyPaletteAttribute.data.array;
      const topologyArray = topologyAttribute.data.array;
      const ringArray = ringAttribute.data.array;
      if (
        topologyPaletteArray instanceof Float32Array
        && topologyArray instanceof Float32Array
        && ringArray instanceof Float32Array
        && topologyPaletteAttribute.count === slotArray.length
        && topologyAttribute.count === slotArray.length
        && ringAttribute.count === slotArray.length
      ) {
        if (topologyPaletteColor && topologyPaletteColor.length === slotArray.length * 3) {
          for (let i = 0; i < slotArray.length; i += 1) {
            const source = i * 3;
            const paletteBase = i * topologyPaletteAttribute.data.stride + topologyPaletteAttribute.offset;
            topologyPaletteArray[paletteBase] = topologyPaletteColor[source] ?? 1;
            topologyPaletteArray[paletteBase + 1] = topologyPaletteColor[source + 1] ?? 1;
            topologyPaletteArray[paletteBase + 2] = topologyPaletteColor[source + 2] ?? 1;
          }
        } else {
          for (let i = 0; i < slotArray.length; i += 1) {
            const topologyBase = i * topologyAttribute.data.stride + topologyAttribute.offset;
            const ringBase = i * ringAttribute.data.stride + ringAttribute.offset;
            const paletteBase = i * topologyPaletteAttribute.data.stride + topologyPaletteAttribute.offset;
            const slot = topologyPaletteSlot(
              slotArray[i] ?? 0,
              colorCount,
              topologyArray[topologyBase] ?? 0,
              topologyArray[topologyBase + 1] ?? 0,
              topologyArray[topologyBase + 2] ?? 0,
              topologyArray[topologyBase + 3] ?? 0,
              ringArray[ringBase] ?? 0,
            );
            const topologyRgb = oklchToClampedLinearSrgb(paletteColorAt(palette.colors, slot));
            topologyPaletteArray[paletteBase] = topologyRgb[0];
            topologyPaletteArray[paletteBase + 1] = topologyRgb[1];
            topologyPaletteArray[paletteBase + 2] = topologyRgb[2];
          }
        }
        topologyPaletteAttribute.data.needsUpdate = true;
        this.topologyPaletteColorAttribute = topologyPaletteAttribute;
      }
    }
    this.paletteSignature = signature;
    this.paletteColorAttribute = colorAttribute;
  }

  setPaletteSlots(paletteSlot: Float32Array, topologyPaletteColor: Float32Array, palette: Palette, options: { render?: boolean } = {}): boolean {
    if (!this.mesh) return false;
    const slotAttribute = this.mesh.geometry.getAttribute('paletteSlot');
    if (!(slotAttribute instanceof BufferAttribute)) return false;
    const slotArray = slotAttribute.array;
    if (!(slotArray instanceof Float32Array) || slotArray.length !== paletteSlot.length) return false;
    slotArray.set(paletteSlot);
    slotAttribute.needsUpdate = true;
    // Slot indices changed even if palette colours did not; force a color-attribute
    // re-bake instead of taking applyPaletteColors' same-palette fast path.
    this.paletteSignature = '';
    this.applyPaletteColors(palette, topologyPaletteColor);
    if (options.render !== false) this.render();
    return true;
  }

  setGeometry(
    geometry: BufferGeometry | null,
    edgeGeometry: BufferGeometry | null = null,
    overlayGeometry: BufferGeometry | null = null,
    options: { frame?: boolean; warmup?: boolean; retirePrevious?: boolean; retirePreviousEdge?: boolean } = {},
  ): void {
    this.assertGeometryFitsDevice(geometry, edgeGeometry);
    if (overlayGeometry) this.assertGeometryFitsDevice(null, overlayGeometry);
    this.uniforms.bakedProjectionMix.value = String(this.settings.projection) === '1' ? 1 : 0;
    this.uniforms.bakedProjScale.value = poincareScaleFromSettings(this.settings);
    const retirePrevious = options.retirePrevious !== false;
    const retirePreviousEdge = options.retirePreviousEdge !== false;
    if (this.mesh) {
      this.group.remove(this.mesh);
      if (retirePrevious) this.retireGeometry(this.mesh.geometry);
      this.mesh = null;
    }
    this.clearEdgeMeshes(retirePreviousEdge);
    this.clearOverlayMeshes(retirePrevious);
    this.paletteColorAttribute = null;
    this.topologyPaletteColorAttribute = null;
    if (geometry) {
      this.mesh = new Mesh(geometry, this.material);
      this.group.add(this.mesh);
    }
    if (edgeGeometry) this.addEdgeGeometry(edgeGeometry);
    if (overlayGeometry) this.addOverlayGeometry(overlayGeometry);
    this.applyRenderConnected();
    if (options.frame !== false) this.frameMesh();
    this.render();
    if (options.warmup !== false) this.requestWarmupFrames(10);
  }

  setAttractorGeometry(geometry: BufferGeometry | null, options: { frame?: boolean; warmup?: boolean; retirePrevious?: boolean } = {}): void {
    if (geometry) this.assertGeometryFitsDevice(geometry, null);
    const retirePrevious = options.retirePrevious !== false;
    if (this.attractorPoints) {
      this.group.remove(this.attractorPoints);
      if (retirePrevious) this.retireGeometry(this.attractorPoints.geometry);
      this.attractorPoints = null;
    }
    if (geometry) {
      this.attractorPoints = new Points(geometry, this.attractorMaterial);
      this.attractorPoints.renderOrder = 1;
      this.group.add(this.attractorPoints);
    }
    this.applyRenderConnected();
    if (options.frame !== false) this.frameMesh();
    this.render();
    if (options.warmup !== false) this.requestWarmupFrames(6);
  }

  setEdgeGeometry(edgeGeometry: BufferGeometry | null, options: { retirePrevious?: boolean } = {}): void {
    const retirePrevious = options.retirePrevious !== false;
    this.clearEdgeMeshes(retirePrevious);
    if (edgeGeometry) this.addEdgeGeometry(edgeGeometry);
    this.applyRenderConnected();
    this.render();
  }

  private clearEdgeMeshes(retirePrevious: boolean): void {
    for (const mesh of this.edgeMeshes) {
      this.group.remove(mesh);
      if (retirePrevious) this.retireGeometry(mesh.geometry);
    }
    this.edgeMeshes = [];
  }

  private clearOverlayMeshes(retirePrevious: boolean): void {
    for (const mesh of this.overlayMeshes) {
      this.group.remove(mesh);
      if (retirePrevious) this.retireGeometry(mesh.geometry);
    }
    this.overlayMeshes = [];
  }

  private addEdgeGeometry(edgeGeometry: BufferGeometry): void {
    const chunks = this.splitBorderGeometryForDevice(edgeGeometry);
    for (const geometry of chunks) {
      this.assertGeometryFitsDevice(null, geometry);
      const mesh = new Mesh(geometry, this.edgeMaterial);
      mesh.renderOrder = 2;
      this.edgeMeshes.push(mesh);
      this.group.add(mesh);
    }
  }

  private addOverlayGeometry(overlayGeometry: BufferGeometry): void {
    const chunks = this.splitBorderGeometryForDevice(overlayGeometry);
    for (const geometry of chunks) {
      this.assertGeometryFitsDevice(null, geometry);
      const mesh = new Mesh(geometry, this.overlayMaterial);
      mesh.renderOrder = 3;
      this.overlayMeshes.push(mesh);
      this.group.add(mesh);
    }
  }

  private splitBorderGeometryForDevice(edgeGeometry: BufferGeometry): BufferGeometry[] {
    const maxBufferSize = this.gpuMaxBufferSize();
    const position = edgeGeometry.getAttribute('position');
    if (!position) return [edgeGeometry];
    const vertexCount = position.count;
    if (vertexCount <= 0) return [edgeGeometry];
    const maxSourceBytes = this.maxGeometryBufferBytes(edgeGeometry);
    if (maxSourceBytes <= maxBufferSize) return [edgeGeometry];
    const bytesPerPackedVertex = BORDER_PACKED_STRIDE * Float32Array.BYTES_PER_ELEMENT;
    const bytesPerPositionVertex = 3 * Float32Array.BYTES_PER_ELEMENT;
    const maxPackedVertices = Math.floor(maxBufferSize * 0.9 / bytesPerPackedVertex);
    const maxPositionVertices = Math.floor(maxBufferSize * 0.9 / bytesPerPositionVertex);
    const chunkVertices = Math.max(3, Math.floor(Math.min(maxPackedVertices, maxPositionVertices) / 3) * 3);
    if (vertexCount <= chunkVertices) return [edgeGeometry];
    const chunks: BufferGeometry[] = [];
    for (let start = 0; start < vertexCount; start += chunkVertices) {
      const count = Math.min(chunkVertices, vertexCount - start);
      const triangleCount = Math.floor(count / 3) * 3;
      if (triangleCount <= 0) continue;
      chunks.push(this.copyBorderGeometryRange(edgeGeometry, start, triangleCount));
    }
    return chunks.length > 0 ? chunks : [edgeGeometry];
  }

  private maxGeometryBufferBytes(geometry: BufferGeometry): number {
    let maxBytes = 0;
    const seen = new Set<object>();
    const index = geometry.index;
    if (index) maxBytes = Math.max(maxBytes, this.attributeBufferBytes(index, seen));
    for (const name of Object.keys(geometry.attributes)) {
      const attribute = geometry.getAttribute(name);
      if (attribute) maxBytes = Math.max(maxBytes, this.attributeBufferBytes(attribute, seen));
    }
    return maxBytes;
  }

  private attributeBufferBytes(attribute: object, seen: Set<object>): number {
    const data = Reflect.get(attribute, 'data');
    const source = data && typeof data === 'object' ? data : attribute;
    if (seen.has(source)) return 0;
    seen.add(source);
    const array = Reflect.get(source, 'array');
    return ArrayBuffer.isView(array) ? array.byteLength : 0;
  }

  private copyBorderGeometryRange(source: BufferGeometry, start: number, count: number): BufferGeometry {
    const position = this.requiredGeometryAttribute(source, 'position');
    const next = new BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const sourceIndex = start + i;
      const p = i * 3;
      positions[p] = position.getX(sourceIndex);
      positions[p + 1] = position.getY(sourceIndex);
      positions[p + 2] = position.getZ(sourceIndex);
    }
    next.setAttribute('position', new BufferAttribute(positions, 3));
    const packed = new Float32Array(count * BORDER_PACKED_STRIDE);
    for (const [name, itemSize, offset] of BORDER_PACKED_ATTRIBUTES) {
      const attribute = this.requiredGeometryAttribute(source, name);
      for (let i = 0; i < count; i++) {
        const sourceIndex = start + i;
        const base = i * BORDER_PACKED_STRIDE + offset;
        packed[base] = attribute.getX(sourceIndex);
        if (itemSize > 1) packed[base + 1] = attribute.getY(sourceIndex);
        if (itemSize > 2) packed[base + 2] = attribute.getZ(sourceIndex);
        if (itemSize > 3) packed[base + 3] = attribute.getW(sourceIndex);
      }
    }
    const data = new InterleavedBuffer(packed, BORDER_PACKED_STRIDE);
    for (const [name, itemSize, offset] of BORDER_PACKED_ATTRIBUTES) {
      next.setAttribute(name, new InterleavedBufferAttribute(data, itemSize, offset));
    }
    next.computeBoundingSphere();
    return next;
  }

  private requiredGeometryAttribute(geometry: BufferGeometry, name: string): BufferAttribute | InterleavedBufferAttribute {
    const attribute = geometry.getAttribute(name);
    if (!attribute) throw new Error(`border geometry is missing '${name}' attribute`);
    return attribute;
  }

  private retireGeometry(geometry: BufferGeometry): void {
    this.retiredGeometries.push({ geometry, frames: 2 });
    this.scheduleRenderFrame();
  }

  private flushRetiredGeometries(force = false): void {
    if (this.retiredGeometries.length === 0) return;
    const keep: { geometry: BufferGeometry; frames: number }[] = [];
    for (const retired of this.retiredGeometries) {
      if (!force && retired.frames > 0) {
        keep.push({ geometry: retired.geometry, frames: retired.frames - 1 });
        continue;
      }
      this.disposeGeometry(retired.geometry);
    }
    this.retiredGeometries = keep;
    if (keep.length > 0) this.scheduleRenderFrame();
  }

  private disposeGeometry(geometry: BufferGeometry): void {
    try {
      geometry.dispose();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (!message.includes("reading 'destroy'")) throw caught;
      // Three r184 WebGPU can attach geometry dispose listeners before every
      // discovered attribute has a created backend buffer during rapid mesh swaps.
      // The renderer owns the backend and will release remaining resources on
      // renderer.dispose(); crashing the app here is worse than retaining this
      // retired CPU geometry until renderer teardown.
    }
  }

  private assertGeometryFitsDevice(fillGeometry: BufferGeometry | null, edgeGeometry: BufferGeometry | null): void {
    const maxBufferSize = this.gpuMaxBufferSize();
    if (fillGeometry) this.assertGeometryBuffersFit('fill', fillGeometry, maxBufferSize);
    if (edgeGeometry) this.assertGeometryBuffersFit('border', edgeGeometry, maxBufferSize);
  }

  private gpuMaxBufferSize(): number {
    const backend: object = this.renderer.backend;
    const device = Reflect.get(backend, 'device');
    if (!device || typeof device !== 'object') return DEFAULT_WEBGPU_MAX_BUFFER_SIZE;
    const limits = Reflect.get(device, 'limits');
    if (!limits || typeof limits !== 'object') return DEFAULT_WEBGPU_MAX_BUFFER_SIZE;
    const maxBufferSize = Reflect.get(limits, 'maxBufferSize');
    return typeof maxBufferSize === 'number' && Number.isFinite(maxBufferSize)
      ? maxBufferSize
      : DEFAULT_WEBGPU_MAX_BUFFER_SIZE;
  }

  private assertGeometryBuffersFit(label: string, geometry: BufferGeometry, maxBufferSize: number): void {
    const seen = new Set<object>();
    const index = geometry.index;
    if (index) this.assertAttributeBufferFits(`${label}.index`, index, maxBufferSize, seen);
    for (const name of Object.keys(geometry.attributes)) {
      const attribute = geometry.getAttribute(name);
      if (attribute) this.assertAttributeBufferFits(`${label}.${name}`, attribute, maxBufferSize, seen);
    }
  }

  private assertAttributeBufferFits(label: string, attribute: object, maxBufferSize: number, seen: Set<object>): void {
    const data = Reflect.get(attribute, 'data');
    const source = data && typeof data === 'object' ? data : attribute;
    if (seen.has(source)) return;
    seen.add(source);
    const array = Reflect.get(source, 'array');
    if (!ArrayBuffer.isView(array)) return;
    const byteLength = array.byteLength;
    if (byteLength <= maxBufferSize) return;
    const mib = byteLength / (1024 * 1024);
    const maxMib = maxBufferSize / (1024 * 1024);
    throw new Error(
      `WebGPU buffer budget exceeded: ${label} needs ${mib.toFixed(1)} MiB, ` +
      `but this device maxBufferSize is ${maxMib.toFixed(1)} MiB. ` +
      'Reduce generation/subdivision or request a higher requiredLimits.maxBufferSize on adapters that expose one.',
    );
  }

  applyRenderConnected(): void {
    if (this.mesh) this.mesh.visible = this.renderConnected;
    if (this.attractorPoints) this.attractorPoints.visible = this.attractorConnected;
    // Tile borders are their own edge mesh; the Border->renderer wire gates only
    // that mesh, not the fill surface.
    for (const mesh of this.edgeMeshes) {
      mesh.visible = this.renderConnected && this.borderConnected;
    }
    for (const mesh of this.overlayMeshes) {
      mesh.visible = this.renderConnected && this.overlayMaterial.opacity > 0;
    }
  }

  private setOverlayMaterial(style: number, amount: number, coverage: number): void {
    const family = intSetting(this.settings, 'family', 0, 19);
    const active = sourceOverlayActiveForStyle(family, style);
    this.overlayMaterial.opacity = active ? Math.max(0, Math.min(0.92, amount * coverage * 0.82)) : 0;
    for (const mesh of this.overlayMeshes) {
      mesh.visible = this.renderConnected && this.overlayMaterial.opacity > 0;
    }
  }

  setRenderInputs(inputs: RenderInputs): void {
    // Palette color is the Surface Material's own color inlet. The newer
    // material-color lane controls whether that color/field lane reaches the
    // Scene Pass or a Field Source; it must not retroactively turn the base
    // material white when an older/partial graph lacks that lane.
    const colorMix = inputs.color ? 1 : 0;
    const materialMix = inputs.material ? 1 : 0;
    const materialReliefMix = inputs.materialRelief ? 1 : 0;
    const projectionMix = inputs.projection ? 1 : 0;
    const displaceMix = inputs.fieldDisplace ? 1 : 0;
    const reliefMix = inputs.fieldRelief && inputs.materialRelief ? 1 : 0;
    const colorFieldMix = inputs.fieldColor && inputs.color && inputs.materialColor ? 1 : 0;
    const undulateMix = inputs.fieldUndulate ? 1 : 0;
    const fieldPhaseMix = inputs.fieldPhase ? 1 : 0;
    const borderMix = inputs.border ? 1 : 0;
    const changed =
      this.renderConnected !== inputs.geometry ||
      this.attractorConnected !== inputs.attractor ||
      this.borderConnected !== inputs.border ||
      this.lightingConnected !== inputs.lighting ||
      this.choreoPhaseConnected !== inputs.choreoPhase ||
      this.uniforms.colorMix.value !== colorMix ||
      this.uniforms.materialMix.value !== materialMix ||
      this.uniforms.materialReliefMix.value !== materialReliefMix ||
      this.uniforms.projectionMix.value !== projectionMix ||
      this.uniforms.displaceMix.value !== displaceMix ||
      this.uniforms.reliefMix.value !== reliefMix ||
      this.uniforms.colorFieldMix.value !== colorFieldMix ||
      this.uniforms.undulateMix.value !== undulateMix ||
      this.uniforms.fieldPhaseMix.value !== fieldPhaseMix ||
      this.uniforms.borderMix.value !== borderMix;
    if (!changed) return;
    this.renderConnected = inputs.geometry;
    this.attractorConnected = inputs.attractor;
    this.borderConnected = inputs.border;
    this.lightingConnected = inputs.lighting;
    this.choreoPhaseConnected = inputs.choreoPhase;
    this.uniforms.colorMix.value = colorMix;
    this.uniforms.materialMix.value = materialMix;
    this.uniforms.materialReliefMix.value = materialReliefMix;
    this.uniforms.projectionMix.value = projectionMix;
    this.uniforms.displaceMix.value = displaceMix;
    this.uniforms.reliefMix.value = reliefMix;
    this.uniforms.colorFieldMix.value = colorFieldMix;
    this.uniforms.undulateMix.value = undulateMix;
    this.uniforms.fieldPhaseMix.value = fieldPhaseMix;
    this.uniforms.borderMix.value = borderMix;
    this.applyRenderConnected();
    this.applyLights();
    this.render();
  }

  // Update the extra field-source wave slots from the graph (one entry per
  // connected non-default field source, up to the slot count). Missing slots
  // reset to zero amplitude so they contribute nothing.
  setFieldSlots(slots: readonly FieldSlot[]): void {
    let changed = false;
    this.uniforms.fieldSlots.forEach((target, index) => {
      const input = slots[index];
      const next = input ?? { freq: 4, speed: 0, phase: 0, phaseConnected: false, relief: 0, undulate: 0, undulateFreq: 2.5, color: 0, pattern: 0 };
      // Integrate this slot's clock progress x speed into a continuous fract
      // phase (same scheme as setFieldPhase) so fractional speeds animate
      // smoothly and only speed 0 freezes the slot.
      const raw = Math.max(0, Math.min(1, Number.isFinite(next.phase) ? next.phase : 0));
      let dp = 0;
      if (this.slotHasPhase[index]) {
        dp = raw - (this.slotPhasePrev[index] ?? 0);
        if (dp < 0) dp += 1; // 1 -> 0 sawtooth wrap
      }
      this.slotHasPhase[index] = true;
      this.slotPhasePrev[index] = raw;
      const speed = Math.max(0, Number.isFinite(next.speed) ? next.speed : 0);
      const phase = ((this.slotPhaseAccum[index] ?? 0) + dp * speed) % 1;
      this.slotPhaseAccum[index] = phase;
      const phaseMix = next.phaseConnected ? 1 : 0;
      if (
        target.freq.value !== next.freq
        || target.phase.value !== phase
        || target.phaseMix.value !== phaseMix
        || target.relief.value !== next.relief || target.undulate.value !== next.undulate
        || target.undulateFreq.value !== next.undulateFreq || target.color.value !== next.color
        || target.pattern.value !== next.pattern
      ) {
        changed = true;
        target.freq.value = next.freq;
        target.phase.value = phase;
        target.phaseMix.value = phaseMix;
        target.relief.value = next.relief;
        target.undulate.value = next.undulate;
        target.undulateFreq.value = next.undulateFreq;
        target.color.value = next.color;
        target.pattern.value = next.pattern;
      }
    });
    if (changed) this.render();
  }

  setFieldPhase(phase: number): void {
    const next = Math.max(0, Math.min(1, Number.isFinite(phase) ? phase : 0));
    // Unwrap the clock's 0..1 sawtooth into per-tick progress and integrate it
    // (x speed) on the CPU. The GPU consumes fract phases directly, so any
    // real-valued speed stays continuous across the clock wrap; the old GPU
    // `speed.round()` band-aid froze every field_speed below 25.
    let dp = 0;
    if (this.clockHasPhase) {
      dp = next - this.clockPhasePrev;
      if (dp < 0) dp += 1; // 1 -> 0 sawtooth wrap
    }
    this.clockHasPhase = true;
    this.clockPhasePrev = next;
    if (dp === 0 && this.uniforms.fieldPhase.value === next) return;
    this.fieldWavePhaseAccum = (this.fieldWavePhaseAccum + dp * this.uniforms.fieldSpeed.value) % 1;
    this.uniforms.fieldPhase.value = next;
    this.uniforms.fieldWavePhase.value = this.fieldWavePhaseAccum;
    this.render();
  }

  // Per-frame choreography phase from the graph: the averaged signal wired
  // into lighting:phase (already waveform-shaped when the source is a clock).
  setChoreoPhase(phase: number): void {
    const next = Math.max(0, Math.min(1, Number.isFinite(phase) ? phase : 0));
    if (this.choreoPhase === next) return;
    this.choreoPhase = next;
    if (!this.choreoPhaseConnected) return;
    this.applyLights();
    this.render();
  }

  setSettings(settings: Settings, palette: Palette): void {
    this.settings = { ...settings };
    this.baseMaterial = materialSettings(settings);
    this.baseDepthScale = intSetting(settings, 'field_displace', 0, 100) / 100;
    this.baseRippleAmp = intSetting(settings, 'field_relief', 0, 100) / 100 * 0.075;
    this.applyPaletteColors(palette);
    this.applyDynamicState();

    const bgOklch: [number, number, number] = intSetting(settings, 'bg_mode', 0, 1) === 1
      ? palette.bg
      : [
        intSetting(settings, 'bg_l', 0, 100) / 100,
        intSetting(settings, 'bg_c', 0, 40) / 100,
        intSetting(settings, 'bg_h', 0, 360),
      ];
    const bg = oklchToClampedLinearSrgb(bgOklch);
    const bgColor = new Color().setRGB(bg[0], bg[1], bg[2], LinearSRGBColorSpace);
    this.renderer.setClearColor(bgColor, 1);
    this.scene.background = bgColor;
    this.postBg = [bg[0], bg[1], bg[2]];
    this.postBgUniform.value.set(bg[0], bg[1], bg[2]);
    this.render();
  }

  setProjectionBoost(x: number, y: number, enabled = true, shouldRender = true): void {
    let bx = enabled ? (Math.max(0, Math.min(100, x)) - 50) / 50 * 0.9 : 0;
    let by = enabled ? (Math.max(0, Math.min(100, y)) - 50) / 50 * 0.9 : 0;
    const magnitude = Math.hypot(bx, by);
    if (magnitude > 0.92) {
      const scale = 0.92 / magnitude;
      bx *= scale;
      by *= scale;
    }
    this.uniforms.boostX.value = bx;
    this.uniforms.boostY.value = by;
    if (shouldRender) this.render();
  }

  effectiveDragBoost(axis: 'x' | 'y', value: number): number {
    if (this.audioEditMode === 'hold') return value;
    const audioDelta = axis === 'x' ? this.audioBoostX : this.audioBoostY;
    return audioDelta === null ? value : clampNumber(value + audioDelta, 0, 100);
  }

  setAudioDrive(
    editState: AudioDriveEditState,
    modulations: AudioModulationValues = {},
    features: AudioFeatures = EMPTY_AUDIO_FEATURES,
  ): void {
    this.audioFeatures = features;
    this.audioEditMode = editState.dragMode;
    const overlay: Partial<Settings> = {};
    let count = 0;
    for (const key of RENDERER_AUDIO_SETTING_KEYS) {
      const range = audioTargetRange(key);
      if (!range) throw new Error(`setAudioDrive: '${String(key)}' has no AUDIO_TARGET_RANGES entry`);
      if (finiteModulation(modulations[key]) === null) continue;
      if (editHoldsParam(editState.dragMode, editState.heldParams, key)) continue;
      const baseline = intSetting(this.settings, key, range[0], range[1]);
      overlay[key] = applyModulationTargetRange(baseline, modulations[key], range[0], range[1]);
      count += 1;
    }
    const next = count > 0 ? overlay : null;
    if (next === null && this.modulationOverlay === null) return;
    this.modulationOverlay = next;
    const boostDelta = (key: keyof Settings): number | null => {
      if (next === null || !(key in next)) return null;
      const range = audioTargetRange(key);
      return range ? modulationTargetDelta(modulations[key], range[0], range[1]) : null;
    };
    this.audioBoostX = boostDelta('hyp_boost_x');
    this.audioBoostY = boostDelta('hyp_boost_y');
    this.applyDynamicState();
    this.render();
  }

  // Every setting-driven value that can change frame-to-frame, written from
  // effectiveSettings() — the ONLY consumer path for these, whether the
  // trigger was a committed setting, a slider preview, or a modulation tick.
  private applyDynamicState(): void {
    const settings = this.effectiveSettings();
    const mat = materialSettings(settings);
    this.uniforms.roughness.value = mat.roughness;
    this.uniforms.roughMod.value = mat.roughMod;
    this.uniforms.metalness.value = Math.min(1, mat.metalness);
    this.uniforms.metalMod.value = mat.metalMod;
    this.uniforms.clearcoat.value = mat.clearcoat;
    this.uniforms.brushedStrength.value = mat.anisotropy;
    this.uniforms.iridescence.value = Math.min(1, mat.iridescence);
    this.uniforms.iridThicknessMin.value = intSetting(settings, 'mat_irid_thick_min', 1, 1200);
    this.uniforms.iridThicknessMax.value = Math.max(
      this.uniforms.iridThicknessMin.value,
      intSetting(settings, 'mat_irid_thick_max', 1, 1200),
    );
    this.uniforms.emissive.value = mat.emissive;
    this.uniforms.sheen.value = mat.sheen;
    this.material.sheenColor.setRGB(
      intSetting(settings, 'mat_sheen_color_r', 0, 255) / 255,
      intSetting(settings, 'mat_sheen_color_g', 0, 255) / 255,
      intSetting(settings, 'mat_sheen_color_b', 0, 255) / 255,
      LinearSRGBColorSpace,
    );
    this.uniforms.reliefScale.value = intSetting(settings, 'mat_relief', 0, 200) / 200;
    this.uniforms.facetCurve.value = intSetting(settings, 'mat_facet_curve', 0, 100) / 100;
    this.uniforms.reliefGuide.value = intSetting(settings, 'mat_relief_guide', 0, 100) / 100;
    this.uniforms.ringRelief.value = intSetting(settings, 'mat_ring_relief', 0, 100) / 100;
    this.uniforms.latticeSpline.value = intSetting(settings, 'mat_lattice_spline', 0, 100) / 100;
    this.uniforms.harnack.value = intSetting(settings, 'mat_harnack', 0, 100) / 100;
    this.uniforms.brightness.value = intSetting(settings, 'brightness', 0, 100) / 100;
    this.uniforms.depthScale.value = Math.min(1.5, intSetting(settings, 'field_displace', 0, 100) / 100);
    this.uniforms.rippleAmp.value = intSetting(settings, 'field_relief', 0, 100) / 100 * 0.075;
    this.uniforms.rippleColorAmp.value = intSetting(settings, 'field_color', 0, 100) / 100 * 0.22;
    this.uniforms.undulateAmp.value = intSetting(settings, 'field_undulate', 0, 100) / 100 * 0.075;
    this.uniforms.rippleFreq.value = intSetting(settings, 'field_freq', 0, 100) / 10;
    this.uniforms.undulateFreq.value = intSetting(settings, 'field_undulate_freq', 0, 100) / 10;
    this.uniforms.fieldSpeed.value = intSetting(settings, 'field_speed', 0, 200) / 50;
    this.uniforms.fieldPattern.value = intSetting(settings, 'field_pattern', 0, 7);
    this.uniforms.ornamentStyle.value = intSetting(settings, 'ornament_style', 0, 4);
    this.uniforms.ornamentAmount.value = intSetting(settings, 'ornament_amount', 0, 100) / 100;
    this.uniforms.ornamentWidth.value = intSetting(settings, 'ornament_width', 0, 100) / 100;
    this.uniforms.ornamentDensity.value = intSetting(settings, 'ornament_density', 0, 100) / 100;
    this.uniforms.ornamentPhase.value = intSetting(settings, 'ornament_phase', 0, 100) / 100;
    this.uniforms.ornamentTwist.value = intSetting(settings, 'ornament_twist', 0, 100) / 100;
    this.uniforms.familyId.value = intSetting(settings, 'family', 0, 19);
    this.uniforms.surfaceContourAmount.value = intSetting(settings, 'surface_contour_amount', 0, 100) / 100;
    this.uniforms.surfaceContourSource.value = intSetting(settings, 'surface_contour_source', 0, 7);
    this.uniforms.surfaceContourSpacing.value = intSetting(settings, 'surface_contour_spacing', 1, 64);
    this.uniforms.surfaceContourWidth.value = intSetting(settings, 'surface_contour_width', 1, 50) / 100;
    this.uniforms.surfaceContourFeature.value = intSetting(settings, 'surface_contour_feature', 0, 100) / 100;
    this.uniforms.surfaceStripe.value = intSetting(settings, 'surface_stripe', 0, 100) / 100;
    this.uniforms.surfaceContourPhase.value = intSetting(settings, 'surface_contour_phase', 0, 100) / 100;
    const contourColor = oklchToClampedLinearSrgb([
      intSetting(settings, 'surface_contour_l', 0, 100) / 100,
      intSetting(settings, 'surface_contour_c', 0, 40) / 100,
      intSetting(settings, 'surface_contour_h', 0, 360),
    ]);
    this.uniforms.surfaceContourR.value = contourColor[0];
    this.uniforms.surfaceContourG.value = contourColor[1];
    this.uniforms.surfaceContourB.value = contourColor[2];
    const markA = oklchToLinearSrgb([
      intSetting(settings, 'source_mark_a_l', 0, 100) / 100,
      intSetting(settings, 'source_mark_a_c', 0, 40) / 100,
      intSetting(settings, 'source_mark_a_h', 0, 360),
    ]);
    const markB = oklchToLinearSrgb([
      intSetting(settings, 'source_mark_b_l', 0, 100) / 100,
      intSetting(settings, 'source_mark_b_c', 0, 40) / 100,
      intSetting(settings, 'source_mark_b_h', 0, 360),
    ]);
    const markC = oklchToLinearSrgb([
      intSetting(settings, 'source_mark_c_l', 0, 100) / 100,
      intSetting(settings, 'source_mark_c_c', 0, 40) / 100,
      intSetting(settings, 'source_mark_c_h', 0, 360),
    ]);
    this.uniforms.overlayColorA.value.setRGB(markA[0], markA[1], markA[2], LinearSRGBColorSpace);
    this.uniforms.overlayColorB.value.setRGB(markB[0], markB[1], markB[2], LinearSRGBColorSpace);
    this.uniforms.overlayColorC.value.setRGB(markC[0], markC[1], markC[2], LinearSRGBColorSpace);
    this.setOverlayMaterial(
      this.uniforms.ornamentStyle.value,
      this.uniforms.ornamentAmount.value,
      this.uniforms.ornamentDensity.value,
    );
    const border = oklchToClampedLinearSrgb([
      intSetting(settings, 'border_l', 0, 100) / 100,
      intSetting(settings, 'border_c', 0, 37) / 100,
      intSetting(settings, 'border_h', 0, 359),
    ]);
    this.edgeMaterial.color.setRGB(border[0], border[1], border[2], LinearSRGBColorSpace);
    this.edgeMaterial.opacity = intSetting(settings, 'border_a', 0, 100) / 100;
    this.uniforms.borderR.value = border[0];
    this.uniforms.borderG.value = border[1];
    this.uniforms.borderB.value = border[2];
    this.uniforms.borderA.value = this.edgeMaterial.opacity;
    const edgeProfile = oklchToClampedLinearSrgb([
      intSetting(settings, 'edge_profile_l', 0, 100) / 100,
      intSetting(settings, 'edge_profile_c', 0, 37) / 100,
      intSetting(settings, 'edge_profile_h', 0, 359),
    ]);
    this.uniforms.edgeProfileWidth.value = intSetting(settings, 'edge_profile_width', 0, 100) / 100;
    this.uniforms.edgeProfileGlow.value = intSetting(settings, 'edge_profile_glow', 0, 100) / 100;
    this.uniforms.edgeProfileR.value = edgeProfile[0];
    this.uniforms.edgeProfileG.value = edgeProfile[1];
    this.uniforms.edgeProfileB.value = edgeProfile[2];
    this.applyLights();
    this.uniforms.projBlend.value = intSetting(settings, 'proj_blend', -100, 100) / 100;
    this.uniforms.poincareScope.value = intSetting(settings, 'poincare_scope', 0, 2);
    this.uniforms.projScale.value = poincareScaleFromSettings(settings);
    this.projectionScale = displayScaleFromSettings(settings);
    this.applyGroupScale();
    if (this.drag?.mode === 'boost') {
      this.setProjectionBoost(
        this.effectiveDragBoost('x', this.dragBoostX),
        this.effectiveDragBoost('y', this.dragBoostY),
        true,
        false,
      );
    } else {
      this.setProjectionBoost(
        intSetting(settings, 'hyp_boost_x', 0, 100),
        intSetting(settings, 'hyp_boost_y', 0, 100),
        String(settings.projection) === '1',
        false,
      );
    }
  }

  setProjectionGesture(config: ProjectionGesture): void {
    this.projectionGesture = config;
  }

  resetClock(): void {
    this.clockPhasePrev = 0;
    this.clockHasPhase = false;
    this.fieldWavePhaseAccum = 0;
    this.choreoPhase = 0;
    this.slotPhasePrev.fill(0);
    this.slotPhaseAccum.fill(0);
    this.slotHasPhase.fill(false);
    this.uniforms.fieldPhase.value = 0;
    this.uniforms.fieldWavePhase.value = 0;
    this.uniforms.fieldSlots.forEach(slot => { slot.phase.value = 0; });
    this.applyLights();
    this.render();
  }

  scheduleRenderFrame(): void {
    if (this.renderFrame || !this.initialized || this.deviceLost) return;
    this.renderFrame = requestAnimationFrame(now => this.flushRenderFrame(now));
  }

  flushRenderFrame(now: number): void {
    this.renderFrame = 0;
    if (!this.initialized || this.deviceLost) return;
    const shouldRender = this.renderRequested;
    this.renderRequested = false;
    void now;
    if (shouldRender) this.renderNow();
    this.flushRetiredGeometries();
  }

  private effectiveSettings(): Settings | Partial<Settings> {
    return this.modulationOverlay ? { ...this.settings, ...this.modulationOverlay } : this.settings;
  }

  applyLights(): void {
    const light = lightSettings(this.effectiveSettings());
    const amount = light.choreoAmount;
    // Choreography is wire-driven: the only animation source is the signal
    // wired into lighting:phase (a clock shaped by its waveform, an audio
    // feature, or any operator blend). There is no source dropdown and no
    // direct audio/pan read here — bypassing the graph is not allowed. With
    // no wire the pose is static (phase 0, neutral pulse).
    const phase = this.choreoPhaseConnected ? this.choreoPhase : 0;
    const pulse = this.choreoPhaseConnected ? 0.5 - 0.5 * Math.cos(phase * Math.PI * 2) : 0;
    const orbit = Math.sin(phase * Math.PI * 2);
    const drift = Math.cos((phase * 0.73 + 0.19) * Math.PI * 2);
    const elevation = clampNumber(light.elevation + amount * drift * 0.24, 0.05, Math.PI * 0.48);
    const angle = light.angle + amount * orbit * 0.72;
    const intensity = light.intensity * (1 + amount * pulse * 0.32);
    const warmth = clampNumber(light.warmth + amount * (pulse - 0.5) * 0.34, 0, 1);
    const ambient = clampNumber(light.ambient + amount * (0.5 - pulse) * 0.14, 0, 1);
    const xy = Math.cos(elevation);
    this.keyLight.position.set(
      Math.cos(angle) * xy,
      Math.sin(angle) * xy,
      Math.sin(elevation) + 0.22,
    );
    const fillAngle = angle + Math.PI + amount * drift * 0.26;
    const fillElevation = Math.max(0.05, elevation * (0.48 + amount * 0.16));
    const fillXy = Math.cos(fillElevation);
    this.fillLight.position.set(
      Math.cos(fillAngle) * fillXy,
      Math.sin(fillAngle) * fillXy,
      Math.sin(fillElevation) + 0.08,
    );
    // Lighting is a side input: when lighting->renderer is cut, all direct and
    // environment lighting from this node goes dark.
    const lit = this.lightingConnected ? 1 : 0;
    this.scene.environmentIntensity = (0.18 + ambient * 0.52) * lit;
    this.keyLight.intensity = intensity * lit;
    this.ambientLight.intensity = ambient * 0.3 * lit;
    this.hemiLight.intensity = ambient * 0.42 * lit;
    this.fillLight.intensity = intensity * (1 - warmth) * (0.22 + amount * 0.08) * lit;
    this.keyLight.color.setRGB(
      0.84 + warmth * 0.16,
      0.9 + warmth * 0.06,
      1.0 - warmth * 0.16,
      LinearSRGBColorSpace,
    );
    this.fillLight.color.setRGB(
      0.72 + warmth * 0.1,
      0.82 + warmth * 0.06,
      1.0 - warmth * 0.1,
      LinearSRGBColorSpace,
    );
  }

  resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    if (width === this.lastResizeWidth && height === this.lastResizeHeight) return;
    this.lastResizeWidth = width;
    this.lastResizeHeight = height;
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    this.camera.left = -aspect;
    this.camera.right = aspect;
    this.camera.top = 1;
    this.camera.bottom = -1;
    this.camera.updateProjectionMatrix();
    this.frameMesh();
    this.notifyViewWindowChange();
    this.render();
  }

  frameMesh(): void {
    const geometry = this.attractorPoints?.geometry ?? this.mesh?.geometry;
    if (!geometry?.boundingSphere) return;
    const radius = geometry.boundingSphere.radius || 1;
    const scale = 0.92 / radius;
    this.baseScale = scale;
    this.applyGroupScale();
  }

  hasInteractiveGeometry(): boolean {
    return Boolean(this.attractorPoints?.geometry ?? this.mesh?.geometry);
  }

  applyGroupScale(): void {
    this.group.scale.setScalar(this.baseScale * this.viewZoom * this.projectionScale);
    this.applyGroupPan();
  }

  applyGroupPan(): void {
    const scale = Math.max(1e-6, this.baseScale * this.viewZoom * this.projectionScale);
    this.group.position.x = -this.viewPanX * scale;
    this.group.position.y = -this.viewPanY * scale;
  }

  currentTilingWindow(): TilingWindow {
    const sourceScale = Math.max(1e-6, this.baseScale * this.viewZoom * this.projectionScale);
    const halfWidth = Math.max(Math.abs(this.camera.left), Math.abs(this.camera.right)) / sourceScale * WINDOW_OVERSCAN;
    const halfHeight = Math.max(Math.abs(this.camera.top), Math.abs(this.camera.bottom)) / sourceScale * WINDOW_OVERSCAN;
    return {
      centerX: this.viewPanX,
      centerY: this.viewPanY,
      halfWidth,
      halfHeight,
    };
  }

  notifyViewWindowChange(): void {
    this.onViewWindowChange?.();
  }

  zoomWheel(event: WheelEvent): void {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0012);
    this.setViewZoom(this.viewZoom * factor);
  }

  setViewZoom(value: number): void {
    this.viewZoom = Math.max(0.25, Math.min(5, value));
    this.applyGroupScale();
    this.notifyViewWindowChange();
    this.render();
  }

  setViewGestureMode(value: ViewGestureMode): void {
    this.viewGestureMode = value;
    this.renderer.domElement.style.cursor = value === 'pan' ? 'move' : 'grab';
  }

  resetView(): void {
    this.viewZoom = 1;
    this.viewPanX = 0;
    this.viewPanY = 0;
    this.group.rotation.set(0, 0, 0);
    this.applyGroupScale();
    this.applyLights();
    this.notifyViewWindowChange();
    this.render();
  }

  startDrag(event: PointerEvent): void {
    if (!this.hasInteractiveGeometry()) return;
    const isBoost = event.button === 2 && String(this.projectionGesture?.settings?.projection) === '1';
    const isZoom = event.button === 1;
    const isPan = event.shiftKey || this.viewGestureMode === 'pan';
    const settings = this.projectionGesture?.settings;
    event.preventDefault();
    this.drag = {
      pointerId: event.pointerId,
      mode: isBoost ? 'boost' : isZoom ? 'zoom' : isPan ? 'pan' : 'rotate',
      x: event.clientX,
      y: event.clientY,
      rx: this.group.rotation.x,
      ry: this.group.rotation.y,
      zoom: this.viewZoom,
      panX: this.viewPanX,
      panY: this.viewPanY,
      bx: Number(settings?.hyp_boost_x ?? 50),
      by: Number(settings?.hyp_boost_y ?? 50),
    };
    this.dragBoostX = this.drag.bx;
    this.dragBoostY = this.drag.by;
    this.renderer.domElement.setPointerCapture(event.pointerId);
  }

  dragPointer(event: PointerEvent): void {
    if (!this.drag || this.drag.pointerId !== event.pointerId || !this.hasInteractiveGeometry()) return;
    const dx = (event.clientX - this.drag.x) / Math.max(1, this.container.clientWidth);
    const dy = (event.clientY - this.drag.y) / Math.max(1, this.container.clientHeight);
    if (this.drag.mode === 'boost') {
      const bx = Math.max(0, Math.min(100, this.drag.bx + dx * 100));
      // Screen Y is top-down but the camera/world Y is up, so a raw +dy makes
      // the boost drag feel inverted on Y only (X is naturally aligned). Negate
      // dy here so dragging down moves the projection down, matching X.
      const by = Math.max(0, Math.min(100, this.drag.by - dy * 100));
      this.dragBoostX = bx;
      this.dragBoostY = by;
      this.setProjectionBoost(this.effectiveDragBoost('x', bx), this.effectiveDragBoost('y', by), true);
      this.projectionGesture?.onBoostPreview?.(bx, by);
      return;
    }
    if (this.drag.mode === 'zoom') {
      this.setViewZoom(this.drag.zoom * Math.exp(-dy * 2.6));
      return;
    }
    if (this.drag.mode === 'pan') {
      const scale = Math.max(1e-6, this.baseScale * this.viewZoom * this.projectionScale);
      const worldDx = dx * (this.camera.right - this.camera.left);
      const worldDy = -dy * (this.camera.top - this.camera.bottom);
      this.viewPanX = this.drag.panX - worldDx / scale;
      this.viewPanY = this.drag.panY - worldDy / scale;
      this.applyGroupPan();
      this.applyLights();
      this.notifyViewWindowChange();
      this.render();
      return;
    }
    this.pointer(this.drag.rx + dy * 1.2, this.drag.ry + dx * 1.2);
  }

  endDrag(event: PointerEvent): void {
    if (this.drag?.pointerId === event.pointerId) {
      if (this.drag.mode === 'boost') {
        const dx = (event.clientX - this.drag.x) / Math.max(1, this.container.clientWidth);
        const dy = (event.clientY - this.drag.y) / Math.max(1, this.container.clientHeight);
        const bx = Math.max(0, Math.min(100, this.drag.bx + dx * 100));
        // Screen Y is top-down but the camera/world Y is up, so a raw +dy makes
        // the boost drag feel inverted on Y only (X is naturally aligned). Negate
        // dy here so dragging down moves the projection down, matching X.
        const by = Math.max(0, Math.min(100, this.drag.by - dy * 100));
        this.dragBoostX = bx;
        this.dragBoostY = by;
        this.projectionGesture?.onBoostCommit?.(bx, by);
      }
      this.drag = null;
    }
  }

  pointer(rotationX: number, rotationY: number): void {
    if (!this.group) return;
    this.group.rotation.x = rotationX;
    this.group.rotation.y = rotationY;
    this.render();
  }

  renderNow(): void {
    if (!this.initialized || this.deviceLost) return;
    if (this.postPipeline) {
      this.postPipeline.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  render(): void {
    if (!this.initialized || this.deviceLost) return;
    this.renderRequested = true;
    this.scheduleRenderFrame();
  }

  flushPendingRender(): void {
    if (!this.initialized || this.deviceLost || !this.renderRequested) return;
    if (this.renderFrame) {
      cancelAnimationFrame(this.renderFrame);
      this.renderFrame = 0;
    }
    this.renderRequested = false;
    this.renderNow();
    this.flushRetiredGeometries();
  }

  async captureDataUrl(width: number, height: number, type = 'image/png'): Promise<string> {
    const target = new RenderTarget(width, height, {
      depthBuffer: true,
      format: RGBAFormat,
      samples: 0,
      stencilBuffer: false,
      type: UnsignedByteType,
    });
    const previousTarget = this.renderer.getOutputRenderTarget();
    this.renderer.setOutputRenderTarget(target);
    try {
      if (!this.initialized || this.deviceLost) throw new Error('thumbnail capture renderer is not available');
      if (this.renderFrame) {
        cancelAnimationFrame(this.renderFrame);
        this.renderFrame = 0;
      }
      this.renderRequested = false;
      this.renderNow();
      this.flushRetiredGeometries();
      const pixels = await this.renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
      if (!(pixels instanceof Uint8Array)) {
        throw new Error('thumbnail capture expected RGBA8 readback');
      }
      const rowBytes = width * 4;
      const sourceStride = Math.ceil(rowBytes / 256) * 256;
      const required = (height - 1) * sourceStride + rowBytes;
      if (pixels.length < required) {
        throw new Error(`thumbnail capture readback too short: ${pixels.length} < ${required}`);
      }
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) {
        const sourceOffset = y * sourceStride;
        rgba.set(pixels.subarray(sourceOffset, sourceOffset + rowBytes), y * rowBytes);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('2D canvas is required for thumbnail encoding');
      context.putImageData(new ImageData(rgba, width, height), 0, 0);
      return canvas.toDataURL(type);
    } finally {
      this.renderer.setOutputRenderTarget(previousTarget);
      target.dispose();
    }
  }

  requestWarmupFrames(frames: number): void {
    this.warmupFramesRemaining = Math.max(this.warmupFramesRemaining, frames);
    if (this.warmupFrame) return;
    const tick = () => {
      this.warmupFrame = 0;
      if (!this.initialized || this.warmupFramesRemaining <= 0) return;
      this.warmupFramesRemaining -= 1;
      this.render();
      if (this.warmupFramesRemaining > 0) {
        this.warmupFrame = requestAnimationFrame(tick);
      }
    };
    this.warmupFrame = requestAnimationFrame(tick);
  }

  dispose(): void {
    if (this.renderFrame) cancelAnimationFrame(this.renderFrame);
    if (this.warmupFrame) cancelAnimationFrame(this.warmupFrame);
    this.resizeObserver.disconnect();
    this.flushRetiredGeometries(true);
    this.postPipeline?.dispose();
    if (this.postOutputNode) {
      // Empty keep-set: free every RT-owning node in the output tree, including any
      // stateful feedback (TrailsNode) — disposed generically like bloom/anamorphic.
      this.disposePostTree(this.postOutputNode, new Set<object>());
    }
    this.scenePassNode?.dispose();
    if (this.mesh) this.disposeGeometry(this.mesh.geometry);
    for (const mesh of this.edgeMeshes) {
      this.disposeGeometry(mesh.geometry);
    }
    for (const mesh of this.overlayMeshes) {
      this.disposeGeometry(mesh.geometry);
    }
    if (this.attractorPoints) this.disposeGeometry(this.attractorPoints.geometry);
    this.attractorMaterial.dispose();
    this.renderer.domElement.remove();
    this.renderer.dispose();
  }
}
