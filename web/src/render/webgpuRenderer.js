import * as THREE from 'three/webgpu';
import {
  abs,
  attribute,
  clamp,
  float,
  uniform,
  vertexColor,
} from 'three/tsl';
import { lightSettings, materialSettings } from '../settings/androidSettings.js';
import { oklchToLinearSrgb } from '../color/palette.js';

export class WallpaperRenderer {
  constructor(container) {
    if (!navigator.gpu) {
      throw new Error('WebGPU is required for this renderer');
    }

    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -5, 5);
    this.camera.position.set(0, 0, 2.8);
    this.scene.add(this.camera);
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    this.keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    this.fillLight = new THREE.DirectionalLight(0xb8d6ff, 0.55);
    this.keyLight.position.set(0.45, 0.7, 1.15);
    this.fillLight.position.set(-0.65, -0.35, 0.75);
    this.scene.add(this.ambientLight, this.keyLight, this.fillLight);

    this.renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    container.appendChild(this.renderer.domElement);

    this.uniforms = {
      roughness: uniform(0.38),
      roughMod: uniform(0.2),
      metalness: uniform(0.35),
      metalMod: uniform(0.2),
      clearcoat: uniform(0.62),
      anisotropy: uniform(0.28),
      iridescence: uniform(0.44),
      emissive: uniform(0),
      sheen: uniform(0.12),
    };

    this.material = this.createMaterial();
    this.mesh = null;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    window.addEventListener('pointermove', event => this.pointer(event), { passive: true });
  }

  async init() {
    await this.renderer.init();
    this.resize();
    this.render();
  }

  createMaterial() {
    const tileType = attribute('tileType', 'float');
    const tileRing = attribute('tileRing', 'float');
    const tileOrient = attribute('tileOrient', 'vec2');
    const material = new THREE.MeshPhysicalNodeMaterial({
      side: THREE.DoubleSide,
    });
    material.colorNode = vertexColor();
    material.roughnessNode = clamp(this.uniforms.roughness.add(tileRing.mul(this.uniforms.roughMod)), 0.035, 1.0);
    material.metalnessNode = clamp(this.uniforms.metalness.add(tileType.mul(this.uniforms.metalMod)), 0.0, 1.0);
    material.clearcoatNode = this.uniforms.clearcoat;
    material.anisotropyNode = clamp(abs(tileOrient.x).mul(this.uniforms.anisotropy), 0.0, 1.0);
    material.iridescenceNode = clamp(this.uniforms.iridescence.mul(float(0.7).add(tileRing.mul(0.3))), 0.0, 1.0);
    material.sheenNode = this.uniforms.sheen;
    material.emissiveNode = vertexColor().mul(this.uniforms.emissive);
    return material;
  }

  setGeometry(geometry) {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.scene.add(this.mesh);
    this.frameMesh();
    this.render();
  }

  setSettings(settings, palette) {
    const mat = materialSettings(settings);
    this.uniforms.roughness.value = mat.roughness;
    this.uniforms.roughMod.value = mat.roughMod;
    this.uniforms.metalness.value = mat.metalness;
    this.uniforms.metalMod.value = mat.metalMod;
    this.uniforms.clearcoat.value = mat.clearcoat;
    this.uniforms.anisotropy.value = mat.anisotropy;
    this.uniforms.iridescence.value = mat.iridescence;
    this.uniforms.emissive.value = mat.emissive;
    this.uniforms.sheen.value = mat.sheen;
    this.applyLights(settings);

    const bg = oklchToLinearSrgb(palette.bg);
    this.renderer.setClearColor(new THREE.Color(bg[0], bg[1], bg[2]), 1);
    this.render();
  }

  applyLights(settings) {
    const light = lightSettings(settings);
    const xy = Math.cos(light.elevation);
    this.keyLight.position.set(
      Math.cos(light.angle) * xy,
      Math.sin(light.angle) * xy,
      Math.sin(light.elevation) + 0.22,
    );
    this.keyLight.intensity = 1.25 + light.intensity * 2.25;
    this.ambientLight.intensity = 0.08 + light.ambient * 0.75;
    this.fillLight.intensity = 0.18 + (1 - light.warmth) * 0.7;
    this.keyLight.color.setRGB(
      0.86 + light.warmth * 0.28,
      0.9 + light.warmth * 0.1,
      1.06 - light.warmth * 0.28,
    );
  }

  resize() {
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

  frameMesh() {
    if (!this.mesh?.geometry.boundingSphere) return;
    const radius = this.mesh.geometry.boundingSphere.radius || 1;
    const scale = 0.92 / radius;
    this.mesh.scale.setScalar(scale);
  }

  pointer(event) {
    if (!this.mesh) return;
    const x = (event.clientX / window.innerWidth - 0.5) * 0.28;
    const y = (event.clientY / window.innerHeight - 0.5) * 0.28;
    this.mesh.rotation.x = y;
    this.mesh.rotation.y = -x;
    this.render();
  }

  render() {
    this.renderer.renderAsync(this.scene, this.camera);
  }
}
