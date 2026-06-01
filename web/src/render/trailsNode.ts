// web/src/render/trailsNode.ts
// TS port of three/addons/tsl/display/AfterImageNode.js with public uniform
// fields, a structural feedback `mode`, and a richer fragment graph for the
// studio "acid hands" trails look (warped UV resample, hue rotation, decay,
// max-combine, optional background-distance mask).
import { RenderTarget, Vector2, Vector3, QuadMesh, NodeMaterial, RendererUtils, TempNode, NodeUpdateType } from 'three/webgpu';
import type { RendererState } from 'three/src/renderers/common/RendererUtils.js';
import type NodeFrame from 'three/src/nodes/core/NodeFrame.js';
import type TextureNode from 'three/src/nodes/accessors/TextureNode.js';
import type Node from 'three/src/nodes/core/Node.js';
import type UniformNode from 'three/src/nodes/core/UniformNode.js';
import {
  Fn, float, vec2, vec3, uv, texture, convertToTexture, nodeObject,
  max, mix, sin, cos, cross, dot, normalize, distance, smoothstep, step, sign, passTexture,
} from 'three/tsl';

const _size = new Vector2();
const _quadMesh = new QuadMesh();

let _rendererState: RendererState;

export type TrailsMode = 'afterimage' | 'trails' | 'both';

// The live inputs a TrailsNode reads. decay/zoom/rotate/hue are external uniforms
// owned by the post-chain (written generically each frame); bg is the renderer's
// shared scene-background uniform; maskMode is baked (the `mask` select is
// structural, so it changes only on recompile — no per-frame uniform needed).
export type TrailsInputs = {
  decay: UniformNode<'float', number>;
  zoom: UniformNode<'float', number>;
  rotate: UniformNode<'float', number>;
  hue: UniformNode<'float', number>;
  maskMode: number;
  bg: UniformNode<'vec3', Vector3>;
};

const hueRotate = Fn(([color, angle]: [Node<'vec3'>, Node<'float'>]) => {
  const k = normalize(vec3(1, 1, 1));
  const c = cos(angle.mul(6.28318530718));
  const s = sin(angle.mul(6.28318530718));
  return color.mul(c).add(cross(k, color).mul(s)).add(k.mul(dot(k, color)).mul(float(1).sub(c)));
});

class TrailsNode extends TempNode {
  textureNode: TextureNode;
  mode: TrailsMode;
  decay: UniformNode<'float', number>;
  zoom: UniformNode<'float', number>;
  rotate: UniformNode<'float', number>;
  hue: UniformNode<'float', number>;
  bg: UniformNode<'vec3', Vector3>;

  private _maskMode: number;
  private _compRT: RenderTarget;
  private _oldRT: RenderTarget;
  private _textureNode: TextureNode;
  private _textureNodeOld: TextureNode;
  private _material: NodeMaterial | null;

  constructor(textureNode: TextureNode, mode: TrailsMode, inputs: TrailsInputs) {
    super('vec4');

    this.textureNode = textureNode;
    this.mode = mode;

    this.decay = inputs.decay;
    this.zoom = inputs.zoom;
    this.rotate = inputs.rotate;
    this.hue = inputs.hue;
    this.bg = inputs.bg;
    this._maskMode = inputs.maskMode;

    this._compRT = new RenderTarget(1, 1, { depthBuffer: false });
    this._compRT.texture.name = 'TrailsNode.comp';

    this._oldRT = new RenderTarget(1, 1, { depthBuffer: false });
    this._oldRT.texture.name = 'TrailsNode.old';

    // Three's r184 stateful post nodes expose their result via PassTextureNode so
    // the builder knows this texture is owned by the pass node. Runtime accepts a
    // TempNode owner (AfterImageNode does the same); @types narrows it to PassNode.
    // @ts-expect-error see comment above: r184 addon pattern is passTexture(this, texture).
    this._textureNode = passTexture(this, this._compRT.texture);
    this._textureNodeOld = texture(this._oldRT.texture);

    this._material = null;

    this.updateBeforeType = NodeUpdateType.FRAME;
  }

  getTextureNode(): TextureNode {
    return this._textureNode;
  }

  setSize(width: number, height: number): void {
    this._compRT.setSize(width, height);
    this._oldRT.setSize(width, height);
  }

  override updateBefore(frame: NodeFrame): boolean | undefined {
    const renderer = frame.renderer;
    if (renderer === null) return undefined;

    _rendererState = RendererUtils.resetRendererState(renderer, _rendererState);

    const textureNode = this.textureNode;
    const map = textureNode.value;
    const textureType = map.type;

    this._compRT.texture.type = textureType;
    this._oldRT.texture.type = textureType;

    renderer.getDrawingBufferSize(_size);
    this.setSize(_size.x, _size.y);

    this._textureNode.value = this._compRT.texture;
    this._textureNodeOld.value = this._oldRT.texture;

    const material = this._material;
    if (material === null) return undefined;
    _quadMesh.material = material;
    _quadMesh.name = 'Trails';

    renderer.setRenderTarget(this._compRT);
    _quadMesh.render(renderer);

    const temp = this._oldRT;
    this._oldRT = this._compRT;
    this._compRT = temp;

    RendererUtils.restoreRendererState(renderer, _rendererState);
    return undefined;
  }

  override setup(): TextureNode {
    const textureNode = this.textureNode;
    const textureNodeOld = this._textureNodeOld;

    textureNodeOld.uvNode = textureNode.uvNode || uv();

    const fragment = Fn(() => {
      const cur = textureNode.sample(textureNode.uvNode || uv()).toVar();

      if (this.mode === 'afterimage') {
        const old = textureNodeOld.sample(textureNodeOld.uvNode || uv()).toVar();
        const oldGate = max(sign(old.sub(0.1)), 0.0);
        old.mulAssign(this.decay.mul(oldGate));
        const accum = max(cur, old);
        if (this._maskMode === 0) return accum;
        const bgDist = distance(cur.rgb, this.bg);
        const surface = smoothstep(0.003, 0.012, bgDist);
        const isInv = step(1.5, float(this._maskMode));
        const masked = mix(surface, surface.oneMinus(), isInv);
        return mix(cur, accum, masked);
      }

      const center = vec2(0.5, 0.5);
      const p = uv().sub(center).mul(float(1).add(this.zoom));
      const sa = sin(this.rotate);
      const ca = cos(this.rotate);
      const wuv = vec2(ca.mul(p.x).sub(sa.mul(p.y)), sa.mul(p.x).add(ca.mul(p.y))).add(center);
      const old = textureNodeOld.sample(wuv).toVar();
      old.rgb.assign(hueRotate(old.rgb, this.hue));
      old.mulAssign(this.decay);

      const accum = this.mode === 'both'
        ? max(cur, max(old, textureNodeOld.sample(textureNodeOld.uvNode || uv()).mul(this.decay))).toVar()
        : max(cur, old).toVar();
      if (this._maskMode === 0) return accum;
      const bgDist = distance(cur.rgb, this.bg);
      const surface = smoothstep(0.003, 0.012, bgDist);
      const isInv = step(1.5, float(this._maskMode));
      const masked = mix(surface, surface.oneMinus(), isInv);
      const m = mix(float(1), masked, step(0.5, float(this._maskMode)));
      return mix(cur, accum, m);
    });

    const material = this._material || (this._material = new NodeMaterial());
    material.name = 'Trails';
    material.fragmentNode = fragment();

    return this._textureNode;
  }

  override dispose(): void {
    this._compRT.dispose();
    this._oldRT.dispose();
    if (this._material !== null) this._material.dispose();
  }
}

export { TrailsNode };

export const trails = (node: Node, mode: TrailsMode, inputs: TrailsInputs): TrailsNode =>
  new TrailsNode(convertToTexture(nodeObject(node)), mode, inputs);
