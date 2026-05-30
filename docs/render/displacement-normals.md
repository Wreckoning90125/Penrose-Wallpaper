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

That is the **face normal of the rasterized triangle** — one constant value per
triangle. So `normalFlat` does not shade the *surface*, it shades the **mesh**:
every triangle is lit as a flat plate. And our mesh *is* the subdivided relief
tiles. So the facets that "looked like relief reappearing" were not an artifact —
they were the relief-tile polygons themselves, lit up. When the surface is flat,
those polygons are coplanar and you can't see them. Displace it (undulate) and
each polygon tilts to its own orientation, so the tile mesh we built becomes
visible. That's the whole bug: we shaded the geometry we made instead of the
surface it represents.

## Why it looked frequency-dependent

Frequency doesn't create or hide facets — it just sets how far apart neighbouring
tile-polygons tilt. A gentle (low-frequency) undulation tilts adjacent polygons by
nearly the same amount, so their face normals are nearly equal and the mesh stays
invisible (it reads as smooth paper). A tight (high-frequency) undulation tilts
neighbours apart, so the relief-tile mesh shows. Subdividing further is the same
masking from the other side (more, smaller polygons tilt less relative to each
other). Both are workarounds; neither touches the cause, which is that the shading
normal is the polygon, not the surface. The tell was empirical and immediate: the
*same* geometry was smooth paper at low frequency and faceted at high frequency —
so the geometry isn't the cause, the normal is.

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
