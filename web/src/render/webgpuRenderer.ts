import {
  AgXToneMapping,
  AmbientLight,
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
  OrthographicCamera,
  RGBAFormat,
  SRGBColorSpace,
  Scene,
  WebGPURenderer,
} from 'three/webgpu';
import {
  abs,
  attribute,
  clamp,
  float,
  positionLocal,
  sin,
  uniform,
  vertexColor,
  vec3,
} from 'three/tsl';
import { intSetting, lightSettings, materialSettings, type MaterialSettings, type Settings } from '../settings/androidSettings';
import { oklchToLinearSrgb } from '../color/palette';
import type { Palette } from '../color/palette';
import type { AudioFeatures, Gains, ProjectionGesture } from '../types';

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

function createRendererUniforms() {
  return {
    roughness: uniform(0.38),
    roughMod: uniform(0.2),
    metalness: uniform(0.35),
    metalMod: uniform(0.2),
    clearcoat: uniform(0.62),
    anisotropy: uniform(0.28),
    iridescence: uniform(0.44),
    emissive: uniform(0),
    sheen: uniform(0.12),
    brightness: uniform(1),
    rippleAmp: uniform(0),
    rippleFreq: uniform(4),
    time: uniform(0),
  };
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
  uniforms: RendererUniforms;
  material: MeshPhysicalNodeMaterial;
  edgeMaterial: MeshBasicNodeMaterial;
  mesh: Mesh<BufferGeometry, MeshPhysicalNodeMaterial> | null;
  edgeMesh: Mesh<BufferGeometry, MeshBasicNodeMaterial> | null;
  baseMaterial: MaterialSettings;
  baseRippleAmp: number;
  baseScale: number;
  viewZoom: number;
  initialized: boolean;
  clockEnabled: boolean;
  clockRate: number;
  clockTime: number;
  clockFrame: number;
  clockLast: number;
  drag: DragState | null;
  projectionGesture: ProjectionGesture | null;
  resizeObserver: ResizeObserver;

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

    this.uniforms = createRendererUniforms();

    this.material = this.createMaterial();
    this.edgeMaterial = new MeshBasicNodeMaterial({
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    this.edgeMaterial.positionNode = this.ripplePositionNode();
    this.mesh = null;
    this.edgeMesh = null;
    this.baseMaterial = materialSettings({});
    this.baseRippleAmp = 0;
    this.baseScale = 1;
    this.viewZoom = 1;
    this.initialized = false;
    this.clockEnabled = false;
    this.clockRate = 1;
    this.clockTime = 0;
    this.clockFrame = 0;
    this.clockLast = 0;
    this.drag = null;
    this.projectionGesture = null;
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
    this.scene.environment = this.createEnvironmentTexture();
    this.resize();
    this.render();
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

  ripplePositionNode() {
    const ripplePhase = positionLocal.x.mul(this.uniforms.rippleFreq)
      .add(positionLocal.y.mul(this.uniforms.rippleFreq.mul(0.73)))
      .add(this.uniforms.time);
    const ripple = sin(ripplePhase).mul(this.uniforms.rippleAmp);
    return positionLocal.add(vec3(0, 0, ripple));
  }

  createMaterial(): MeshPhysicalNodeMaterial {
    const tileType = attribute<'float'>('tileType', 'float');
    const tileRing = attribute<'float'>('tileRing', 'float');
    const tileOrient = attribute<'vec2'>('tileOrient', 'vec2');
    const material = new MeshPhysicalNodeMaterial({
      side: DoubleSide,
    });
    material.vertexColors = true;
    material.colorNode = clamp(vertexColor().mul(this.uniforms.brightness), 0.0, 1.0);
    material.positionNode = this.ripplePositionNode();
    material.roughnessNode = clamp(this.uniforms.roughness.add(tileRing.mul(this.uniforms.roughMod)), 0.035, 1.0);
    material.metalnessNode = clamp(this.uniforms.metalness.add(tileType.mul(this.uniforms.metalMod)), 0.0, 1.0);
    material.clearcoatNode = this.uniforms.clearcoat;
    material.clearcoatRoughnessNode = clamp(this.uniforms.roughness.mul(0.28), 0.018, 0.32);
    material.anisotropyNode = clamp(abs(tileOrient.x).mul(this.uniforms.anisotropy), 0.0, 1.0);
    material.iridescenceNode = clamp(this.uniforms.iridescence.mul(float(0.7).add(tileRing.mul(0.3))), 0.0, 1.0);
    material.sheenNode = this.uniforms.sheen;
    material.sheenRoughnessNode = float(0.44);
    material.emissiveNode = vertexColor().mul(this.uniforms.emissive);
    return material;
  }

  setGeometry(geometry: BufferGeometry, edgeGeometry: BufferGeometry | null = null): void {
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
    this.group.add(this.mesh);
    if (edgeGeometry) {
      this.edgeMesh = new Mesh(edgeGeometry, this.edgeMaterial);
      this.edgeMesh.renderOrder = 2;
      this.group.add(this.edgeMesh);
    }
    this.frameMesh();
    this.render();
  }

  setSettings(settings: Settings, palette: Palette): void {
    const mat = materialSettings(settings);
    this.baseMaterial = mat;
    this.uniforms.roughness.value = mat.roughness;
    this.uniforms.roughMod.value = mat.roughMod;
    this.uniforms.metalness.value = mat.metalness;
    this.uniforms.metalMod.value = mat.metalMod;
    this.uniforms.clearcoat.value = mat.clearcoat;
    this.uniforms.anisotropy.value = mat.anisotropy;
    this.uniforms.iridescence.value = mat.iridescence;
    this.uniforms.emissive.value = mat.emissive;
    this.uniforms.sheen.value = mat.sheen;
    this.uniforms.brightness.value = intSetting(settings, 'brightness', 0, 200) / 100;
    this.baseRippleAmp = intSetting(settings, 'ripple_amount', 0, 100) / 100
      * intSetting(settings, 'depth_amount', 0, 100) / 100
      * 0.075;
    this.uniforms.rippleAmp.value = this.baseRippleAmp;
    this.uniforms.rippleFreq.value = 2 + intSetting(settings, 'ripple_kind', 0, 3) * 2.25;
    this.material.roughness = mat.roughness;
    this.material.metalness = mat.metalness;
    this.material.clearcoat = mat.clearcoat;
    this.material.iridescence = mat.iridescence;
    this.material.envMapIntensity = 0.8 + mat.clearcoat * 0.9 + mat.metalness * 0.5;
    this.material.clearcoatRoughness = Math.max(0.03, mat.roughness * 0.35);
    this.material.sheen = mat.sheen;
    this.material.needsUpdate = true;
    const border = oklchToLinearSrgb([
      intSetting(settings, 'border_l', 0, 100) / 100,
      intSetting(settings, 'border_c', 0, 37) / 100,
      intSetting(settings, 'border_h', 0, 359),
    ]);
    this.edgeMaterial.color.setRGB(border[0], border[1], border[2]);
    this.edgeMaterial.opacity = intSetting(settings, 'border_a', 0, 100) / 100;
    this.edgeMaterial.needsUpdate = true;
    this.applyLights(settings);

    const bg = oklchToLinearSrgb(palette.bg);
    this.renderer.setClearColor(new Color(bg[0], bg[1], bg[2]), 1);
    this.setClockFromSettings(settings);
    this.render();
  }

  setAudioDrive(features: AudioFeatures, gains: Gains): void {
    const mat = this.baseMaterial;
    this.uniforms.emissive.value = Math.min(2, mat.emissive + features.bass * gains.emissive);
    this.uniforms.iridescence.value = Math.min(1, mat.iridescence + features.treble * gains.film);
    this.uniforms.metalness.value = Math.min(1, mat.metalness + features.mid * gains.metal * 0.35);
    this.uniforms.rippleAmp.value = this.baseRippleAmp * (1 + features.level * Math.max(0, gains.relief));
    if (this.mesh) {
      const z = 1 + features.level * gains.relief * 0.08;
      this.mesh.scale.z = z;
      if (this.edgeMesh) this.edgeMesh.scale.z = z;
    }
    this.render();
  }

  setProjectionGesture(config: ProjectionGesture): void {
    this.projectionGesture = config;
  }

  setClockFromSettings(settings: Settings): void {
    this.clockEnabled = String(settings.clock_enabled ?? '1') !== '0';
    this.clockRate = Math.max(0, intSetting(settings, 'clock_rate', 0, 240) / 100)
      * Math.max(0.1, intSetting(settings, 'ripple_speed', 0, 200) / 50);
    if (this.clockEnabled) {
      this.startClock();
    } else {
      this.stopClock();
    }
  }

  resetClock(): void {
    this.clockTime = 0;
    this.uniforms.time.value = 0;
    this.render();
  }

  startClock(): void {
    if (this.clockFrame || !this.initialized) return;
    this.clockLast = performance.now();
    const tick = (now: number) => {
      this.clockFrame = 0;
      if (!this.clockEnabled) return;
      const delta = Math.min(0.05, Math.max(0, (now - this.clockLast) / 1000));
      this.clockLast = now;
      this.clockTime += delta * this.clockRate;
      this.uniforms.time.value = this.clockTime;
      this.render();
      this.clockFrame = requestAnimationFrame(tick);
    };
    this.clockFrame = requestAnimationFrame(tick);
  }

  stopClock(): void {
    if (!this.clockFrame) return;
    cancelAnimationFrame(this.clockFrame);
    this.clockFrame = 0;
  }

  applyLights(settings: Settings): void {
    const light = lightSettings(settings);
    const xy = Math.cos(light.elevation);
    this.keyLight.position.set(
      Math.cos(light.angle) * xy,
      Math.sin(light.angle) * xy,
      Math.sin(light.elevation) + 0.22,
    );
    this.keyLight.intensity = 1.25 + light.intensity * 2.25;
    this.ambientLight.intensity = 0.08 + light.ambient * 0.75;
    this.hemiLight.intensity = 0.24 + light.ambient * 0.7;
    this.fillLight.intensity = 0.18 + (1 - light.warmth) * 0.7;
    this.keyLight.color.setRGB(
      0.86 + light.warmth * 0.28,
      0.9 + light.warmth * 0.1,
      1.06 - light.warmth * 0.28,
    );
  }

  resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
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
    this.group.scale.setScalar(this.baseScale * this.viewZoom);
  }

  zoomWheel(event: WheelEvent): void {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0012);
    this.setViewZoom(this.viewZoom * factor);
  }

  setViewZoom(value: number): void {
    this.viewZoom = Math.max(0.25, Math.min(5, value));
    this.group.scale.setScalar(this.baseScale * this.viewZoom);
    this.render();
  }

  resetView(): void {
    this.viewZoom = 1;
    this.group.rotation.set(0, 0, 0);
    this.group.scale.setScalar(this.baseScale);
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
    this.renderer.domElement.setPointerCapture(event.pointerId);
  }

  dragPointer(event: PointerEvent): void {
    if (!this.drag || this.drag.pointerId !== event.pointerId || !this.mesh) return;
    const dx = (event.clientX - this.drag.x) / Math.max(1, this.container.clientWidth);
    const dy = (event.clientY - this.drag.y) / Math.max(1, this.container.clientHeight);
    if (this.drag.mode === 'boost') {
      const bx = Math.max(0, Math.min(100, this.drag.bx + dx * 100));
      const by = Math.max(0, Math.min(100, this.drag.by + dy * 100));
      this.projectionGesture?.onBoost?.(bx, by);
      return;
    }
    if (this.drag.mode === 'zoom') {
      this.setViewZoom(this.drag.zoom * Math.exp(-dy * 2.6));
      return;
    }
    this.pointer(this.drag.rx + dy * 1.2, this.drag.ry - dx * 1.2);
  }

  endDrag(event: PointerEvent): void {
    if (this.drag?.pointerId === event.pointerId) {
      this.drag = null;
    }
  }

  pointer(rotationX: number, rotationY: number): void {
    if (!this.group) return;
    this.group.rotation.x = rotationX;
    this.group.rotation.y = rotationY;
    this.render();
  }

  render(): void {
    if (!this.initialized) return;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.stopClock();
    this.resizeObserver.disconnect();
    this.mesh?.geometry.dispose();
    this.edgeMesh?.geometry.dispose();
    this.renderer.domElement.remove();
    this.renderer.dispose();
  }
}
