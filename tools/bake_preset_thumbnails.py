#!/usr/bin/env python3
"""Bake material-preset thumbnails as PNG drawables.

Mirrors `MaterialPreset.kt`'s `bundle()` calls (six built-in presets) and
renders each one to a 192×192 RGBA PNG of a beveled circular tile chip,
lit by the preset's own key + fill + ambient rig. The BRDF here is a
stripped port of `fill.frag` — Lambert + GGX (anisotropic when relevant)
+ Charlie sheen + clearcoat + a thin-film-ish iridescence + emissive —
not pixel-identical to the on-device render but using the same lobes so
each preset's character (matte vs glossy, metallic, pearly, oil-slick…)
reads in the picker.

Outputs:  android/app/src/main/res/drawable/preset_<name>.png
Run:      python3 tools/bake_preset_thumbnails.py
Re-run only when MaterialPreset.kt's values change; the PNGs are
committed as static assets.
"""

import math
from pathlib import Path

import numpy as np
from PIL import Image

# -----------------------------------------------------------------------------
# Presets — MUST mirror MaterialPreset.kt::bundle(). Stored here in float form
# (sliders / 100 where applicable). Order of fields matches that file's named
# arguments: roughness, metalness, iridescence, sheen, clearcoat, anisotropy,
# emissive, relief, then lighting: angle (deg), elevation (deg), intensity,
# warmth, ambient.
# -----------------------------------------------------------------------------
PRESETS = [
    # name,                rough metal  irid sheen coat aniso emis relief  ang elev int  warm amb
    ("preset_matte",         0.85, 0.00, 0.00, 0.20, 0.00, 0.00, 0.30, 0.90, 230, 55, 1.00, 0.55, 0.30),
    ("preset_ceramic",       0.35, 0.00, 0.05, 0.25, 0.60, 0.00, 0.35, 1.10, 230, 60, 1.10, 0.52, 0.22),
    ("preset_pearl",         0.30, 0.20, 0.90, 0.60, 0.50, 0.00, 0.40, 1.00, 220, 55, 1.00, 0.45, 0.25),
    ("preset_brushed_metal", 0.45, 0.95, 0.10, 0.10, 0.10, 0.90, 0.25, 1.05, 235, 50, 1.20, 0.50, 0.15),
    ("preset_lacquer",       0.15, 0.10, 0.20, 0.15, 1.00, 0.00, 0.45, 1.15, 225, 62, 1.15, 0.60, 0.18),
    ("preset_oil_slick",     0.25, 0.60, 1.00, 0.40, 0.70, 0.30, 0.70, 1.00, 240, 48, 1.10, 0.50, 0.20),
]

W, H = 192, 192
CHIP_R = 80          # chip radius (pixels)
BEVEL_R = 24         # bevel falloff distance (pixels) at the chip edge
ALPHA_AA = 1.5       # antialiased edge width (pixels)

# Neutral warm-grey albedo. The on-device renderer pulls albedo from the
# palette; a fixed colour here keeps every thumbnail comparable and lets the
# material parameters tell the story instead of a palette choice.
ALBEDO = np.array([0.58, 0.55, 0.50], dtype=np.float32)

# Background fills the corners outside the chip — dark so the chip pops.
BG = np.array([0.07, 0.08, 0.10], dtype=np.float32)


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
    """Per-pixel shading normal for a hemispherical preview chip.

    Beveled-tile previews dump 80 % of the chip onto a flat plateau where
    every pixel has N = (0,0,1) and the same highlight, so material
    differences read only along a thin chamfer ring. A hemisphere instead
    varies N continuously from (0,0,1) at the centre to nearly horizontal
    at the rim — every preset's highlight paints across the whole disc.
    `relief` scales the x/y tilt so high-relief presets read as a steeper
    dome and matte presets read flatter, matching the on-device bevel cue.
    """
    y_idx, x_idx = np.mgrid[0:H, 0:W].astype(np.float32)
    dx = (x_idx - W * 0.5) / CHIP_R
    dy = (y_idx - H * 0.5) / CHIP_R
    r2 = dx * dx + dy * dy
    z = np.sqrt(np.clip(1.0 - r2, 0.0, 1.0))
    Nx = dx * relief
    Ny = dy * relief
    Nz = z
    n_len = np.sqrt(Nx * Nx + Ny * Ny + Nz * Nz) + 1e-7
    N = np.stack([Nx / n_len, Ny / n_len, Nz / n_len], axis=-1)
    # r in pixels — used by the AA band at the chip edge and by the
    # centred emissive bump.
    return N, np.sqrt(r2) * CHIP_R


def shade_light(N, V, L, light_color, intensity,
                roughness, metalness, anisotropy,
                sheen, sheen_rough, sheen_color,
                clearcoat, coat_rough,
                iridescence, irid_color, F0):
    """Single-light response. Vectorised over the (H, W, _) image."""
    NdotL = np.clip(np.einsum("...i,i->...", N, L), 0.0, 1.0)
    Hh = L + V
    Hh = Hh / np.linalg.norm(Hh)
    NdotH = np.clip(np.einsum("...i,i->...", N, Hh), 0.0, 1.0)
    NdotV = max(float(V[2]), 1e-4)
    VdotH = float(np.clip(np.dot(V, Hh), 0.0, 1.0))

    a = roughness * roughness

    # Base specular — anisotropic GGX when aniso != 0, isotropic otherwise.
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

    # Smith G (height-correlated approximation good enough for previews).
    k = a * 0.5
    Gv = NdotV / (NdotV * (1 - k) + k + 1e-7)
    Gl = NdotL / (NdotL * (1 - k) + k + 1e-7)
    G = Gv * Gl

    # Fresnel — Schlick, blended with the iridescent colour.
    F_schlick = F0 + (1.0 - F0) * ((1.0 - VdotH) ** 5)
    F = F_schlick * (1.0 - iridescence) + irid_color * iridescence

    spec = (D * G)[..., None] * F * NdotL[..., None] \
           / (4.0 * NdotV * NdotL[..., None] + 1e-4)

    diffuse = ALBEDO * (1.0 - metalness) * NdotL[..., None]

    # Charlie sheen — peaks at grazing.
    sin2h = np.clip(1.0 - NdotH * NdotH, 1e-7, 1.0)
    inv_sa = 1.0 / max(sheen_rough * sheen_rough, 1e-4)
    sheenD = (2.0 + inv_sa) * (sin2h ** (inv_sa * 0.5)) / (2.0 * math.pi)
    sheen_term = sheen_color * (sheen * sheenD * NdotL)[..., None]

    # Clearcoat — second tight GGX at dielectric F0 0.04.
    coat_a = coat_rough * coat_rough
    coat_a2 = coat_a * coat_a
    coat_d = coat_a2 / (math.pi * (NdotH * NdotH * (coat_a2 - 1.0) + 1.0) ** 2 + 1e-7)
    coat_F = 0.04 + 0.96 * ((1.0 - VdotH) ** 5)
    coat_lobe = clearcoat * coat_d * coat_F * NdotL / (4.0 * NdotV * NdotL + 1e-4)
    coat_atten = 1.0 - clearcoat * coat_F

    return ((diffuse + spec + sheen_term) * coat_atten + coat_lobe[..., None]) \
           * light_color * intensity


def iridescent_color(N, V):
    """Rainbow tint that shifts with the view-to-normal angle — the cheap
    stand-in for the Belcour & Barla film here, picking up the same
    intuition: a colour-shifting reflectance keyed off the geometry."""
    NdotV = np.clip(np.einsum("...i,i->...", N, V), 0.0, 1.0)
    # Shift the wave so high iridescence presets show several colour bands
    # rather than just one tint.
    phase = (1.0 - NdotV) * 8.0
    r = 0.5 + 0.5 * np.cos(phase)
    g = 0.5 + 0.5 * np.cos(phase + 2.094)  # 2π/3
    b = 0.5 + 0.5 * np.cos(phase + 4.189)  # 4π/3
    return np.stack([r, g, b], axis=-1).astype(np.float32)


def render_preset(p):
    (roughness, metalness, iridescence, sheen, clearcoat, anisotropy,
     emissive, relief, angle_deg, elev_deg, intensity, warmth, ambient) = p

    (key_dir, key_color, key_int,
     fill_dir, fill_color, fill_int,
     ambient_color) = apply_light_controls(angle_deg, elev_deg, intensity,
                                           warmth, ambient)

    N, r = chip_normal(relief)
    V = np.array([0.0, 0.0, 1.0], dtype=np.float32)

    # F0: dielectric 0.04 for non-metals; a slightly-warm silver for full
    # metalness so high-metalness presets read as bright reflective metal
    # rather than tinted gray (the on-device path uses palette colour as
    # metal F0, which we do not have for a context-free preview).
    METAL_F0 = np.array([0.95, 0.93, 0.88], dtype=np.float32)
    F0 = (1.0 - metalness) * 0.04 + METAL_F0 * metalness
    sheen_color = np.array([1.0, 0.97, 0.92], dtype=np.float32)
    irid_color = iridescent_color(N, V) if iridescence > 1e-3 else np.zeros(
        (H, W, 3), dtype=np.float32)

    key = shade_light(N, V, key_dir, key_color, key_int,
                      roughness, metalness, anisotropy,
                      sheen, sheen_rough=0.30, sheen_color=sheen_color,
                      clearcoat=clearcoat, coat_rough=0.10,
                      iridescence=iridescence, irid_color=irid_color, F0=F0)
    fill = shade_light(N, V, fill_dir, fill_color, fill_int,
                       roughness, metalness, anisotropy,
                       sheen, sheen_rough=0.30, sheen_color=sheen_color,
                       clearcoat=clearcoat, coat_rough=0.10,
                       iridescence=iridescence, irid_color=irid_color, F0=F0)

    ambient_term = ALBEDO * ambient_color
    # Emissive — a soft glow modulated by a centred bump so it reads as a
    # crest rather than a flat fill.
    centre_bump = np.clip(1.0 - r / CHIP_R, 0.0, 1.0)
    emissive_term = ALBEDO * (emissive * 0.4 * centre_bump)[..., None]

    color = ambient_term + key + fill + emissive_term
    color = np.clip(color, 0.0, 1.0)

    # Compose with the dark background, with an AA band at the chip edge.
    alpha_chip = np.clip((CHIP_R + 0.5 - r) / ALPHA_AA, 0.0, 1.0)
    color = color * alpha_chip[..., None] + BG * (1.0 - alpha_chip[..., None])

    rgba = np.zeros((H, W, 4), dtype=np.uint8)
    rgba[..., :3] = np.clip(color * 255.0, 0, 255).astype(np.uint8)
    rgba[..., 3] = 255
    return rgba


def main():
    out = Path(__file__).resolve().parent.parent / "android/app/src/main/res/drawable"
    out.mkdir(parents=True, exist_ok=True)
    for name, *p in PRESETS:
        img = render_preset(tuple(p))
        Image.fromarray(img, "RGBA").save(out / f"{name}.png")
        print(f"baked {out / (name + '.png')}")


if __name__ == "__main__":
    main()
