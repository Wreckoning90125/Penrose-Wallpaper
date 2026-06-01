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
  Mesh,
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  NoToneMapping,
  OrthographicCamera,
  RGBAFormat,
  RenderPipeline,
  SRGBColorSpace,
  Scene,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import type Node from 'three/src/nodes/core/Node.js';
import type UniformNode from 'three/src/nodes/core/UniformNode.js';
import {
  attribute,
  clamp,
  cross,
  dFdx,
  dFdy,
  float,
  frontFacing,
  max,
  mix,
  normalize,
  pass,
  positionLocal,
  sin,
  tanh,
  transformNormalToView,
  uniform,
  vertexColor,
  vec2,
  vec3,
} from 'three/tsl';
import type { FieldSlot, PostChainNode, PostChainSpec, RenderInputs } from '../types';
import { fxBuilder, afterImageDamp, type FxUniforms, type FxContext } from './postFxRegistry';
import { fxDescriptor, fxStructuralSignature } from './postFxCatalog';
import { intSetting, lightSettings, materialSettings, type MaterialSettings, type Settings } from '../settings/androidSettings';
import { oklchToLinearSrgb } from '../color/palette';
import type { Palette } from '../color/palette';
import type { AudioDriveEditState, AudioModulationValues, ProjectionGesture } from '../types';
import { clampNumber } from '../util/clamp';

type RendererUniforms = ReturnType<typeof createRendererUniforms>;
type DragMode = 'boost' | 'zoom' | 'rotate';
type DragState = {
  pointerId: number;
  mode: DragMode;
  x: number;
  y: number;
  rx: number;
  ry: number;
  zoom: number;
  bx: number;
  by: number;
};
function clampLinearColor(value: number): number {
  return Math.max(0, Math.min(1, value));
}


// Extra field-source wave slots (beyond the default source on slot 0). Each
// carries an independent spatial frequency + temporal speed and its own
// relief/undulate/colour wave amplitude; the graph fills them from connected
// field-source nodes. Default zero amplitude -> no contribution.
function createFieldSlots() {
  return Array.from({ length: 3 }, () => ({
    freq: uniform(4),
    speed: uniform(0),
    phase: uniform(0),
    phaseMix: uniform(0),
    relief: uniform(0),
    undulate: uniform(0),
    undulateFreq: uniform(2.5),
    color: uniform(0),
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
    anisotropy: uniform(0.28),
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
    projBlend: uniform(0),
    projScale: uniform(1.525),
    shadeFloor: uniform(0.04),
    sheen: uniform(0.12),
    brightness: uniform(1),
    rippleAmp: uniform(0),
    rippleColorAmp: uniform(0),
    undulateAmp: uniform(0),
    rippleFreq: uniform(4),
    undulateFreq: uniform(2.5),
    fieldSpeed: uniform(0.8),
    fieldPhase: uniform(0),
    depthScale: uniform(0.42),
    reliefScale: uniform(0.55),
    edgeDepthBias: uniform(0.0015),
    boostX: uniform(0),
    boostY: uniform(0),
  };
}

function displayScaleFromSettings(settings: Settings | Partial<Settings>): number {
  if (String(settings.projection) === '1') return 1;
  const value = intSetting(settings, 'hyp_scale', 0, 100);
  return 0.35 + value / 100 * 1.95;
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
  uniforms: RendererUniforms;
  material: MeshPhysicalNodeMaterial;
  edgeMaterial: MeshBasicNodeMaterial;
  mesh: Mesh<BufferGeometry, MeshPhysicalNodeMaterial> | null;
  edgeMesh: Mesh<BufferGeometry, MeshBasicNodeMaterial> | null;
  renderConnected: boolean;
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
  audioDriveActive: boolean;
  audioProjectionActive: boolean;
  audioEditMode: AudioDriveEditState['dragMode'];
  dragBoostX: number;
  dragBoostY: number;
  viewZoom: number;
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

  constructor(container: HTMLElement) {
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = AgXToneMapping;
    this.renderer.toneMappingExposure = 1.08;
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

    this.uniforms = createRendererUniforms();

    this.material = this.createMaterial();
    this.edgeMaterial = new MeshBasicNodeMaterial({
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: DoubleSide,
    });
    this.edgeMaterial.positionNode = this.boostedEdgePositionNode();
    this.mesh = null;
    this.edgeMesh = null;
    this.renderConnected = true;
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
    this.audioDriveActive = false;
    this.audioProjectionActive = false;
    this.audioEditMode = 'ride';
    this.dragBoostX = 50;
    this.dragBoostY = 50;
    this.viewZoom = 1;
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
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.renderer.domElement.addEventListener('contextmenu', event => event.preventDefault());
    this.renderer.domElement.addEventListener('pointerdown', event => this.startDrag(event));
    this.renderer.domElement.addEventListener('pointermove', event => this.dragPointer(event));
    this.renderer.domElement.addEventListener('pointerup', event => this.endDrag(event));
    this.renderer.domElement.addEventListener('pointercancel', event => this.endDrag(event));
    this.renderer.domElement.addEventListener('wheel', event => this.zoomWheel(event), { passive: false });
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
      .map(node => `${node.id}:${node.kind}:${node.bypass ? 1 : 0}:${this.postNodeIsNoop(node) ? 1 : 0}:${fxStructuralSignature(node.kind, node.params, node.selects)}`)
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
      // The override on bloom/anamorphic/afterImage frees their materials + caches
      // too; RTTNode has no override, but its render target is already freed above.
      if (ownsRenderTarget) node.dispose();
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
    // The output color transform (AgX tone map + sRGB) is owned by the toneMap
    // node, not the pipeline: it applies only when a live toneMap node is in the
    // chain. Cut/bypass/skip it and the frame reaches the screen untransformed
    // (linear, washed-out) — the node is downstream of its inlets, like every FX.
    let hasToneMap = false;
    for (const node of this.postChainSpec) {
      if (node.bypass) continue;
      if (this.postNodeIsNoop(node)) continue;
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
        if (target.value !== next) {
          target.value = next;
          changed = true;
        }
      }
    }
    return changed;
  }

  boostCoordinateNodes(x: Node<'float'>, y: Node<'float'>) {
    // Continuous Euclid <-> Poincaré disk projection in the vertex shader
    // (matches CPU projectHyp: z = normalize(x,y) * tanh(r * scale * 0.5)).
    // projBlend 0 = Euclidean (px=x, py=y -> byte-identical default), 1 = full
    // disk; modulates live with no geometry rebuild. Adds no vertex attribute.
    const r = x.mul(x).add(y.mul(y)).sqrt();
    const safeR = max(r, float(1e-6));
    const d = tanh(r.mul(this.uniforms.projScale).mul(0.5));
    const px = mix(x, x.div(safeR).mul(d), this.uniforms.projBlend);
    const py = mix(y, y.div(safeR).mul(d), this.uniforms.projBlend);
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

  // A unit sine wave parameterized by spatial frequency plus an optional clock
  // phase. The Clock node emits normalized 0..1 phase. Field speed is interpreted
  // as an integer number of cycles per clock loop; arbitrary fractional
  // multipliers make phase wrap discontinuous.
  rippleWaveNode(
    x: Node<'float'>,
    y: Node<'float'>,
    freq: Node<'float'>,
    speed: Node<'float'>,
    phaseValue: Node<'float'>,
    phaseMix: Node<'float'>,
  ): Node<'float'> {
    const phase = x.mul(freq)
      .add(y.mul(freq.mul(0.73)))
      .add(phaseValue.mul(float(Math.PI * 2)).mul(speed.round()).mul(phaseMix));
    return sin(phase);
  }

  surfaceDepthNode(
    boostedX: Node<'float'>,
    boostedY: Node<'float'>,
    tileRing: Node<'float'>,
    tileOrient: Node<'vec2'>,
    tileCenter: Node<'vec2'>,
  ): Node<'float'> {
    const boostedCenter = this.boostCoordinateNodes(tileCenter.x, tileCenter.y);
    const localX = boostedX.sub(boostedCenter.x);
    const localY = boostedY.sub(boostedCenter.y);
    const directionalDepth = localX.mul(tileOrient.x).add(localY.mul(tileOrient.y))
      .mul(this.uniforms.depthScale)
      .mul(0.12);
    const contourDepth = tileRing.sub(0.5).mul(this.uniforms.depthScale).mul(0.012);
    return directionalDepth.add(contourDepth);
  }

  // The surface z-displacement. The scalar material relief
  // (positionLocal.z * reliefScale) is a routed Surface Material lane: material
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
    tileRing: Node<'float'>,
    tileOrient: Node<'vec2'>,
    tileCenter: Node<'vec2'>,
  ): Node<'float'> {
    const reliefZ = positionLocal.z
      .mul(this.uniforms.reliefScale)
      .mul(this.uniforms.materialMix)
      .mul(this.uniforms.materialReliefMix);
    const displaceField = this.surfaceDepthNode(boostedX, boostedY, tileRing, tileOrient, tileCenter);
    const wave = this.rippleWaveNode(boostedX, boostedY, this.uniforms.rippleFreq, this.uniforms.fieldSpeed, this.uniforms.fieldPhase, this.uniforms.fieldPhaseMix);
    const reliefField = reliefZ.mul(wave).mul(this.uniforms.rippleAmp);
    // Undulate is the whole-sheet wave: a 1-D plane wave displacing z (up), so the
    // flat atlas bends like paper. No relief term — any real relief just rides the
    // bent sheet (z heights add). Its frequency is its own driven control; shading
    // stays smooth at ANY frequency because the normal is analytic (surfaceNormalNode),
    // not the polygon face. Frequency sets the bend scale; it does NOT cause faceting.
    const undulateWave = this.rippleWaveNode(boostedX, boostedY, this.uniforms.undulateFreq, this.uniforms.fieldSpeed, this.uniforms.fieldPhase, this.uniforms.fieldPhaseMix);
    const undulateField = undulateWave.mul(this.uniforms.undulateAmp);
    let z = reliefZ
      .add(displaceField.mul(this.uniforms.displaceMix))
      .add(reliefField.mul(this.uniforms.reliefMix))
      .add(undulateField.mul(this.uniforms.undulateMix));
    // Extra independent field sources: each adds its own wave's relief + undulate.
    for (const slot of this.uniforms.fieldSlots) {
      const slotWave = this.rippleWaveNode(boostedX, boostedY, slot.freq, slot.speed, slot.phase, slot.phaseMix);
      const slotUndulate = this.rippleWaveNode(boostedX, boostedY, slot.undulateFreq, slot.speed, slot.phase, slot.phaseMix);
      z = z.add(reliefZ.mul(slotWave).mul(slot.relief)).add(slotUndulate.mul(slot.undulate));
    }
    return z;
  }

  // The analytic surface normal from the displacement gradient (finite-differenced
  // surfaceZNode), transformed to view space. Shading smoothness is a property of
  // the NORMAL, not the geometry: with `normalFlat` (the polygon face normal) any
  // displacement on low-poly tiles facets, regardless of wave frequency — which is
  // the real reason a displaced surface "looked like relief". Deriving the normal
  // from the displacement instead decouples shading from polygon density: a flat,
  // low-poly sheet shades as a smooth undulation at any frequency/tessellation, no
  // subdivision. (See docs/render/displacement-normals.md for the war story.)
  surfaceNormalNode(
    boostedX: Node<'float'>,
    boostedY: Node<'float'>,
    tileRing: Node<'float'>,
    tileOrient: Node<'vec2'>,
    tileCenter: Node<'vec2'>,
  ): Node<'vec3'> {
    const eps = float(0.005);
    const z0 = this.surfaceZNode(boostedX, boostedY, tileRing, tileOrient, tileCenter);
    const zx = this.surfaceZNode(boostedX.add(eps), boostedY, tileRing, tileOrient, tileCenter);
    const zy = this.surfaceZNode(boostedX, boostedY.add(eps), tileRing, tileOrient, tileCenter);
    // Procedural gradient (undulate/displace/relief-wave): analytic, so the moving
    // fields stay smooth at ANY tessellation — this is the part 0523f57 fixed and we
    // must NOT regress.
    const gx = z0.sub(zx).div(eps);
    const gy = z0.sub(zy).div(eps);
    // Baked per-tile relief (positionLocal.z * reliefScale) is a per-vertex constant,
    // so it cancels in the finite difference above and shades flat — the fill-subdiv
    // regression. Add it back as a geometric FACE normal of the baked tent: this is
    // what responds to fill subdivision (more facets -> the face normal varies more
    // finely across the tent), giving back the "proper" relief shading. The xy/z
    // ratio is invariant to the cross product's winding sign, so DoubleSide is fine.
    // (Local/object space; exact in Euclidean, an approximation under Poincaré boost.)
    const bakedPos = vec3(
      positionLocal.x,
      positionLocal.y,
      positionLocal.z
        .mul(this.uniforms.reliefScale)
        .mul(this.uniforms.materialMix)
        .mul(this.uniforms.materialReliefMix),
    );
    const nBaked = normalize(cross(dFdx(bakedPos), dFdy(bakedPos)));
    // Very high relief can make the baked face nearly vertical in screen
    // derivatives. Dividing by a near-zero z normal produces extreme/invalid
    // slopes, which shows up as black physical-material faces. Keep the same
    // relief geometry but bound the shading normal's slope extraction.
    const bakedZ = max(nBaked.z, float(0.08));
    const bgx = clamp(nBaked.x.div(bakedZ), float(-4), float(4));
    const bgy = clamp(nBaked.y.div(bakedZ), float(-4), float(4));
    const localNormal = normalize(vec3(gx.add(bgx), gy.add(bgy), float(1)));
    // DoubleSide two-sided normal. The geometry now has consistent CCW winding (see
    // emitTriangle flip), so frontFacing reliably tells front from back: the front
    // keeps the normal, the back flips it to face the viewer (so the back is lit,
    // not black). Winding-based, so it's stable under tilt — unlike a view-direction
    // (N·V) flip, which graze-flickers on the undulated surface.
    const nView = transformNormalToView(localNormal);
    return frontFacing.select(nView, nView.negate());
  }

  // The boosted (projected) surface coordinates plus the per-tile attributes the
  // surface z / normal nodes need. Shared by the position and normal builders.
  private boostedSurfaceInputs() {
    const tileRing = attribute<'float'>('tileRing', 'float');
    const tileOrient = attribute<'vec2'>('tileOrient', 'vec2');
    const tileCenter = attribute<'vec2'>('tileCenter', 'vec2');
    const boosted = this.boostCoordinateNodes(positionLocal.x, positionLocal.y);
    return { boosted, tileRing, tileOrient, tileCenter };
  }

  boostedPositionNode() {
    const { boosted, tileRing, tileOrient, tileCenter } = this.boostedSurfaceInputs();
    return vec3(boosted.x, boosted.y, this.surfaceZNode(boosted.x, boosted.y, tileRing, tileOrient, tileCenter));
  }

  surfaceNormalForMaterial(): Node<'vec3'> {
    const { boosted, tileRing, tileOrient, tileCenter } = this.boostedSurfaceInputs();
    return this.surfaceNormalNode(boosted.x, boosted.y, tileRing, tileOrient, tileCenter);
  }

  boostedEdgePositionNode() {
    const { boosted, tileRing, tileOrient, tileCenter } = this.boostedSurfaceInputs();
    return vec3(
      boosted.x,
      boosted.y,
      this.surfaceZNode(boosted.x, boosted.y, tileRing, tileOrient, tileCenter).add(this.uniforms.edgeDepthBias),
    );
  }

  createMaterial(): MeshPhysicalNodeMaterial {
    const tileType = attribute<'float'>('tileType', 'float');
    const tileRing = attribute<'float'>('tileRing', 'float');
    const tileOrient = attribute<'vec2'>('tileOrient', 'vec2');
    let rippleColor = this.rippleWaveNode(positionLocal.x, positionLocal.y, this.uniforms.rippleFreq, this.uniforms.fieldSpeed, this.uniforms.fieldPhase, this.uniforms.fieldPhaseMix).mul(this.uniforms.rippleColorAmp).mul(this.uniforms.colorFieldMix);
    for (const slot of this.uniforms.fieldSlots) {
      rippleColor = rippleColor.add(this.rippleWaveNode(positionLocal.x, positionLocal.y, slot.freq, slot.speed, slot.phase, slot.phaseMix).mul(slot.color));
    }
    const material = new MeshPhysicalNodeMaterial({
      side: DoubleSide,
    });
    material.vertexColors = true;
    // colorMix is the palette->material:color inlet: 1 = palette color, 0 = flat
    // white. Cutting that wire drops the color (flat tiles) instead of hiding
    // the mesh — the material is downstream of its color inlet.
    // brightness lives on the material node; gate it by matMix so a disconnected
    // material has zero effect (matMix 0 -> neutral 1.0). The colour ripple field
    // is gated separately by colorFieldMix.
    const materialColor = mix(vec3(1.0, 1.0, 1.0), vertexColor(), this.uniforms.colorMix);
    material.colorNode = clamp(
      mix(vec3(1.0, 1.0, 1.0), materialColor, this.uniforms.materialMix)
        .mul(mix(float(1.0), this.uniforms.brightness, this.uniforms.materialMix).add(rippleColor)),
      0.0,
      1.0,
    );
    material.positionNode = this.boostedPositionNode();
    const surfaceNormal = this.surfaceNormalForMaterial();
    material.normalNode = surfaceNormal;
    // materialMix is the material->renderer:surface inlet: 1 = tuned material,
    // 0 = neutral matte (rough 0.5, no metal/clearcoat/aniso/irid/sheen). Cutting
    // that wire renders a plain surface instead of hiding the mesh — the material
    // is downstream of its surface inlet. Default 1 leaves the look untouched.
    const matMix = this.uniforms.materialMix;
    material.roughnessNode = clamp(
      mix(float(0.5), this.uniforms.roughness.add(tileRing.mul(this.uniforms.roughMod)), matMix),
      0.035,
      1.0,
    );
    material.metalnessNode = clamp(this.uniforms.metalness.add(tileType.mul(this.uniforms.metalMod)), 0.0, 1.0).mul(matMix);
    material.clearcoatNode = this.uniforms.clearcoat.mul(matMix);
    material.clearcoatRoughnessNode = clamp(this.uniforms.roughness.mul(0.28), 0.018, 0.32);
    material.clearcoatNormalNode = surfaceNormal;
    material.anisotropyNode = vec2(tileOrient.x, tileOrient.y).mul(this.uniforms.anisotropy).mul(matMix);
    material.iridescenceNode = clamp(this.uniforms.iridescence.mul(float(0.7).add(tileRing.mul(0.3))), 0.0, 1.0).mul(matMix);
    material.iridescenceThicknessNode = clamp(
      this.uniforms.iridThicknessMin.add(this.uniforms.iridThicknessMax.sub(this.uniforms.iridThicknessMin).mul(tileRing)),
      1.0,
      1200.0,
    );
    material.sheenNode = this.uniforms.sheen.mul(matMix);
    material.sheenRoughnessNode = float(0.44);
    material.emissiveNode = vertexColor().mul(
      this.uniforms.emissive.add(this.uniforms.shadeFloor).add(max(rippleColor, 0.0).mul(0.35)),
    );
    return material;
  }

  applyPaletteColors(palette: Palette): void {
    if (!this.mesh) return;
    const colorAttribute = this.mesh.geometry.getAttribute('color');
    const slotAttribute = this.mesh.geometry.getAttribute('paletteSlot');
    if (!(colorAttribute instanceof BufferAttribute) || !(slotAttribute instanceof BufferAttribute)) return;
    const signature = palette.colors.map(color => color.join(',')).join('|');
    if (this.paletteSignature === signature && this.paletteColorAttribute === colorAttribute) return;
    const colorArray = colorAttribute.array;
    const slotArray = slotAttribute.array;
    if (!(colorArray instanceof Float32Array) || !(slotArray instanceof Float32Array)) return;
    const rgbBySlot = palette.colors.map(color => {
      const rgb = oklchToLinearSrgb(color);
      return [clampLinearColor(rgb[0]), clampLinearColor(rgb[1]), clampLinearColor(rgb[2])] as const;
    });
    const fallback = rgbBySlot[0] ?? ([1, 1, 1] as const);
    for (let i = 0; i < slotArray.length; i += 1) {
      const slot = Math.max(0, Math.min(palette.colors.length - 1, Math.round(slotArray[i] ?? 0)));
      const rgb = rgbBySlot[slot] ?? fallback;
      const p = i * 3;
      colorArray[p] = rgb[0];
      colorArray[p + 1] = rgb[1];
      colorArray[p + 2] = rgb[2];
    }
    colorAttribute.needsUpdate = true;
    this.paletteSignature = signature;
    this.paletteColorAttribute = colorAttribute;
  }

  setGeometry(geometry: BufferGeometry, edgeGeometry: BufferGeometry | null = null, options: { frame?: boolean; warmup?: boolean } = {}): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    if (this.edgeMesh) {
      this.group.remove(this.edgeMesh);
      this.edgeMesh.geometry.dispose();
      this.edgeMesh = null;
    }
    this.mesh = new Mesh(geometry, this.material);
    this.paletteColorAttribute = null;
    this.group.add(this.mesh);
    if (edgeGeometry) {
      this.edgeMesh = new Mesh(edgeGeometry, this.edgeMaterial);
      this.edgeMesh.renderOrder = 2;
      this.group.add(this.edgeMesh);
    }
    this.applyRenderConnected();
    if (options.frame !== false) this.frameMesh();
    this.render();
    if (options.warmup !== false) this.requestWarmupFrames(10);
  }

  setEdgeGeometry(edgeGeometry: BufferGeometry | null): void {
    if (this.edgeMesh) {
      this.group.remove(this.edgeMesh);
      this.edgeMesh.geometry.dispose();
      this.edgeMesh = null;
    }
    if (edgeGeometry) {
      this.edgeMesh = new Mesh(edgeGeometry, this.edgeMaterial);
      this.edgeMesh.renderOrder = 2;
      this.group.add(this.edgeMesh);
    }
    this.applyRenderConnected();
    this.render();
  }

  applyRenderConnected(): void {
    if (this.mesh) this.mesh.visible = this.renderConnected;
    // The edge mesh (tile borders) is gated by BOTH the geometry chain and the
    // Border node's own wire: cut the Border->renderer wire and the borders stop.
    if (this.edgeMesh) this.edgeMesh.visible = this.renderConnected && this.borderConnected;
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
    const changed =
      this.renderConnected !== inputs.geometry ||
      this.borderConnected !== inputs.border ||
      this.lightingConnected !== inputs.lighting ||
      this.uniforms.colorMix.value !== colorMix ||
      this.uniforms.materialMix.value !== materialMix ||
      this.uniforms.materialReliefMix.value !== materialReliefMix ||
      this.uniforms.projectionMix.value !== projectionMix ||
      this.uniforms.displaceMix.value !== displaceMix ||
      this.uniforms.reliefMix.value !== reliefMix ||
      this.uniforms.colorFieldMix.value !== colorFieldMix ||
      this.uniforms.undulateMix.value !== undulateMix ||
      this.uniforms.fieldPhaseMix.value !== fieldPhaseMix;
    if (!changed) return;
    this.renderConnected = inputs.geometry;
    this.borderConnected = inputs.border;
    this.lightingConnected = inputs.lighting;
    this.uniforms.colorMix.value = colorMix;
    this.uniforms.materialMix.value = materialMix;
    this.uniforms.materialReliefMix.value = materialReliefMix;
    this.uniforms.projectionMix.value = projectionMix;
    this.uniforms.displaceMix.value = displaceMix;
    this.uniforms.reliefMix.value = reliefMix;
    this.uniforms.colorFieldMix.value = colorFieldMix;
    this.uniforms.undulateMix.value = undulateMix;
    this.uniforms.fieldPhaseMix.value = fieldPhaseMix;
    this.applyRenderConnected();
    this.applyLights(this.settings);
    this.render();
  }

  // Update the extra field-source wave slots from the graph (one entry per
  // connected non-default field source, up to the slot count). Missing slots
  // reset to zero amplitude so they contribute nothing.
  setFieldSlots(slots: readonly FieldSlot[]): void {
    let changed = false;
    this.uniforms.fieldSlots.forEach((target, index) => {
      const input = slots[index];
      const next = input ?? { freq: 4, speed: 0, phase: 0, phaseConnected: false, relief: 0, undulate: 0, undulateFreq: 2.5, color: 0 };
      const phase = Math.max(0, Math.min(1, next.phase));
      const phaseMix = next.phaseConnected ? 1 : 0;
      if (
        target.freq.value !== next.freq || target.speed.value !== next.speed
        || target.phase.value !== phase
        || target.phaseMix.value !== phaseMix
        || target.relief.value !== next.relief || target.undulate.value !== next.undulate
        || target.undulateFreq.value !== next.undulateFreq || target.color.value !== next.color
      ) {
        changed = true;
        target.freq.value = next.freq;
        target.speed.value = next.speed;
        target.phase.value = phase;
        target.phaseMix.value = phaseMix;
        target.relief.value = next.relief;
        target.undulate.value = next.undulate;
        target.undulateFreq.value = next.undulateFreq;
        target.color.value = next.color;
      }
    });
    if (changed) this.render();
  }

  setFieldPhase(phase: number): void {
    const next = Math.max(0, Math.min(1, Number.isFinite(phase) ? phase : 0));
    if (this.uniforms.fieldPhase.value === next) return;
    this.uniforms.fieldPhase.value = next;
    this.render();
  }

  setSettings(settings: Settings, palette: Palette): void {
    this.settings = { ...settings };
    const mat = materialSettings(settings);
    this.baseMaterial = mat;
    this.uniforms.roughness.value = mat.roughness;
    this.uniforms.roughMod.value = mat.roughMod;
    this.uniforms.metalness.value = mat.metalness;
    this.uniforms.metalMod.value = mat.metalMod;
    this.uniforms.clearcoat.value = mat.clearcoat;
    this.uniforms.anisotropy.value = mat.anisotropy;
    this.uniforms.iridescence.value = mat.iridescence;
    this.uniforms.iridThicknessMin.value = intSetting(settings, 'mat_irid_thick_min', 1, 1200);
    this.uniforms.iridThicknessMax.value = Math.max(
      this.uniforms.iridThicknessMin.value,
      intSetting(settings, 'mat_irid_thick_max', 1, 1200),
    );
    this.uniforms.emissive.value = mat.emissive;
    this.uniforms.shadeFloor.value = 0.036 + Math.min(0.028, mat.sheen * 0.018 + mat.clearcoat * 0.012);
    this.uniforms.sheen.value = mat.sheen;
    this.uniforms.reliefScale.value = intSetting(settings, 'mat_relief', 0, 200) / 200;
    this.uniforms.brightness.value = intSetting(settings, 'brightness', 0, 200) / 100;
    // The field-source emits three independently-driven fields: displacement (a
    // per-tile bulge), relief (the wave modulating baked relief) and colour. Each
    // is its own driver; zero on all three leaves the surface flat (modulo relief).
    this.baseDepthScale = intSetting(settings, 'field_displace', 0, 100) / 100;
    this.uniforms.depthScale.value = this.baseDepthScale;
    this.baseRippleAmp = intSetting(settings, 'field_relief', 0, 100) / 100 * 0.075;
    this.uniforms.rippleAmp.value = this.baseRippleAmp;
    this.uniforms.rippleColorAmp.value = intSetting(settings, 'field_color', 0, 100) / 100 * 0.22;
    this.uniforms.undulateAmp.value = intSetting(settings, 'field_undulate', 0, 100) / 100 * 0.075;
    this.uniforms.rippleFreq.value = intSetting(settings, 'field_freq', 0, 100) / 10;
    this.uniforms.undulateFreq.value = intSetting(settings, 'field_undulate_freq', 0, 100) / 10;
    this.uniforms.fieldSpeed.value = intSetting(settings, 'field_speed', 0, 200) / 50;
    this.scene.environmentIntensity = 0.8 + mat.clearcoat * 0.9 + mat.metalness * 0.5;
    const border = oklchToLinearSrgb([
      intSetting(settings, 'border_l', 0, 100) / 100,
      intSetting(settings, 'border_c', 0, 37) / 100,
      intSetting(settings, 'border_h', 0, 359),
    ]);
    this.edgeMaterial.color.setRGB(border[0], border[1], border[2]);
    this.edgeMaterial.opacity = intSetting(settings, 'border_a', 0, 100) / 100;
    this.applyPaletteColors(palette);
    this.applyLights(settings);
    this.uniforms.projBlend.value = intSetting(settings, 'proj_blend', 0, 100) / 100;
    this.uniforms.projScale.value = 0.05 + intSetting(settings, 'hyp_scale', 0, 100) / 100 * 2.95;
    this.projectionScale = displayScaleFromSettings(settings);
    this.applyGroupScale();
    this.setProjectionBoost(
      Number(settings.hyp_boost_x ?? 50),
      Number(settings.hyp_boost_y ?? 50),
      String(settings.projection) === '1',
      false,
    );

    const bg = oklchToLinearSrgb(palette.bg);
    this.renderer.setClearColor(new Color(bg[0], bg[1], bg[2]), 1);
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
  ): void {
    const hasLiveModulation = Object.entries(modulations).some(([key, value]) => (
      typeof value === 'number'
      && Number.isFinite(value)
      && !(editState.dragMode === 'hold' && editState.heldParams[key] === true)
    ));
    if (!hasLiveModulation && !this.audioDriveActive) {
      this.audioEditMode = editState.dragMode;
      return;
    }
    const hadProjectionModulation = this.audioProjectionActive;
    this.audioDriveActive = hasLiveModulation;
    this.audioEditMode = editState.dragMode;
    const held = (key: string) => editState.dragMode === 'hold' && editState.heldParams[key] === true;
    const hasModulation = (key: string): boolean => {
      const value = modulations[key];
      return typeof value === 'number' && Number.isFinite(value) && !held(key);
    };
    const modulatedValue = (key: keyof Settings, min: number, max: number): number => {
      const baseline = intSetting(this.settings, key, min, max);
      const value = modulations[key];
      return typeof value === 'number' && Number.isFinite(value) && !held(key)
        ? clampNumber(baseline + value * (max - min), min, max)
        : baseline;
    };
    const modulatedDelta = (key: keyof Settings, min: number, max: number): number | null => {
      const value = modulations[key];
      return typeof value === 'number' && Number.isFinite(value) && !held(key)
        ? value * (max - min)
        : null;
    };
    const audioSettings: Partial<Settings> = {
      ...this.settings,
      brightness: modulatedValue('brightness', 40, 180),
      field_displace: modulatedValue('field_displace', 0, 100),
      hyp_boost_x: modulatedValue('hyp_boost_x', 0, 100),
      hyp_boost_y: modulatedValue('hyp_boost_y', 0, 100),
      hyp_scale: modulatedValue('hyp_scale', 0, 100),
      proj_blend: modulatedValue('proj_blend', 0, 100),
      light_ambient: modulatedValue('light_ambient', 0, 100),
      light_angle: modulatedValue('light_angle', 0, 360),
      light_elevation: modulatedValue('light_elevation', 0, 90),
      light_intensity: modulatedValue('light_intensity', 0, 200),
      light_warmth: modulatedValue('light_warmth', 0, 100),
      mat_anisotropy: modulatedValue('mat_anisotropy', 0, 100),
      mat_clearcoat: modulatedValue('mat_clearcoat', 0, 100),
      mat_emissive: modulatedValue('mat_emissive', 0, 200),
      mat_iridescence: modulatedValue('mat_iridescence', 0, 100),
      mat_metal_mod: modulatedValue('mat_metal_mod', 0, 100),
      mat_metalness: modulatedValue('mat_metalness', 0, 100),
      mat_relief: modulatedValue('mat_relief', 0, 200),
      mat_rough_mod: modulatedValue('mat_rough_mod', 0, 100),
      mat_roughness: modulatedValue('mat_roughness', 0, 100),
      mat_sheen: modulatedValue('mat_sheen', 0, 200),
      field_relief: modulatedValue('field_relief', 0, 100),
      field_color: modulatedValue('field_color', 0, 100),
      field_speed: modulatedValue('field_speed', 0, 200),
    };
    const mat = materialSettings(audioSettings);
    this.uniforms.roughness.value = mat.roughness;
    this.uniforms.roughMod.value = mat.roughMod;
    this.uniforms.metalMod.value = mat.metalMod;
    this.uniforms.clearcoat.value = mat.clearcoat;
    this.uniforms.anisotropy.value = mat.anisotropy;
    this.uniforms.sheen.value = mat.sheen;
    this.uniforms.reliefScale.value = modulatedValue('mat_relief', 0, 200) / 200;
    this.uniforms.brightness.value = modulatedValue('brightness', 40, 180) / 100;
    this.uniforms.emissive.value = Math.min(2, mat.emissive);
    this.uniforms.iridescence.value = Math.min(1, mat.iridescence);
    this.uniforms.metalness.value = Math.min(1, mat.metalness);
    this.uniforms.rippleAmp.value = modulatedValue('field_relief', 0, 100) / 100 * 0.075;
    this.uniforms.rippleColorAmp.value = modulatedValue('field_color', 0, 100) / 100 * 0.22;
    this.uniforms.undulateAmp.value = modulatedValue('field_undulate', 0, 100) / 100 * 0.075;
    this.uniforms.rippleFreq.value = modulatedValue('field_freq', 0, 100) / 10;
    this.uniforms.undulateFreq.value = modulatedValue('field_undulate_freq', 0, 100) / 10;
    this.uniforms.fieldSpeed.value = modulatedValue('field_speed', 0, 200) / 50;
    const depthScale = modulatedValue('field_displace', 0, 100) / 100;
    this.uniforms.depthScale.value = Math.min(1.5, depthScale);
    // Border colour/opacity are runtime (edgeMaterial), so audio can drive them.
    if (hasModulation('border_l') || hasModulation('border_c') || hasModulation('border_h')) {
      const borderRgb = oklchToLinearSrgb([
        modulatedValue('border_l', 0, 100) / 100,
        modulatedValue('border_c', 0, 37) / 100,
        modulatedValue('border_h', 0, 359),
      ]);
      this.edgeMaterial.color.setRGB(borderRgb[0], borderRgb[1], borderRgb[2]);
    }
    if (hasModulation('border_a')) {
      this.edgeMaterial.opacity = modulatedValue('border_a', 0, 100) / 100;
    }
    if (
      hasModulation('light_ambient')
      || hasModulation('light_angle')
      || hasModulation('light_elevation')
      || hasModulation('light_intensity')
      || hasModulation('light_warmth')
    ) {
      this.applyLights(audioSettings);
    }
    const hasProjectionModulation = hasModulation('hyp_scale')
      || hasModulation('proj_blend')
      || hasModulation('hyp_boost_x')
      || hasModulation('hyp_boost_y');
    this.audioProjectionActive = hasProjectionModulation;
    this.audioBoostX = hasModulation('hyp_boost_x') ? modulatedDelta('hyp_boost_x', 0, 100) : null;
    this.audioBoostY = hasModulation('hyp_boost_y') ? modulatedDelta('hyp_boost_y', 0, 100) : null;
    if (hasProjectionModulation || hadProjectionModulation) {
      this.projectionScale = displayScaleFromSettings(audioSettings);
      this.uniforms.projBlend.value = intSetting(audioSettings, 'proj_blend', 0, 100) / 100;
      this.uniforms.projScale.value = 0.05 + intSetting(audioSettings, 'hyp_scale', 0, 100) / 100 * 2.95;
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
          modulatedValue('hyp_boost_x', 0, 100),
          modulatedValue('hyp_boost_y', 0, 100),
          String(audioSettings.projection) === '1',
          false,
        );
      }
    }
    this.render();
  }

  setProjectionGesture(config: ProjectionGesture): void {
    this.projectionGesture = config;
  }

  resetClock(): void {
    this.setFieldPhase(0);
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
  }

  applyLights(settings: Settings | Partial<Settings>): void {
    const light = lightSettings(settings);
    const xy = Math.cos(light.elevation);
    this.keyLight.position.set(
      Math.cos(light.angle) * xy,
      Math.sin(light.angle) * xy,
      Math.sin(light.elevation) + 0.22,
    );
    // Lighting is a side input: when lighting→renderer is cut the lights go
    // dark and the surface is left to the environment map alone. Cut the wire,
    // the lighting stops — the graph is downstream of nothing here, this is.
    const lit = this.lightingConnected ? 1 : 0;
    this.keyLight.intensity = (1.25 + light.intensity * 2.25) * lit;
    this.ambientLight.intensity = (0.08 + light.ambient * 0.75) * lit;
    this.hemiLight.intensity = (0.24 + light.ambient * 0.7) * lit;
    this.fillLight.intensity = (0.18 + (1 - light.warmth) * 0.7) * lit;
    this.keyLight.color.setRGB(
      0.86 + light.warmth * 0.28,
      0.9 + light.warmth * 0.1,
      1.06 - light.warmth * 0.28,
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
    this.render();
  }

  frameMesh(): void {
    if (!this.mesh?.geometry.boundingSphere) return;
    const radius = this.mesh.geometry.boundingSphere.radius || 1;
    const scale = 0.92 / radius;
    this.baseScale = scale;
    this.applyGroupScale();
  }

  applyGroupScale(): void {
    this.group.scale.setScalar(this.baseScale * this.viewZoom * this.projectionScale);
  }

  zoomWheel(event: WheelEvent): void {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0012);
    this.setViewZoom(this.viewZoom * factor);
  }

  setViewZoom(value: number): void {
    this.viewZoom = Math.max(0.25, Math.min(5, value));
    this.applyGroupScale();
    this.render();
  }

  resetView(): void {
    this.viewZoom = 1;
    this.group.rotation.set(0, 0, 0);
    this.applyGroupScale();
    this.render();
  }

  startDrag(event: PointerEvent): void {
    if (!this.mesh) return;
    const isBoost = event.button === 2 && String(this.projectionGesture?.settings?.projection) === '1';
    const isZoom = event.button === 1;
    const settings = this.projectionGesture?.settings;
    event.preventDefault();
    this.drag = {
      pointerId: event.pointerId,
      mode: isBoost ? 'boost' : isZoom ? 'zoom' : 'rotate',
      x: event.clientX,
      y: event.clientY,
      rx: this.group.rotation.x,
      ry: this.group.rotation.y,
      zoom: this.viewZoom,
      bx: Number(settings?.hyp_boost_x ?? 50),
      by: Number(settings?.hyp_boost_y ?? 50),
    };
    this.dragBoostX = this.drag.bx;
    this.dragBoostY = this.drag.by;
    this.renderer.domElement.setPointerCapture(event.pointerId);
  }

  dragPointer(event: PointerEvent): void {
    if (!this.drag || this.drag.pointerId !== event.pointerId || !this.mesh) return;
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
    this.mesh?.geometry.dispose();
    this.edgeMesh?.geometry.dispose();
    this.postPipeline?.dispose();
    if (this.postOutputNode) {
      // Empty keep-set: free every RT-owning node in the output tree, including any
      // stateful feedback (TrailsNode) — disposed generically like bloom/anamorphic.
      this.disposePostTree(this.postOutputNode, new Set<object>());
    }
    this.scenePassNode?.dispose();
    this.renderer.domElement.remove();
    this.renderer.dispose();
  }
}
