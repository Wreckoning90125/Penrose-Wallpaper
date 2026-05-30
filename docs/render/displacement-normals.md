# Displacement shading: smoothness is the NORMAL, not the geometry

## The rule

When a displaced surface "looks like relief / facets / bumps" and you expected a
smooth bend, **check the normal computation first.** Shading smoothness is a
property of the surface normal, not of polygon count or wave frequency.

- `normalFlat` (three's default flat normal) is the **polygon face normal**:
  `positionView.dFdx().cross(positionView.dFdy())`. It is constant across a
  triangle, so **any** displacement on low‑poly geometry shades faceted — at
  every frequency. Subdividing only hides it by adding faces.
- The fix is to derive the normal **analytically from the displacement function**
  (finite‑difference the displacement, transform to view). Then a flat, low‑poly
  sheet shades as a smooth undulation at any frequency and any tessellation, with
  no subdivision. See `surfaceNormalNode` in `web/src/render/webgpuRenderer.ts`.

Undulating a flat sheet is a **1‑D plane wave displacing z (up)** — `sin(x·f +
y·0.73f)`. It is a smooth surface and does not inherently facet. Frequency sets
the *scale* of the bend; it does **not** determine whether it facets. The
facets came entirely from face‑normal shading.

## The misconception (why this cost ~3 hours)

A flat atlas undulated and "relief reappeared" even with all relief set to zero.
The wrong diagnosis, repeated and doubled‑down on:

1. "High wave frequency creates faceted relief." — False. A sine z‑displacement
   is a smooth surface at any frequency.
2. "It's the low‑poly flat‑quad tiles faceting when displaced." — Also not the
   root cause: at a low decoupled frequency the *same* geometry undulated as
   smooth flat paper. Same polys, different result → geometry density was not the
   determinant.
3. Lowering the frequency / increasing fill subdivision "fixed" it — both are
   workarounds that mask the real cause (subdivision adds faces so each face
   normal turns less; low frequency makes adjacent faces turn similarly).

The actual cause was that the material used `normalFlat`, so the shading normal
was the polygon face the whole time. None of frequency, amplitude, or poly count
was the root cause.

## The process lesson (do not repeat)

- The user is the pixel oracle; this agent renders black (swiftshader). When the
  user — a domain expert — says "that is not the cause," **stop theorizing and go
  read the actual code path** (here: the `normalNode`). Do not restate a theory
  more confidently to win the argument; that is gaslighting and it wasted hours.
- For any "looks wrong" displacement/shading bug, enumerate the real inputs
  (position node, **normal node**, lighting) and inspect them before blaming
  frequency, amplitude, or tessellation.
- Empirical contradictions (same geometry, two outcomes) falsify a hypothesis —
  honour them immediately instead of explaining them away.

## Current trade‑off (known, intentional)

`surfaceNormalNode` finite‑differences the *procedural* displacement
(undulate / displace / relief‑wave). The baked per‑tile relief (`positionLocal.z`)
is constant under that finite difference, so at high `mat_relief` the static
relief shades flatter than the old face normal showed. Revisit (fold in the
relief's geometric normal) only if that becomes a problem.
