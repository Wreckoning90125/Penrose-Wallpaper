// web/src/render/postFxRegistry.ts
import type Node from 'three/src/nodes/core/Node.js';
import type UniformNode from 'three/src/nodes/core/UniformNode.js';
import {
  abs, add, convertToTexture, dot, float, floor, Fn, fract, fwidth, luminance, max, mix, posterize,
  screenSize, screenUV, smoothstep, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { rgbShift } from 'three/addons/tsl/display/RGBShiftNode.js';
import { sobel } from 'three/addons/tsl/display/SobelOperatorNode.js';
import { afterImage } from 'three/addons/tsl/display/AfterImageNode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dotScreen } from 'three/addons/tsl/display/DotScreenNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { bleach } from 'three/addons/tsl/display/BleachBypass.js';
import { hashBlur } from 'three/addons/tsl/display/hashBlur.js';
import { anamorphic } from 'three/addons/tsl/display/AnamorphicNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import type { Vector3 } from 'three/webgpu';
import type { FxKind } from './postFxCatalog';
import { isFxKind } from './postFxCatalog';
import { trails, type TrailsMode } from './trailsNode';
import type { PostChainNode } from '../types';

export type FxUniforms = Record<string, UniformNode<'float', number>>;

// Shared per-pipeline resources a builder may read. Most ignore it; the feedback
// trail reads `bg` (the renderer's scene-background uniform) for its surface mask.
export type FxContext = {
  bg: UniformNode<'vec3', Vector3>;
};

export type FxBuilder = {
  createUniforms: () => FxUniforms;
  apply: (input: Node, u: FxUniforms, node: PostChainNode, ctx: FxContext) => Node;
};

const pixelateNode = Fn(([input, pixelSize]: [Node, Node<'float'>]) => {
  const texture = convertToTexture(input);
  const px = max(pixelSize, 1.0);
  const snapped = floor(screenUV.mul(screenSize).div(px)).mul(px).add(px.mul(0.5)).div(screenSize);
  return texture.sample(snapped);
});

// trail (0..1) -> damp. 0 is truly off; the slider maps to an exponential trail
// half-life (frames) so the usable range is perceptually even, and the top is
// capped at 0.985 so feedback can never accumulate to white. The base (46) is
// chosen so trail=1 lands right at the cap, leaving no dead travel.
export function afterImageDamp(trail: number): number {
  if (trail <= 0) return 0;
  const halfLifeFrames = Math.pow(46, Math.min(1, trail));
  return Math.min(0.985, Math.pow(0.5, 1 / halfLifeFrames));
}

export const FX_BUILDERS: Record<FxKind, FxBuilder> = {
  pixelate: {
    createUniforms: () => ({ size: uniform(1) }),
    apply: (input, u) => pixelateNode(input, u['size']!),
  },
  posterize: {
    createUniforms: () => ({ steps: uniform(256) }),
    apply: (input, u) => posterize(input, u['steps']!),
  },
  filmGrain: {
    createUniforms: () => ({ amount: uniform(0) }),
    apply: (input, u) => film(input, u['amount']!),
  },
  rgbShift: {
    createUniforms: () => ({ amount: uniform(0), angle: uniform(0) }),
    apply: (input, u) => {
      const shifted = rgbShift(input, 0, 0);
      shifted.amount = u['amount']!;
      shifted.angle = u['angle']!;
      return shifted;
    },
  },
  sobel: {
    createUniforms: () => ({ mix: uniform(0) }),
    apply: (input, u) => {
      const base = convertToTexture(input).sample(screenUV);
      const edge = convertToTexture(sobel(input)).sample(screenUV);
      return mix(base, edge, u['mix']!);
    },
  },
  afterImage: {
    // `trail` (0..1) is mapped through afterImageDamp() at write time — shared with
    // feedback (both are compose:'feedback'), so the renderer applies the curve to
    // the `trail` uniform of any feedback-domain effect uniformly.
    createUniforms: () => ({ trail: uniform(afterImageDamp(0)) }),
    apply: (input, u) => afterImage(input, u['trail']!),
  },
  bloom: {
    createUniforms: () => ({ strength: uniform(0.5), radius: uniform(0.4), threshold: uniform(0.8) }),
    apply: (input, u) => {
      const glow = bloom(input, 0.5, 0.4, 0.8);
      glow.strength = u['strength']!;
      glow.radius = u['radius']!;
      glow.threshold = u['threshold']!;
      const base = convertToTexture(input).sample(screenUV);
      return add(base, glow);
    },
  },
  toneMap: {
    createUniforms: () => ({}),
    apply: (input) => input,
  },
  dotScreen: {
    createUniforms: () => ({ angle: uniform(90), scale: uniform(0.35) }),
    apply: (input, u) => {
      const node = dotScreen(input, 0, 1);
      node.angle = u['angle']!;
      // The scale uniform carries the already-curved value (8*v^2 of the normalized
      // 0..1 control); see dotScreenScale + writePostChainUniforms.
      node.scale = u['scale']!;
      return node;
    },
  },
  chromaticAberration: {
    createUniforms: () => ({ strength: uniform(0), scale: uniform(1.1) }),
    // centerNode is required (no default); null -> ".build() of null". Screen
    // center in UV is vec2(0.5, 0.5) so the aberration radiates from the middle.
    apply: (input, u) => chromaticAberration(input, u['strength']!, vec2(0.5, 0.5), u['scale']!),
  },
  sepia: {
    createUniforms: () => ({ mix: uniform(0) }),
    apply: (input, u) => {
      const base = convertToTexture(input).sample(screenUV);
      // Inline sepia matrix (matches three/addons Sepia.js) for typed vec4 output, enabling mix()
      const c = base.rgb;
      const sepiaColor = vec4(
        dot(c, vec3(0.393, 0.769, 0.189)),
        dot(c, vec3(0.349, 0.686, 0.168)),
        dot(c, vec3(0.272, 0.534, 0.131)),
        base.a,
      );
      return mix(base, sepiaColor, u['mix']!);
    },
  },
  bleach: {
    createUniforms: () => ({ opacity: uniform(0) }),
    apply: (input, u) => {
      const base = convertToTexture(input).sample(screenUV);
      return bleach(base, u['opacity']!);
    },
  },
  blur: {
    createUniforms: () => ({ amount: uniform(0) }),
    apply: (input, u) => hashBlur(convertToTexture(input), u['amount']!),
  },
  anamorphic: {
    createUniforms: () => ({ threshold: uniform(0.9), scale: uniform(3) }),
    apply: (input, u, node) => {
      const samples = Number(node.selects['samples'] ?? '32');
      const streaks = anamorphic(input, u['threshold']!, u['scale']!, samples);
      const base = convertToTexture(input).sample(screenUV);
      return add(base, streaks);
    },
  },
  feedback: {
    // The cross-frame trail (TrailsNode) is a stateful node, but it's still built
    // here like every other effect: createUniforms owns its live params, apply
    // constructs the node and wires them in. `mask`/`mode` are structural (they're
    // in fxStructuralSignature), so they bake at build time; `bg` comes from the
    // shared context; disposal is generic (TrailsNode owns render targets, so the
    // renderer's disposePostTree frees it like bloom/afterImage).
    createUniforms: () => ({
      trail: uniform(afterImageDamp(0)),
      zoom: uniform(0),
      rotate: uniform(0),
      rotateSin: uniform(0),
      rotateCos: uniform(1),
      hue: uniform(0),
      hueSin: uniform(0),
      hueCos: uniform(1),
    }),
    apply: (input, u, node, ctx) => {
      const mode: TrailsMode = node.selects['mode'] === 'afterimage' ? 'afterimage'
        : node.selects['mode'] === 'both' ? 'both' : 'trails';
      const maskMode = node.selects['mask'] === 'surface' ? 1 : node.selects['mask'] === 'inverse' ? 2 : 0;
      // Unmasked afterimage should be exactly as cheap as the dedicated Afterimage
      // node. Trails/Both must still build the custom node even when the current
      // transform params are zero, because those params are uniforms and can be
      // dragged or audio-driven later without a structural rebuild.
      if (maskMode === 0 && mode === 'afterimage') return afterImage(input, u['trail']!);
      return trails(input, mode, {
        decay: u['trail']!,
        hueCos: u['hueCos']!,
        hueSin: u['hueSin']!,
        maskMode,
        rotateCos: u['rotateCos']!,
        rotateSin: u['rotateSin']!,
        zoom: u['zoom']!,
        bg: ctx.bg,
      });
    },
  },
  aa: {
    createUniforms: () => ({}),
    apply: (input, _u, node) => {
      const mode = node.selects['mode'] ?? 'off';
      if (mode === 'fxaa') return fxaa(input);
      if (mode === 'smaa') return smaa(input);
      return input;
    },
  },
  contours: {
    createUniforms: () => ({ spacing: uniform(12), width: uniform(0.12), mix: uniform(0), phase: uniform(0), r: uniform(0), g: uniform(0), b: uniform(0) }),
    apply: (input, u) => {
      const base = convertToTexture(input).sample(screenUV);
      const luma = luminance(base.rgb);
      const banded = luma.mul(u['spacing']!).add(u['phase']!);
      const line = abs(fract(banded).sub(0.5));
      const aa = fwidth(banded).max(0.0001);
      const lineMask = float(1).sub(smoothstep(u['width']!.sub(aa), u['width']!.add(aa), line));
      const lineColor = vec3(u['r']!, u['g']!, u['b']!);
      return mix(base, vec4(lineColor, base.a), lineMask.mul(u['mix']!));
    },
  },
};

export function fxBuilder(kind: string): FxBuilder | null {
  if (isFxKind(kind)) return FX_BUILDERS[kind];
  return null;
}
