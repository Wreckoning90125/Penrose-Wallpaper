# Render documentation

Renderer notes for the Android Vulkan path and the web Three WebGPU/TSL path.
These documents define which controls belong to surface/material shading, which
belong to true screen-space post-processing, and which changes require geometry
or graph updates.

| File | Scope |
|------|-------|
| [`physical-material.md`](physical-material.md) | Android and web physical surface/material model |
| [`tsl-post-fx-model.md`](tsl-post-fx-model.md) | Three r184 TSL screen-space post-FX model and repo ownership rules |
| [`effects-graph-design.md`](effects-graph-design.md) | Design spec: graph-as-source-of-truth, chainable post-FX (Block 1), surface/field + projection roadmap |
