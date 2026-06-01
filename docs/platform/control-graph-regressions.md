# Control Graph Regression Lessons

These notes preserve the graph and renderer failure cases that have already
cost debugging time. They are implementation rules for the web control graph,
not a history of individual fixes.

Primary references:

- React Flow utility classes: `nodrag`, `nopan`, and `nowheel` control whether
  node internals start drags, pans, or wheel handling.
- React Flow dynamic handles: when handle count or handle position changes,
  call `useUpdateNodeInternals` so edge anchors are recalculated.
- Three TSL physical material nodes: `MeshPhysicalNodeMaterial` accepts node
  overrides for clearcoat, iridescence, anisotropy, roughness, metalness, and
  vertex position.
- Three `MeshPhysicalMaterial`: clearcoat, anisotropy, iridescence, and
  environment intensity only read as real material controls when geometry,
  normals, lights, and environment reflections support them.

## Bad Pattern

- Rebuilding React Flow node data on every projection-boost preview frame.
  This made right-drag boost and graph sliders capable of triggering maximum
  update depth errors, graph hitches, and black-screen failures.
- Using preview/commit indirection to hide slider lag. A slider that lies while
  dragging makes ride/hold modulation ambiguous and breaks user trust.
- Updating the whole graph for a local control change. Palette slot changes,
  material sliders, projection settings, operator gains, and transport seeks
  must not all remap every node.
- Rebuilding and replacing mesh geometry during custom color drags. This can
  black out the canvas until pointer-up and makes color input feel slower than
  the renderer uniforms.
- Treating React or React Flow backing state as the only valid live UI state.
  Number fields, slider thumbs, renderer uniforms, audio meters, and transport
  time may need frame-rate updates while saved graph data only needs gesture-end
  commits.
- Exposing a visible signal inlet that rejects wires or has no render effect.
  Generation, palette slots, luminance, projection subdivisions, material,
  lighting, field-source, and true post-FX parameters must all use the same
  signal contract once they appear as ports.
- Applying audio-rate geometry or palette modulation by overwriting preset
  settings. That turns a live graph signal into saved state drift and makes
  preset load/save nondeterministic.
- Letting port labels intercept pointer events from nearby handles or wires.
  Labels can explain ports, but they must not block reconnect drags.
- Moving compressed IO labels independently from handles. This causes labels
  to cover inlet/outlet dots and leaves edge wires landing above or below the
  visual port center.
- Guessing layout offsets from expected node sizes. Tall material cards,
  collapsed IO, minimap chrome, and renderer inlets then drift into overlap.
- Letting inactive toolbar controls participate in pane gestures. Delete-link
  and other non-pane controls can leave a sticky pan if mouse capture crosses
  a disabled-looking but still interactive element.
- Blocking wheel zoom over nodes by applying wheel-suppression classes broadly.
  `nowheel` is for scrollable inner content, not for normal node surfaces.
- Regressing graph chrome during cleanup. The fit button must keep the
  recognizable fit icon, the minimap must remain visible, and add/remove
  operator flows must stay wired.
- Treating target-only field-source controls as a composited post-processing
  pass. True composited post-FX must remain separate from direct material or
  displacement targets.
- Wiring geometry, color, material, and depth as separate late renderer
  inlets. That makes the scene pass look like a back-propagating merger instead
  of the point where an already configured scene is rendered.
- Giving Post-FX no frame inlet, or wiring it as a late input to the renderer.
  That implies screen-space effects can appear after the scene has rendered
  without consuming the rendered frame.
- Drawing borders through a different projection or displacement path from
  tiles. At low relief this makes seams appear detached or animated differently
  from the surface.
- Implementing depth drive as another tile-ring or type z offset. That makes
  depth read like relief with different coefficients instead of a distinct
  target with directional/parallax behavior.
- Enabling physical material sliders without matching renderer support.
  Clearcoat needs environment/light response, anisotropy needs directional
  geometry or normals, iridescence needs film thickness variation, and worn
  edges/metal variation need stable per-tile attributes.

## Correct Pattern

- Keep high-frequency preview state out of `setNodes`. Projection boost preview
  lives in a small subscription store read only by the projection UI; settings
  receive the committed boost at gesture end.
- Keep displayed slider values live while dragging. The same value the user
  sees is the value sent to the targeted setting, gain, palette, or operator.
- Keep custom color drags on the live renderer path. Update an existing color
  buffer or renderer uniform in place; save/reload state can catch up without
  replacing geometry on every pointer move.
- Split live preview from persistence by ownership, not by lying in the UI.
  Local control state and renderer uniforms can update immediately; React Flow
  node data, preset state, and reloadable settings commit at gesture end.
- Preserve ride/hold edit tracking for every slider-like control by calling the
  edit begin/end callbacks across pointer, focus, blur, and final change.
- Update only the node class that owns the change: palette, material,
  projection, field source, true post-FX, lighting, clock, operator,
  transport, or renderer.
- Measure port rows, place handles from those measured centers, and call
  `useUpdateNodeInternals` after the measured position changes. When IO labels
  collapse, the top port remains anchored to the expanded layout and lower
  ports compress from that anchor.
- Use measured node widths and heights for auto-arrange. Add IO overhang, then
  quantize row steps to the snap grid so repeated reset/load/fit converges to
  stable grid positions.
- Keep `nodrag` on buttons, inputs, labels, and sliders; use `nopan` on fixed
  graph chrome; reserve `nowheel` for scrollable subpanels that must consume
  wheel events.
- Keep fit, minimap, controls, drawer handle, delete-link selection, and
  add/remove operator interactions in the regression surface. These are graph
  affordances, not cosmetic extras.
- Keep the graph structure direct: source, audio analysis, and clock nodes feed
  operators; operators feed material, lighting, projection, field source,
  true post-FX parameters, or renderer target inlets.
- Use the TPMS visualizer target-range model, confirmed in
  `src/apps/procedural-morphology-lab`: a graph value is a modulation delta
  over the live baseline, not an absolute replacement for saved settings.
  Ride keeps that delta active while the baseline moves; hold suppresses the
  delta only for the parameter being edited until release.
- Route audio-driven geometry and palette targets through a render-preview
  overlay. The renderer and geometry builder may see generation, slot count,
  subdivision, or luminance changes immediately, but preset settings remain the
  reload baseline until the user commits an edit or explicitly saves a changed
  control.
- Keep port labels pointer-transparent enough that labels, handles, and edge
  anchors remain usable as one target zone. Label opacity can help wire
  visibility, but label position must still come from measured port rows.
- Mirror render pass order in frame-space graph edges. Scene inputs feed the
  surface material before the scene pass; the scene pass emits a frame, Post-FX
  consumes and emits a frame, and the display sink consumes the final frame.
- Make border geometry share the same projection and vertex displacement path
  as tile geometry. Any z bias should be a small surface bias, not a separate
  relief model.
- Keep relief and depth separate in the renderer contract. Relief owns the
  baked center-to-edge tile surface; depth drive owns a tile-local directional
  field that can be modulated without changing relief height.
- Treat physical material controls as renderer contracts. The web path must map
  roughness, worn edges, metal variation, clearcoat, anisotropy, iridescence,
  emissive, and environment lighting to actual Three r184 TSL material behavior.

## Repo Rule

- Do not add a graph-wide `setNodes` loop for frame-rate state. If a value can
  update on pointer move, audio tick, or animation frame, put it in a ref,
  renderer uniform, or narrowly subscribed store.
- Do not require reloadable backing state to update at pointer or audio rate.
  It is valid for UI/render state to be immediate and for saved state to commit
  on pointer up, blur, explicit save, or page-leave flush.
- Do not ship inert ports. If a node exposes an inlet for a control, signal
  validation, target-range mapping, ride/hold behavior, and render application
  must all exist in the same change.
- Do not allow arbitrary cross-stream wires. Frame edges stack frame effects,
  surface edges build the scene input, and signal edges drive parameter inlets.
  If multiple signals should affect one target, combine them with an operator
  node instead of parallel target wires.
- Do not put palette drags in the geometry-build dependency chain. Color
  selection may change persisted palette state, but live color preview must
  dirty only the targeted renderer color data.
- Do not fake smooth sliders with a hidden preview value. Fix ownership and
  update scope so the real value can move smoothly.
- Do not move, hide, or resize handles without updating React Flow internals.
  Handle dots and edge anchors must be the same visual point.
- Do not layout from guessed constants when measured React Flow dimensions are
  available. Reset graph, initial load, fit, and saved graph load must share the
  same measured layout function.
- Do not use `display: none` for handles that React Flow needs to measure.
  Hide with opacity or visibility when a handle must remain connectable.
- Do not let control chrome look modal or opaque. Minimap, controls, and drawer
  handles stay semi-transparent so renderer health checks can distinguish real
  DOM occlusion from normal page chrome.
- Do not merge target-only modulation controls into future true post-FX passes.
  Ripple, depth drive, brightness, and material relief are surface targets;
  composited post-FX must start from `pass(scene, camera)` as a distinct
  renderer stage.
- Do not give the scene pass a late FX inlet. Any screen-space effect must
  consume an upstream frame and emit a downstream frame, so FX chaining remains
  serial and explicit.
- Do not give the scene pass separate late `Geo`, `Color`, `Mat`, or `Depth`
  inlets. The graph contract is `Surface + Light -> Scene pass -> Frame`.
- Do not treat depth drive as a renamed relief multiplier. If changing depth
  and relief produce the same visual response, the surface attributes or
  displacement shader are wrong.
- Do not reintroduce pixel-polling render-health probes. Actual WebGPU device
  loss must surface through the canonical device-loss path, and visual render
  correctness needs a real preview or headed browser check.
