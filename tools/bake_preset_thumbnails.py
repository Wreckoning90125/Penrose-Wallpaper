#!/usr/bin/env python3
"""Bake material-preset thumbnails as PNG drawables.

Mirrors `MaterialPreset.kt`'s `bundle()` calls (six built-in presets) and
renders each one to a 192×192 RGBA PNG of a hemispherical material chip,
lit by the preset's own key + fill + ambient rig. The BRDF here is a
stripped port of `fill.frag` — Lambert + GGX (anisotropic when relevant)
+ Charlie sheen + clearcoat + a thin-film iridescence palette + emissive
— plus a fake environment-reflection term so metals show their F0 tint
across the surface instead of only at a small highlight.

Each preset declares its own characteristic colours: a tinted bake
albedo (preview only — on-device, albedo comes from the palette), a
sheen tint, and an iridescence-stop palette. The sheen tint and the
thin-film thickness range are also written into MaterialParams on the
on-device side so the live wallpaper picks up the same character.

Outputs:  android/app/src/main/res/drawable/preset_<name>.png
Run:      python3 tools/bake_preset_thumbnails.py
Re-run only when MaterialPreset.kt's values change; the PNGs are
committed as static assets.
"""

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np
from PIL import Image

RGB = Tuple[float, float, float]


@dataclass
class Preset:
    """One row of the preset table. Material + lighting fields mirror
    MaterialPreset.kt::bundle() (sliders / 100 where applicable); the
    last three are preview / on-device colour overrides."""
    file: str
    # MaterialParams sliders (the eight + the lighting five).
    roughness: float; metalness: float; iridescence: float; sheen: float
    clearcoat: float; anisotropy: float; emissive: float; relief: float
    angle: float; elevation: float; intensity: float; warmth: float; ambient: float
    # Bake-only neutral tint so thumbnails are visually distinct; the
    # on-device renderer takes albedo from the palette and ignores this.
    bake_albedo: RGB
    # On-device + thumbnail: characteristic sheen colour for this preset.
    sheen_color: RGB
    # Thin-film thickness range (nm) that produces the iridescence colour
    # via the Belcour & Barla math on-device. The thumbnail uses
    # `irid_palette` directly (Belcour is too heavy to port for a static
    # preview); these stops are chosen to match the band that thickness
    # range produces on-device, so picker and wallpaper agree.
    irid_thick_min: float
    irid_thick_max: float
    irid_palette: Optional[List[RGB]] = None


PRESETS: List[Preset] = [
    # Matte — flat, no spec, dim diffuse. Warm gray.
    Preset(
        "preset_matte", 0.85, 0.00, 0.00, 0.20, 0.00, 0.00, 0.30, 0.90,
        230, 55, 1.00, 0.55, 0.30,
        bake_albedo=(0.58, 0.55, 0.50),
        sheen_color=(1.00, 0.97, 0.92),
        irid_thick_min=280.0, irid_thick_max=560.0,
    ),
    # Ceramic — glossy clearcoat, neutral cream.
    Preset(
        "preset_ceramic", 0.35, 0.00, 0.05, 0.25, 0.60, 0.00, 0.35, 1.10,
        230, 60, 1.10, 0.52, 0.22,
        bake_albedo=(0.85, 0.81, 0.74),
        sheen_color=(1.00, 0.96, 0.90),
        irid_thick_min=280.0, irid_thick_max=560.0,
    ),
    # Pearl — cool opal: teal/violet iridescence over a near-white base.
    # Thin film (250–400 nm) gives the teal→violet band; the palette
    # below matches that band so the thumbnail and the on-device film
    # agree on the character.
    Preset(
        "preset_pearl", 0.30, 0.20, 0.90, 0.60, 0.50, 0.00, 0.40, 1.00,
        220, 55, 1.00, 0.45, 0.25,
        bake_albedo=(0.86, 0.88, 0.92),
        sheen_color=(0.96, 0.98, 1.00),
        irid_thick_min=250.0, irid_thick_max=400.0,
        irid_palette=[(0.92, 0.95, 0.98),   # white-blue
                      (0.55, 0.92, 0.88),   # teal
                      (0.78, 0.68, 0.95)],  # violet
    ),
    # Brushed metal — silvery aluminum-stainless mix; harder anisotropy
    # so the streak is unmistakeable, slightly tighter spec.
    Preset(
        "preset_brushed_metal", 0.40, 0.95, 0.10, 0.10, 0.10, 0.95, 0.25, 1.05,
        235, 50, 1.20, 0.50, 0.18,
        bake_albedo=(0.80, 0.80, 0.82),
        sheen_color=(1.00, 0.99, 0.95),
        irid_thick_min=280.0, irid_thick_max=560.0,
    ),
    # Lacquer — deep warm red with a glossy clearcoat highlight.
    Preset(
        "preset_lacquer", 0.15, 0.10, 0.20, 0.15, 1.00, 0.00, 0.45, 1.15,
        225, 62, 1.15, 0.60, 0.18,
        bake_albedo=(0.55, 0.15, 0.18),
        sheen_color=(1.00, 0.92, 0.82),
        irid_thick_min=320.0, irid_thick_max=520.0,
        irid_palette=[(0.85, 0.45, 0.30),
                      (0.75, 0.35, 0.55),
                      (0.45, 0.30, 0.65)],
    ),
    # Oil-slick — dark wet base with high-saturation Newton's-rings
    # cycling green→blue→violet→magenta→gold. Five stops + the angular
    # twist in iridescent_color() gives the swirling bands a real oil
    # film shows, not a tidy radial halo.
    Preset(
        "preset_oil_slick", 0.25, 0.60, 1.00, 0.40, 0.70, 0.30, 0.70, 1.00,
        240, 48, 1.10, 0.50, 0.20,
        bake_albedo=(0.10, 0.11, 0.13),
        sheen_color=(0.85, 0.95, 0.78),
        irid_thick_min=380.0, irid_thick_max=700.0,
        irid_palette=[(0.05, 0.85, 0.40),
                      (0.10, 0.45, 0.95),
                      (0.55, 0.15, 0.95),
                      (0.95, 0.20, 0.65),
                      (0.98, 0.70, 0.20)],
    ),
]


W, H = 192, 192
# Penrose fat-rhomb half-extents in normalised [-1, 1] coordinates.
# 72° at the top/bottom tips, 108° at the left/right tips — the
# classic fat rhomb (h_o = w_o * tan(36°)).
RHOMB_W = 0.78
RHOMB_H = RHOMB_W * math.tan(math.radians(36.0))
BEVEL_W = 0.18       # bevel chamfer width in normalised units
INSCRIBED_R = (RHOMB_W * RHOMB_H) / math.sqrt(RHOMB_W * RHOMB_W + RHOMB_H * RHOMB_H)

BG = np.array([0.07, 0.08, 0.10], dtype=np.float32)
SHEEN_ROUGH = 0.30   # MaterialParams default; not slider-backed today
COAT_ROUGH = 0.10    # MaterialParams default; not slider-backed today

# A slightly-warm silver F0 for full metalness; on-device, F0 is mixed
# from the palette colour with metalness as the weight (see fill.frag),
# but the thumbnail has no palette so a generic metallic F0 is used.
METAL_F0 = np.array([0.95, 0.93, 0.88], dtype=np.float32)


def apply_light_controls(angle_deg, elev_deg, intensity, warmth, ambient):
    """Mirror renderer/render_state.h::applyLightControls."""
    az = math.radians(angle_deg)
    el = math.radians(elev_deg)
    ce, se = math.cos(el), math.sin(el)
    key_dir = np.array([ce * math.cos(az), ce * math.sin(az), se], dtype=np.float32)
    az2, el2 = az + math.pi, el * 0.5
    ce2 = math.cos(el2)
    fill_dir = np.array(
        [ce2 * math.cos(az2), ce2 * math.sin(az2), math.sin(el2)], dtype=np.float32
    )
    w = (warmth - 0.5) * 2.0
    key_color = np.array([1.0, 0.98 - 0.05 * w, 0.96 - 0.13 * w], dtype=np.float32)
    fill_color = np.array([0.86 - 0.06 * w, 0.91 - 0.01 * w, 1.0], dtype=np.float32)
    ambient_color = np.array([0.90, 0.93, 1.00], dtype=np.float32) * ambient
    return (
        key_dir, key_color, intensity * 0.76,
        fill_dir, fill_color, intensity * 0.27,
        ambient_color,
    )


def chip_normal(relief):
    """Per-pixel shading normal for a Penrose fat-rhomb preview chip.

    Earlier previews used a hemisphere — easy to read but unrelated to
    the actual wallpaper, which renders beveled tiles. The rhomb shape
    + cosine chamfer normal matches what fill.frag does on-device, so
    the picker preview reads as a tile sample with that material, not
    a generic material ball. `relief` scales the chamfer tilt the same
    way bevelStrength does on-device.

    Returns (N, px, py, inward) — the shading normal, normalised pixel
    coords (math convention, y-up), and the signed distance from the
    rhomb boundary (positive inside; used for AA + the emissive bump).
    """
    y_idx, x_idx = np.mgrid[0:H, 0:W].astype(np.float32)
    # Math-convention coords, normalised to [-1, 1] with y up so the
    # light azimuth from applyLightControls (which uses math angles)
    # lands where it visually should on the chip.
    px = (x_idx - W * 0.5) / (W * 0.5)
    py = -(y_idx - H * 0.5) / (H * 0.5)

    # CCW vertex ring (math coords): right tip, top, left tip, bottom.
    verts = [( RHOMB_W,        0.0),
             (     0.0,  RHOMB_H),
             (-RHOMB_W,        0.0),
             (     0.0, -RHOMB_H)]
    edge_n = []
    edge_d = []
    for i in range(4):
        a = verts[i]
        b = verts[(i + 1) % 4]
        tx, ty = b[0] - a[0], b[1] - a[1]
        nx, ny = -ty, tx                                 # rotate tangent 90° CCW
        nlen = math.sqrt(nx * nx + ny * ny)
        nx /= nlen; ny /= nlen
        edge_n.append((nx, ny))
        edge_d.append(-(nx * a[0] + ny * a[1]))

    edge_dists = np.stack(
        [n[0] * px + n[1] * py + d for n, d in zip(edge_n, edge_d)],
        axis=-1,
    )
    inward  = edge_dists.min(axis=-1)                    # >0 inside, <0 outside
    nearest = edge_dists.argmin(axis=-1)

    edge_clamp = np.clip(inward, 0.0, BEVEL_W)
    tilt = np.cos(edge_clamp / BEVEL_W * (math.pi * 0.5)) * relief

    norms = np.array(edge_n, dtype=np.float32)           # (4, 2)
    Nx = -norms[nearest, 0] * tilt                       # outward chamfer tilt
    Ny = -norms[nearest, 1] * tilt
    Nz = np.ones_like(Nx)
    n_len = np.sqrt(Nx * Nx + Ny * Ny + Nz * Nz) + 1e-7
    N = np.stack([Nx / n_len, Ny / n_len, Nz / n_len], axis=-1)
    return N, px, py, inward


def iridescent_color(N, V, px, py, palette):
    """Per-preset iridescence: cyclic interpolation between palette
    stops, with a radial component (NdotV — strongest at the bevel rim
    where the normal points outward) and an angular twist keyed off
    PIXEL position rather than the normal. Stands in for the Belcour &
    Barla thin-film evaluation the on-device shader does — too heavy
    to port for a static preview, so each preset declares the colour
    band its thickness range produces and the thumbnail interpolates
    it directly.

    The angular component uses pixel position because the rhomb's
    plateau has N = (0, 0, 1) and atan2(Ny, Nx) collapses to 0 there;
    using atan2(py, px) gives the iridescence a visible swirl across
    the whole tile (especially needed for the Oil-slick).
    """
    if palette is None:
        return None
    NdotV = np.clip(np.einsum("...i,i->...", N, V), 0.0, 1.0)
    radial  = (1.0 - NdotV) * len(palette)
    angular = np.arctan2(py, px) * len(palette) / (2.0 * math.pi)
    phase   = radial + angular * 0.9
    seg = np.floor(phase).astype(int) % len(palette)
    nxt = (seg + 1) % len(palette)
    t = (phase - np.floor(phase))[..., None]
    stops = np.array(palette, dtype=np.float32)
    return stops[seg] * (1.0 - t) + stops[nxt] * t


def shade_light(N, V, L, light_color, intensity,
                roughness, metalness, anisotropy,
                sheen, sheen_color,
                clearcoat,
                iridescence, irid_color, F0, albedo):
    """Single-light response, vectorised over the (H, W, _) image."""
    NdotL = np.clip(np.einsum("...i,i->...", N, L), 0.0, 1.0)
    Hh = L + V
    Hh = Hh / np.linalg.norm(Hh)
    NdotH = np.clip(np.einsum("...i,i->...", N, Hh), 0.0, 1.0)
    NdotV = max(float(V[2]), 1e-4)
    VdotH = float(np.clip(np.dot(V, Hh), 0.0, 1.0))

    a = roughness * roughness
    if anisotropy > 1e-3:
        at = max(a * (1.0 + anisotropy), 1e-4)
        ab = max(a * (1.0 - anisotropy), 1e-4)
        a2 = at * ab
        TdotH = Hh[0]; BdotH = Hh[1]
        f = np.stack([np.full_like(NdotH, ab * TdotH),
                      np.full_like(NdotH, at * BdotH),
                      a2 * NdotH], axis=-1)
        denom = np.sum(f * f, axis=-1) + 1e-7
        D = a2 * (a2 * a2) / (denom * denom * math.pi)
    else:
        a2 = a * a
        d = NdotH * NdotH * (a2 - 1.0) + 1.0
        D = a2 / (math.pi * d * d + 1e-7)

    k = a * 0.5
    Gv = NdotV / (NdotV * (1 - k) + k + 1e-7)
    Gl = NdotL / (NdotL * (1 - k) + k + 1e-7)
    G = Gv * Gl

    F_schlick = F0 + (1.0 - F0) * ((1.0 - VdotH) ** 5)
    if irid_color is not None:
        F = F_schlick * (1.0 - iridescence) + irid_color * iridescence
    else:
        F = np.broadcast_to(F_schlick, NdotH.shape + (3,))

    spec = (D * G)[..., None] * F * NdotL[..., None] \
           / (4.0 * NdotV * NdotL[..., None] + 1e-4)

    diffuse = albedo * (1.0 - metalness) * NdotL[..., None]

    sin2h = np.clip(1.0 - NdotH * NdotH, 1e-7, 1.0)
    inv_sa = 1.0 / max(SHEEN_ROUGH * SHEEN_ROUGH, 1e-4)
    sheenD = (2.0 + inv_sa) * (sin2h ** (inv_sa * 0.5)) / (2.0 * math.pi)
    sheen_term = np.array(sheen_color, dtype=np.float32) * (sheen * sheenD * NdotL)[..., None]

    coat_a = COAT_ROUGH * COAT_ROUGH
    coat_a2 = coat_a * coat_a
    coat_d = coat_a2 / (math.pi * (NdotH * NdotH * (coat_a2 - 1.0) + 1.0) ** 2 + 1e-7)
    coat_F = 0.04 + 0.96 * ((1.0 - VdotH) ** 5)
    coat_lobe = clearcoat * coat_d * coat_F * NdotL / (4.0 * NdotV * NdotL + 1e-4)
    coat_atten = 1.0 - clearcoat * coat_F

    return ((diffuse + spec + sheen_term) * coat_atten + coat_lobe[..., None]) \
           * light_color * intensity


def fake_environment(N, V, F0, roughness):
    """Cheap image-based-lighting stand-in: a fixed studio sky
    reflected with the surface Fresnel. Independent of the preset's
    ambient level on purpose — real metals pick up a bright environment
    wash regardless of how dim the rest of the lighting is, so scaling
    by preset ambient (which can be very low) made high-F0 surfaces
    look black instead of metallic."""
    NdotV = np.clip(np.einsum("...i,i->...", N, V), 0.0, 1.0)[..., None]
    f = F0 + (1.0 - F0) * ((1.0 - NdotV) ** 5)
    sky = np.array([0.55, 0.55, 0.60], dtype=np.float32)
    return sky * f * (1.0 - roughness * 0.5)


def render_preset(p: Preset):
    (key_dir, key_color, key_int,
     fill_dir, fill_color, fill_int,
     ambient_color) = apply_light_controls(p.angle, p.elevation, p.intensity,
                                           p.warmth, p.ambient)

    N, px, py, inward = chip_normal(p.relief)
    V = np.array([0.0, 0.0, 1.0], dtype=np.float32)
    albedo = np.array(p.bake_albedo, dtype=np.float32)
    F0 = (1.0 - p.metalness) * 0.04 + METAL_F0 * p.metalness

    irid_color = (iridescent_color(N, V, px, py, p.irid_palette)
                  if p.iridescence > 1e-3 else None)

    key = shade_light(N, V, key_dir, key_color, key_int,
                      p.roughness, p.metalness, p.anisotropy,
                      p.sheen, p.sheen_color,
                      p.clearcoat,
                      p.iridescence, irid_color, F0, albedo)
    fill = shade_light(N, V, fill_dir, fill_color, fill_int,
                       p.roughness, p.metalness, p.anisotropy,
                       p.sheen, p.sheen_color,
                       p.clearcoat,
                       p.iridescence, irid_color, F0, albedo)
    env = fake_environment(N, V, F0, p.roughness)

    ambient_term = albedo * ambient_color
    # Plateau-strongest emissive bump that fades into the bevel rim,
    # so a high-emissive preset reads as glowing-from-the-inside on
    # the rhomb rather than a uniform wash.
    centre_bump = np.clip(inward / INSCRIBED_R, 0.0, 1.0)
    emissive_term = albedo * (p.emissive * 0.4 * centre_bump)[..., None]

    color = ambient_term + key + fill + env + emissive_term
    color = np.clip(color, 0.0, 1.0)

    # Antialiased rhomb boundary — inward goes negative outside the
    # rhomb; clipping (inward * pixels-per-unit) to a 1-pixel band
    # gives a clean edge on the dark background.
    alpha_chip = np.clip(inward * (W * 0.5), 0.0, 1.0)
    color = color * alpha_chip[..., None] + BG * (1.0 - alpha_chip[..., None])

    rgba = np.zeros((H, W, 4), dtype=np.uint8)
    rgba[..., :3] = np.clip(color * 255.0, 0, 255).astype(np.uint8)
    rgba[..., 3] = 255
    return rgba


def main():
    out = Path(__file__).resolve().parent.parent / "android/app/src/main/res/drawable"
    out.mkdir(parents=True, exist_ok=True)
    for p in PRESETS:
        Image.fromarray(render_preset(p), "RGBA").save(out / f"{p.file}.png")
        print(f"baked {out / (p.file + '.png')}")


if __name__ == "__main__":
    main()
