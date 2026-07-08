// web/src/render/anamorphicNode.ts
// TS port of three/addons/tsl/display/AnamorphicNode.js. Vendored locally because
// r185 removed the addon (examples/jsm/tsl/display/AnamorphicNode.js is gone and
// @types/three@0.185 no longer ships its declaration), and this app exposes the
// effect as the `anamorphic` post-FX: a horizontal, luminance-thresholded
// streak accumulated across `samples` offset taps. It deliberately diverges
// from the r184 addon in two ways: the tap accumulation is weight-normalized
// (the addon's raw sum applies a ~samples/2 gain), and the flare colour is a
// live neutral->blue tint uniform instead of the addon's baked blue. The Loop
// over taps is unrolled in JS (samples is a build-time constant) so no TSL
// `Loop` node is needed. Mirrors the TempNode/passTexture vendoring pattern
// already used by trailsNode.ts.
import { RenderTarget, Vector2, TempNode, QuadMesh, NodeMaterial, RendererUtils } from 'three/webgpu';
import type { RendererState } from 'three/src/renderers/common/RendererUtils.js';
import type NodeFrame from 'three/src/nodes/core/NodeFrame.js';
import type TextureNode from 'three/src/nodes/accessors/TextureNode.js';
import type Node from 'three/src/nodes/core/Node.js';
import type UniformNode from 'three/src/nodes/core/UniformNode.js';
import {
  Fn, uv, passTexture, uniform, convertToTexture, nodeObject, vec2, vec3, mix, luminance,
  NodeUpdateType,
} from 'three/tsl';

const _size = new Vector2();
const _quadMesh = new QuadMesh();

let _rendererState: RendererState;

class AnamorphicNode extends TempNode {
  textureNode: TextureNode;
  thresholdNode: Node<'float'>;
  scaleNode: Node<'float'>;
  intensityNode: Node<'float'>;
  tintNode: Node<'float'>;
  samples: number;
  resolutionScale: number;

  private _renderTarget: RenderTarget;
  private _invSize: UniformNode<'vec2', Vector2>;
  private _textureNode: TextureNode;
  private _material: NodeMaterial | null;

  constructor(
    textureNode: TextureNode,
    thresholdNode: Node<'float'>,
    scaleNode: Node<'float'>,
    samples: number,
    intensityNode: Node<'float'>,
    tintNode: Node<'float'>,
  ) {
    super('vec4');

    this.textureNode = textureNode;
    this.thresholdNode = thresholdNode;
    this.scaleNode = scaleNode;
    // intensity scales the (weight-normalized) streak; tint fades the streak
    // colour from neutral white (0) to the upstream addon's blue flare (1).
    // The upstream addon bakes vec3(0.1, 0, 1) and skips normalization, which
    // suits HDR bloom compositing but explodes brightness (+blue cast) when
    // composited additively pre-tonemap as this app does.
    this.intensityNode = intensityNode;
    this.tintNode = tintNode;
    this.samples = samples;
    this.resolutionScale = 1;

    this._renderTarget = new RenderTarget(1, 1, { depthBuffer: false });
    this._renderTarget.texture.name = 'anamorphic';
    this._invSize = uniform(new Vector2());

    // r184 addon pattern: stateful post nodes expose their result via
    // PassTextureNode so the builder knows the texture is pass-owned. Runtime
    // accepts a TempNode owner (as trailsNode.ts does); @types narrows it to PassNode.
    // @ts-expect-error see comment above: addon pattern is passTexture(this, texture).
    this._textureNode = passTexture(this, this._renderTarget.texture);
    this._material = null;

    this.updateBeforeType = NodeUpdateType.FRAME;
  }

  getTextureNode(): TextureNode {
    return this._textureNode;
  }

  setSize(width: number, height: number): void {
    this._invSize.value.set(1 / width, 1 / height);
    const w = Math.max(Math.round(width * this.resolutionScale), 1);
    const h = Math.max(Math.round(height * this.resolutionScale), 1);
    this._renderTarget.setSize(w, h);
  }

  override updateBefore(frame: NodeFrame): boolean | undefined {
    const renderer = frame.renderer;
    if (renderer === null) return undefined;

    _rendererState = RendererUtils.resetRendererState(renderer, _rendererState);

    const textureNode = this.textureNode;
    const map = textureNode.value;
    this._renderTarget.texture.type = map.type;

    const material = this._material;
    if (material === null) {
      RendererUtils.restoreRendererState(renderer, _rendererState);
      return undefined;
    }
    _quadMesh.material = material;
    _quadMesh.name = 'Anamorphic';

    renderer.getDrawingBufferSize(_size);
    this.setSize(_size.x, _size.y);

    renderer.setRenderTarget(this._renderTarget);
    _quadMesh.render(renderer);

    RendererUtils.restoreRendererState(renderer, _rendererState);
    return undefined;
  }

  override setup(): TextureNode {
    const textureNode = this.textureNode;
    const uvNode = textureNode.uvNode || uv();

    const anamorph = Fn(() => {
      const halfSamples = Math.floor(this.samples / 2);
      let total: Node<'vec3'> = vec3(0);
      let weightSum = 0;
      for (let i = -halfSamples; i <= halfSamples; i++) {
        // triangular falloff toward the outer taps (1 at centre, 0 at the ends)
        const softness = halfSamples > 0 ? 1 - Math.abs(i) / halfSamples : 1;
        weightSum += softness;
        const sampleUv = vec2(uvNode.x.add(this._invSize.x.mul(i).mul(this.scaleNode)), uvNode.y);
        const color = textureNode.sample(sampleUv);
        // luminance threshold: keep only what exceeds thresholdNode, then weight
        const pass = mix(vec3(0.0), color.rgb, luminance(color).sub(this.thresholdNode).max(0)).mul(softness);
        total = total.add(pass);
      }
      // Normalize by the weight sum so streak energy is invariant to the
      // sample count (unnormalized, samples=32 applies a ~16x gain).
      const streak = total.mul(1 / Math.max(weightSum, 1e-4));
      const tint = mix(vec3(1.0, 1.0, 1.0), vec3(0.1, 0.0, 1.0), this.tintNode);
      return streak.mul(tint).mul(this.intensityNode);
    });

    const material = this._material || (this._material = new NodeMaterial());
    material.name = 'Anamorphic';
    material.fragmentNode = anamorph();

    return this._textureNode;
  }

  override dispose(): void {
    this._renderTarget.dispose();
    if (this._material !== null) this._material.dispose();
  }
}

export { AnamorphicNode };

export const anamorphic = (
  node: Node,
  threshold: Node<'float'> | number = 0.9,
  scale: Node<'float'> | number = 3,
  samples = 32,
  intensity: Node<'float'> | number = 1,
  tint: Node<'float'> | number = 0,
): AnamorphicNode =>
  new AnamorphicNode(
    convertToTexture(nodeObject(node)),
    nodeObject(threshold),
    nodeObject(scale),
    samples,
    nodeObject(intensity),
    nodeObject(tint),
  );
