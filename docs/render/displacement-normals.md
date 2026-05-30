# Displacement shading: smoothness is the NORMAL, not the geometry

## The model

A height-field displacement `z = f(x, y)` has an exact surface normal at every
point:

```
N = normalize( -∂f/∂x , -∂f/∂y , 1 )
```

That normal is a continuous function of position. Smoothness of the *shading* is
entirely whether the renderer uses this normal. It has **nothing to do with how
many triangles the geometry has or how high the wave frequency is.**

The renderer was using `normalFlat`, three's flat normal:

```
normalFlat = positionView.dFdx().cross( positionView.dFdy() )
```

That is the **face normal** of the rasterized triangle — one constant value per
triangle. So the surface is shaded as a set of flat plates. Displace the vertices
and each plate just tilts to a new constant orientation; adjacent plates meet at
an angle ⇒ visible creases. This happens for *any* displacement, including a
perfectly smooth sine, because the face normal throws away the within-triangle
gradient and replaces it with a single plane.

## Why frequency and subdivision *looked* like the cause (the trap)

They both change the **visibility** of the faceting, not its mechanism. The error
between a triangle's face normal and the true normal scales with how much the
true normal turns across that triangle, i.e. with

```
(triangle edge length) × (gradient curvature) ≈ Δx · f
```

- **Frequency `f` ↑** → the normal turns more across a fixed triangle span → the
  face normal is a worse approximation → facets become obvious. Lowering `f` makes
  adjacent face normals nearly equal, so the plates look continuous. The faceting
  was always there; low frequency just shrank it below notice.
- **Subdivision** (smaller `Δx`) → each triangle spans less surface → the normal
  turns less across it → same masking. It's a sampling-rate fix: enough triangles
  relative to `f` and face normals approximate the true normal.

So both "fixes" are the **same** workaround — make `Δx · f` small — and neither
touches the cause. The decisive tell was empirical: the *same* low-poly geometry
undulated as smooth paper at low `f` and faceted at high `f`. Same polys, two
outcomes ⇒ poly count is not the determinant; the per-triangle gradient is, which
means the normal is.

## The fix

Compute `N` directly from the displacement and shade with it (`surfaceNormalNode`
in `web/src/render/webgpuRenderer.ts`): finite-difference the displacement in the
boosted plane and `transformNormalToView`:

```
N_local = normalize( vec3( (f(x,y) - f(x+ε,y))/ε , (f(x,y) - f(x,y+ε))/ε , 1 ) )
N_view  = transformNormalToView( N_local )
```

Evaluated per fragment, this is the true surface normal regardless of triangle
size or frequency. The geometry can stay coarse — its silhouette/intersection is
still faceted, but on a near-flat sheet the shading normal dominates perceived
smoothness, so the sheet undulates smoothly. Geometry sampling (vertex positions)
and the shading normal are independent; the bug conflated them.

## Process lesson

Same-geometry-two-outcomes falsified the poly-count hypothesis on the first
observation. Honour an empirical contradiction the moment it appears instead of
re-explaining it. For any "displacement looks faceted / like relief" report, read
the `normalNode` before considering frequency, amplitude, or tessellation — those
are the variables that *mask* the bug, which is why they mislead.

## Known trade-off (intentional)

`surfaceNormalNode` finite-differences the *procedural* displacement
(undulate / displace / relief-wave). The baked per-tile relief (`positionLocal.z`)
is constant under that finite difference, so at high `mat_relief` the static
relief shades flatter than the old face normal showed. Fold in the relief's
geometric normal only if that becomes a problem.
