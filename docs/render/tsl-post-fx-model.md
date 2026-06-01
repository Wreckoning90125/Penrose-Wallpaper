# Three r184 TSL Post-FX Model

The web renderer uses Three r184 WebGPU and TSL. The important boundary is not
the UI panel label; it is where the value enters the renderer.

## Renderer Layers

| Layer | Three/TSL shape | Repo examples | Rule |
|------|------------------|---------------|------|
| Surface/material | `MeshPhysicalNodeMaterial`, `positionNode`, `normalNode`, material property nodes | relief, depth drive, ripple displacement/color, roughness, worn edges, metal variation, clearcoat, anisotropy, iridescence, emissive | Target controls; update uniforms/material nodes, not post-FX chain topology |
| Screen post-FX | `RenderPipeline`, `pass(scene, camera)`, `outputNode`, input color nodes returning `vec4` | pixelate, posterize, film grain, RGB shift, Sobel mix, afterimage | Composited post-FX; update uniforms at slider rate and rebuild only when the chain topology changes |
| Multi-pass display | r184 display addons that need depth, normal, motion, MRT, or extra render targets | bloom, FXAA/SMAA/TAA/SSAA, GTAO, SSR, SSGI, SSS, depth of field, outline, denoise, motion blur | Add only with the required pass data and health checks; do not fake them as material sliders |
| Scene/render helpers | controls, helpers, exporters, loaders, WebGL `EffectComposer` passes | Orbit/Arcball controls, legacy postprocessing passes, loaders | Reference only; do not mix WebGL composer patterns into the WebGPU TSL pipeline |

## Current Web Chain

`web/src/render/webgpuRenderer.ts` creates one `RenderPipeline`. Its ordered
shape is:

1. surface assembly: tiling geometry is projected, classified, assigned palette
   slots, and bound to material and field-source uniforms (displacement / relief
   / colour) before render;
2. scene pass: `pass(scene, camera)` renders that scene into pass textures;
3. screen chain: each Post-FX node consumes the previous frame node and returns
   the next screen `vec4`;
4. display: `renderPipeline.outputNode` is the last frame in that chain.

The current screen chain folds these operations over the scene pass color:

1. custom TSL pixelate using `screenUV`, `screenSize`, and `convertToTexture`;
2. `posterize`;
3. `film`;
4. `rgbShift`;
5. `sobel`, mixed back over the shifted color;
6. `afterImage` only when its control is non-zero.

The first five effects stay in the compiled chain and are controlled by
uniforms. `afterImage` owns render targets, so the renderer rebuilds the output
node only when that effect is enabled or disabled.

## Graph Order

The working reference for this graph model is
`/home/wreckoning90125/PrismicHolonomy/src/apps/procedural-morphology-lab`.
That app uses typed feed-forward streams: geometry/material/scene data flows
toward the scene pass, screen effects consume and emit frame streams, and audio
or clock operators feed parameter inlets only. That is the model to preserve
here because it makes node stacking meaningful.

The control graph must mirror the same ordering:

```text
Atlas -> Tiling -> Projection -> Color mapper -> Surface material -> Scene pass -> Post-FX -> Display sink
              Field source (displace/relief/color) ----------------^
                                      Lighting -----------------------------^
```

`Surface material` is the pre-scene surface contract. It collects palette
color and physical material settings; the `Field source` node feeds the
renderer three separate fields (displace / relief / color) plus brightness and
speed, all resolved before Three evaluates `MeshPhysicalNodeMaterial` and
`positionNode`.

`Scene pass` is the point where Three renders the already configured scene into
frame textures. Geometry, color, material, and field targets cannot arrive as
late independent inputs to that pass and still affect mesh shading. They must
be resolved before `pass(scene, camera)` renders.

`Post-FX` is a frame processor. It needs a `Frame` inlet because TSL display
effects operate on an input color node or pass texture. Chaining is
feed-forward: `frame -> effect -> frame -> effect -> frame`. A Post-FX node
with no frame inlet is a category error because it implies an effect can
produce the rendered scene without consuming the previous pass.

`Display sink` consumes the final frame. It has no geometry/material/light
inlets because those are already baked into the frame by the scene pass.

## Source Checks

- `three/examples/webgpu_postprocessing.html` creates `RenderPipeline`, then
  `scenePass = pass(scene, camera)`, then feeds `scenePass.getTextureNode()` to
  `dotScreen`, then feeds that output to `rgbShift`, then assigns
  `renderPipeline.outputNode`.
- `three/examples/webgpu_postprocessing_traa.html` requests named scene pass
  outputs for color, depth, and velocity before passing them to TRAA.
- `three/examples/webgpu_postprocessing_sss.html` uses a pre-pass for depth and
  velocity, then a scene pass whose context is modified before the temporal
  anti-aliasing output is selected.
- `three/examples/jsm/tsl/display/AfterImageNode.js` owns previous-frame render
  targets, so it is a frame-history node, not a material or scene target.
- `three/examples/jsm/tsl/display/PixelationPassNode.js` reads color, depth,
  and normal outputs from its pass. Those textures must exist before the effect
  can run.

## Repo Rule

Ripple, depth drive, brightness, and material relief are renderer targets, not
post-FX. They affect tile displacement, color, normals, and material response
before the scene is rendered. True post-FX starts after `pass(scene, camera)`
and returns a composited screen `vec4`.

Color picker drags must update the live renderer surface without replacing the
mesh or rebuilding the control graph. Persisted palette state can commit at
React speed, but the visible vertex color buffer has to update in place while
the pointer moves.

Post-FX nodes must have a frame input and a frame output. They may expose
operator-controllable parameters, but those parameters do not replace the
upstream frame dependency. The renderer may build the chain internally from
settings today, but the graph still has to represent the data dependency so
future FX chaining is serial instead of parallel and unaware.

Audio modulation follows the morphology lab target-range rule: graph output is
a modulation signal, not an absolute replacement setting. The target computes
`clamp(baseline + graphValue * (max - min), min, max)`. In ride mode that delta
rides on the live baseline while the user drags; in hold mode the baseline wins
until release.

Geometry and palette modulation use the same target-range rule, but they are
render-preview state rather than preset writes. Generation, palette slots,
projection subdivisions, and luminance can affect the active render path at
audio rate; saved settings remain the reload baseline unless the user commits a
control edit.

If a new effect needs scene depth, normals, motion, MRT output, or history
buffers, add that data path explicitly before exposing the slider. Do not put
the control in the Post-FX node until the renderer has the matching r184 TSL
pass.
