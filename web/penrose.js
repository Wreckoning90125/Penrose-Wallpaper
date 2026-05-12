(() => {
  'use strict';

  // ===================================================================
  // Penrose deflations — P3 (rhombi) and P2 (kites & darts)
  // -------------------------------------------------------------------
  // Both tilings use the same two Robinson triangles:
  //   L = obtuse golden gnomon (108-36-36), sides 1:1:phi (legs:legs:base)
  //   S = acute golden triangle (36-72-72), sides 1:1:psi (legs:legs:base)
  // The convention for each triangle is (A, B, C) where B is the apex
  // (angle 108 for L, 36 for S) and A-C is the base. The legs are A-B and
  // B-C; both have length 1. The base has length phi for L, psi for S.
  //
  // P3 (rhombi) substitution rules (matrix [[1,1],[1,2]]):
  //   acute (S) → 1 acute + 1 obtuse
  //   obtuse (L) → 2 obtuse + 1 acute
  // Internal seams: two same-type triangles share their BASE to form a rhomb.
  //
  // P2 (kites & darts) substitution rules (matrix [[2,1],[1,1]]):
  //   acute (S) → 2 acute + 1 obtuse
  //   obtuse (L) → 1 acute + 1 obtuse
  // Internal seams: two same-type triangles share a LEG to form a kite (S+S)
  // or dart (L+L). Geometry derived from the P2 inflation factor phi and
  // verified via Python rendering against canonical Penrose patches.
  // ===================================================================
  // ===================================================================
  // Tile data model
  // -------------------------------------------------------------------
  // Every tile is { type, verts } where verts is a flat array of point
  // objects {x, y}. For triangles (P3, P2) verts.length === 3; for chair
  // L-trominoes verts.length === 6. Each family also supplies an edges(t)
  // function returning [{p1, p2, kind}, ...] for border rendering, where
  // 'kind' is family-specific metadata used by the seam-hiding rule.
  //
  // Penrose helpers: in the Robinson-triangle convention, verts = [A, B, C]
  // with B = apex (108° for L, 36° for S) and A-C = base. A-B and B-C are
  // legs (length 1); A-C is the base (length phi for L, psi for S).
  // ===================================================================
  const PHI = (1 + Math.sqrt(5)) / 2;
  const psi = 1 / PHI;
  const psi2 = psi * psi;
  const V = (x, y) => ({ x, y });
  const comb = (a, A, b, B) => ({ x: a*A.x + b*B.x, y: a*A.y + b*B.y });

  // Convenience: build a Robinson triangle in the new representation.
  const Tri = (type, A, B, C) => ({ type, verts: [A, B, C] });

  function subdivideP3(tiles) {
    const out = [];
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      const A = t.verts[0], B = t.verts[1], C = t.verts[2];
      if (t.type === 'L') {
        const D = comb(psi2, A, psi, C);
        const E = comb(psi2, A, psi, B);
        out.push(Tri('L', D, E, A));
        out.push(Tri('S', E, D, B));
        out.push(Tri('L', C, D, B));
      } else {
        const D = comb(psi, A, psi2, B);
        out.push(Tri('S', D, C, A));
        out.push(Tri('L', C, D, B));
      }
    }
    return out;
  }

  function subdivideP2(tiles) {
    const out = [];
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      const A = t.verts[0], B = t.verts[1], C = t.verts[2];
      if (t.type === 'S') {
        // S → 2S + 1L. D on AB at AD = psi*|AB|, E on BC at BE = psi*|BC|.
        const D = comb(1 - psi, A, psi, B);
        const E = comb(1 - psi, B, psi, C);
        out.push(Tri('S', D, A, E));
        out.push(Tri('S', E, A, C));
        out.push(Tri('L', B, D, E));
      } else {
        // L → 1S + 1L. F on AC at AF = (1/phi)*|AC|.
        const F = comb(1 - psi, A, psi, C);
        out.push(Tri('S', B, A, F));
        out.push(Tri('L', B, F, C));
      }
    }
    return out;
  }

  // Edge classification for Penrose tiles (shared by P2 and P3).
  // Returns [{p1, p2, kind}] where kind is 'leg' or 'base'.
  function penroseEdges(t) {
    const A = t.verts[0], B = t.verts[1], C = t.verts[2];
    return [
      { p1: A, p2: B, kind: 'leg' },
      { p1: B, p2: C, kind: 'leg' },
      { p1: A, p2: C, kind: 'base' },
    ];
  }

  // -------------------------------------------------------------------
  // Chair tiling — L-tromino rep-tile. Each L subdivides into 4 smaller
  // L's at scale 1/2, with the 4 children at orientations 0, 3, 0, 1.
  // -------------------------------------------------------------------
  // Canonical L vertices at orient 0, scale 1 (CCW):
  //   v0=(0,0), v1=(2,0), v2=(2,1), v3=(1,1), v4=(1,2), v5=(0,2)
  // Tiles are stored as {type: 'L0'|'L1'|'L2'|'L3', verts: [...]} where the
  // type encodes the orientation (0..3) for type-mode coloring.
  // -------------------------------------------------------------------
  const L_VERTS_CANONICAL = [
    { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 },
    { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 },
  ];

  function rotInt(p, k) {
    // Rotate p by k * 90° CCW.
    k = ((k % 4) + 4) % 4;
    if (k === 0) return { x: p.x,  y: p.y  };
    if (k === 1) return { x: -p.y, y: p.x  };
    if (k === 2) return { x: -p.x, y: -p.y };
    return                { x: p.y,  y: -p.x };
  }

  // Build an L-tromino in world space from (origin, orient, scale).
  function chairTile(origin, orient, scale) {
    const verts = new Array(6);
    for (let i = 0; i < 6; i++) {
      const r = rotInt(L_VERTS_CANONICAL[i], orient);
      verts[i] = { x: origin.x + scale * r.x, y: origin.y + scale * r.y };
    }
    return { type: 'L' + orient, _origin: origin, _orient: orient, _scale: scale, verts };
  }

  // Chair substitution: each L → 4 L's at scale/2.
  // Child rules: (local_origin, orient_offset). Verified in Python.
  const CHAIR_RULES = [
    { lo: { x: 0,   y: 0   }, oo: 0 },
    { lo: { x: 0,   y: 2   }, oo: 3 },
    { lo: { x: 0.5, y: 0.5 }, oo: 0 },
    { lo: { x: 2,   y: 0   }, oo: 1 },
  ];

  function subdivideChair(tiles) {
    const out = [];
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      const po = t._orient, ps = t._scale, pOrigin = t._origin;
      const cs = ps * 0.5;
      for (let r = 0; r < 4; r++) {
        const rule = CHAIR_RULES[r];
        const rotated = rotInt(rule.lo, po);
        const co = { x: pOrigin.x + ps * rotated.x, y: pOrigin.y + ps * rotated.y };
        const corient = ((rule.oo + po) % 4 + 4) % 4;
        out.push(chairTile(co, corient, cs));
      }
    }
    return out;
  }

  // Chair edges: just the 6 sides of the L-tromino, no kind distinction.
  function chairEdges(t) {
    const v = t.verts;
    return [
      { p1: v[0], p2: v[1], kind: 'edge' },
      { p1: v[1], p2: v[2], kind: 'edge' },
      { p1: v[2], p2: v[3], kind: 'edge' },
      { p1: v[3], p2: v[4], kind: 'edge' },
      { p1: v[4], p2: v[5], kind: 'edge' },
      { p1: v[5], p2: v[0], kind: 'edge' },
    ];
  }
  // -------------------------------------------------------------------
  // P3 seeds — symmetric starting configurations built from L/S Robinson
  // triangles. Each seed is a small symmetric patch (~10-12 triangles)
  // around the origin which deflation expands into the full tiling.
  // -------------------------------------------------------------------

  // Sun: 10 S triangles around origin, apex at center (5-fold symmetric)
  function p3Sun() {
    const tris = [];
    for (let i = 0; i < 10; i++) {
      const a1 = (2*Math.PI*i)/10, a2 = (2*Math.PI*(i+1))/10;
      let A = V(Math.cos(a1), Math.sin(a1));
      let C = V(Math.cos(a2), Math.sin(a2));
      if (i % 2 === 0) { const t = A; A = C; C = t; }
      tris.push(Tri('S', A, V(0,0), C));
    }
    return tris;
  }
  // Star: 5 thick rhombi (each split into 2 L's) sharing a central vertex
  function p3Star() {
    const tris = [];
    for (let i = 0; i < 5; i++) {
      const ang1 = (2*Math.PI*i)/5, ang3 = ang1 + 72*Math.PI/180;
      const V1 = V(Math.cos(ang1), Math.sin(ang1));
      const V3 = V(Math.cos(ang3), Math.sin(ang3));
      const V2 = V(V1.x + V3.x, V1.y + V3.y);
      tris.push(Tri('L', V(0,0), V1, V2));
      tris.push(Tri('L', V(0,0), V3, V2));
    }
    return tris;
  }
  // Cartwheel: 10 S triangles with reflection symmetry rotated by π/10
  function p3Cartwheel() {
    const tris = [];
    for (let i = 0; i < 10; i++) {
      const a1 = (2*Math.PI*i)/10 + Math.PI/10, a2 = (2*Math.PI*(i+1))/10 + Math.PI/10;
      let A = V(Math.cos(a1), Math.sin(a1));
      let C = V(Math.cos(a2), Math.sin(a2));
      if (i % 2 === 1) { const t = A; A = C; C = t; }
      tris.push(Tri('S', A, V(0,0), C));
    }
    return tris;
  }
  // Ace: a single thick rhomb (2 L's) — asymmetric, organic-looking patches
  function p3Ace() {
    const tris = [];
    const ang1 = -36*Math.PI/180, ang3 = 36*Math.PI/180;
    const V1 = V(Math.cos(ang1), Math.sin(ang1));
    const V3 = V(Math.cos(ang3), Math.sin(ang3));
    const V2 = V(V1.x + V3.x, V1.y + V3.y);
    tris.push(Tri('L', V(0,0), V1, V2));
    tris.push(Tri('L', V(0,0), V3, V2));
    return tris;
  }

  // -------------------------------------------------------------------
  // P2 seeds — for kites & darts. P2 uses the SAME L/S triangles as P3,
  // but the substitution treats acute (S) as the larger prototile with
  // legs of length phi. So P2 seeds are scaled by phi relative to P3 seeds.
  // -------------------------------------------------------------------

  // P2 Sun: 10 acute triangles around origin, all apexes meeting at center.
  // Adjacent pairs share a leg → form 5 kites meeting at the apex.
  function p2Sun() {
    const tris = [];
    for (let i = 0; i < 10; i++) {
      const a1 = (2*Math.PI*i)/10, a2 = (2*Math.PI*(i+1))/10;
      let A = V(PHI*Math.cos(a1), PHI*Math.sin(a1));
      let C = V(PHI*Math.cos(a2), PHI*Math.sin(a2));
      if (i % 2 === 0) { const t = A; A = C; C = t; }
      tris.push(Tri('S', A, V(0,0), C));
    }
    return tris;
  }

  // P2 Star: the canonical 5-fold "Star" vertex configuration — 5 darts
  // meeting at their 72° tip at the origin. Each dart = 2 half-darts (L
  // triangles) sharing a leg; the 36° base vertex of each half-dart goes
  // at the origin, and the 108° apexes pair up into the dart's 216° reflex
  // notch pointing outward. Vertex check: 10 half-darts × 36° = 360° ✓.
  function p2Star() {
    const tris = [];
    const ang36 = Math.PI / 5;  // 36° in radians
    const O = V(0, 0);
    for (let i = 0; i < 5; i++) {
      // Axis of symmetry for the i-th dart, pointing outward from origin.
      const theta = (2*Math.PI*i)/5 + Math.PI/2;  // rotate so first dart points up
      // B = the dart's 216° reflex (= half-dart's 108° apex), along the axis
      // at distance 1 (= leg length) from origin.
      const B = V(Math.cos(theta), Math.sin(theta));
      // Two outer 36° vertices, rotated ±36° from the axis at distance phi
      // (= base length AC) from origin.
      const C_left  = V(PHI * Math.cos(theta + ang36), PHI * Math.sin(theta + ang36));
      const C_right = V(PHI * Math.cos(theta - ang36), PHI * Math.sin(theta - ang36));
      // Two half-darts forming the i-th dart of the star.
      tris.push(Tri('L', O, B, C_left));
      tris.push(Tri('L', O, B, C_right));
    }
    return tris;
  }

  // -------------------------------------------------------------------
  // Chair seeds. L-trominos can't tile a square (12 cells ≠ n²), so the
  // cleanest starting configurations are rectangles. Centered around origin
  // and scaled to a radius of ~1 so they fit the same canvas extent as the
  // Penrose seeds.
  // -------------------------------------------------------------------

  // 2 L's interlocking into a 2×3 rectangle.
  function chairSmall() {
    const s = 0.45;  // half-diagonal of 2×3 rect ≈ 1.8; scale to ~0.8
    return [
      chairTile(V(-1 * s, -1.5 * s), 0, s),
      chairTile(V( 1 * s,  1.5 * s), 2, s),
    ];
  }

  // 4 L's tiling a 4×3 rectangle (two pairs of interlocking L's).
  function chairLarge() {
    const s = 0.35;  // half-diagonal of 4×3 rect ≈ 2.5; scale to ~0.9
    return [
      chairTile(V(-2 * s, -1.5 * s), 0, s),
      chairTile(V( 0 * s,  1.5 * s), 2, s),
      chairTile(V( 0 * s, -1.5 * s), 0, s),
      chairTile(V( 2 * s,  1.5 * s), 2, s),
    ];
  }

  // Pinwheel: 4 L-trominoes arranged with 4-fold rotational symmetry around
  // a central 2×2 hole, forming a 4×4 square outline. Each of the 4 L
  // orientations appears once. This is the unique 4-L tiling of a square
  // region — L-trominos can't tile a solid square (12 cells ≠ n²), so the
  // hole is geometrically necessary, but it's centered and symmetric.
  function chairPinwheel() {
    const s = 0.225;  // half-side of 4×4 box ≈ 2; scale to ~0.9
    // Place 4 L's at the corners of a 4×4 grid (cells (0,0)..(3,3)),
    // each rotated so its missing cell faces the center.
    // From the partition search: origins (0,0) (0,4) (4,0) (4,4), orients 0 3 1 2.
    return [
      chairTile(V((0 - 2) * s, (0 - 2) * s), 0, s),
      chairTile(V((0 - 2) * s, (4 - 2) * s), 3, s),
      chairTile(V((4 - 2) * s, (0 - 2) * s), 1, s),
      chairTile(V((4 - 2) * s, (4 - 2) * s), 2, s),
    ];
  }

  // -------------------------------------------------------------------
  // Tiling families. Each family has its own substitution + seeds + edges.
  // -------------------------------------------------------------------
  const FAMILIES = {
    p3: {
      name: 'P3 Rhombi',
      subdivide: subdivideP3,
      edges: penroseEdges,
      seeds: [
        { name: 'Sun',       fn: p3Sun },
        { name: 'Star',      fn: p3Star },
        { name: 'Cartwheel', fn: p3Cartwheel },
        { name: 'Ace',       fn: p3Ace },
      ],
      // For P3 borders: hide internal seam when two same-type triangles
      // share their BASE edge (= rhombus diagonal).
      hideSeam: (k1, k2) => k1 === 'base' && k2 === 'base',
    },
    p2: {
      name: 'P2 Kites & Darts',
      subdivide: subdivideP2,
      edges: penroseEdges,
      seeds: [
        { name: 'Sun',  fn: p2Sun },
        { name: 'Star', fn: p2Star },
      ],
      // For P2: hide internal seam when two same-type triangles share a LEG
      // (= the spine of a kite or dart).
      hideSeam: (k1, k2) => k1 === 'leg' && k2 === 'leg',
    },
    chair: {
      name: 'Chair (L-trominoes)',
      subdivide: subdivideChair,
      edges: chairEdges,
      seeds: [
        { name: 'Pinwheel', fn: chairPinwheel },  // 4 L's around a center hole, 4-fold rot sym
        { name: 'Small',    fn: chairSmall     },  // 2 L's, 2×3 rect
        { name: 'Large',    fn: chairLarge     },  // 4 L's, 4×3 rect
      ],
      // Chair tiles don't pair into composite shapes — every edge is a real
      // boundary between two L-trominoes (or the outer hull). No seams to hide.
      hideSeam: () => false,
    },
  };


  // ===================================================================
  // OKLCH → sRGB (Björn Ottosson)
  // ===================================================================
  function oklchToCss(L, C, H, a = 1) {
    const hRad = H * Math.PI / 180;
    const aL = C * Math.cos(hRad);
    const bL = C * Math.sin(hRad);
    const l_ = L + 0.3963377774 * aL + 0.2158037573 * bL;
    const m_ = L - 0.1055613458 * aL - 0.0638541728 * bL;
    const s_ = L - 0.0894841775 * aL - 1.2914855480 * bL;
    const lc = l_*l_*l_, mc = m_*m_*m_, sc = s_*s_*s_;
    let R =  4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc;
    let G = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc;
    let B = -0.0041960863 * lc - 0.7034186147 * mc + 1.7076147010 * sc;
    const enc = v => {
      if (v <= 0) return 0;
      if (v >= 1) return 1;
      return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1/2.4) - 0.055;
    };
    const r = Math.round(enc(R) * 255);
    const g = Math.round(enc(G) * 255);
    const b = Math.round(enc(B) * 255);
    return a < 1 ? `rgba(${r},${g},${b},${a})` : `rgb(${r},${g},${b})`;
  }

  // ===================================================================
  // State
  // ===================================================================
  // Per-family generation cap. Chair's 4× growth per gen blows up faster
  // than Penrose's phi² ≈ 2.62× growth, so it caps lower to keep tile count
  // manageable on modest hardware (~64k tiles at the limit).
  const MAX_GEN_BY_FAMILY = { p3: 8, p2: 8, chair: 7 };
  const ABSOLUTE_MAX_GEN = 8;

  // -------------------------------------------------------------------
  // Color presets — generator functions, responsive to colorCount.
  //
  // Each preset returns up to 10 OKLCH triples for a given target K.
  // The `group` field controls visual grouping in the UI strip:
  //   'mono' = the black-and-white family
  //   'theme' = named hue themes
  //   'chroma' = full chromatic
  // -------------------------------------------------------------------

  // Linear interp in OKLCH between two colors.
  function lerpColor(a, b, t) {
    return [a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t, a[2] + (b[2]-a[2])*t];
  }
  function evenStops(c0, c1, k) {
    if (k === 1) return [c0];
    const out = [];
    for (let i = 0; i < k; i++) {
      out.push(lerpColor(c0, c1, i / (k - 1)));
    }
    return out;
  }
  function pad10(arr) {
    const out = arr.slice();
    while (out.length < 10) {
      const i = out.length;
      out.push([0.65, 0.14, (i * 36 + 20) % 360]);
    }
    return out;
  }

  const PRESETS = [
    // ----- B&W family (group: mono) -----
    { name: 'b&w',
      group: 'mono',
      bg: [0, 0, 0],
      gen: (k) => {
        // Pure black & white, alternating regardless of k. Hard binary look.
        const out = [];
        for (let i = 0; i < 10; i++) out.push([(i % 2) === 0 ? 0 : 1, 0, 0]);
        return out;
      },
    },
    { name: 'greys',
      group: 'mono',
      bg: [0, 0, 0],
      gen: (k) => {
        // Soft greyscale. At k=2 use mid-greys (visually distinct from b&w's
        // hard black/white). At k>=3, fan out from near-black to near-white.
        if (k <= 2) return pad10([[0.32, 0, 0], [0.78, 0, 0]]);
        const stops = evenStops([0.12, 0, 0], [0.92, 0, 0], k);
        return pad10(stops);
      },
    },
    { name: 'prism',
      group: 'mono',
      bg: [0, 0, 0],
      gen: (k) => {
        // k=2: high-chroma magenta + yellow (classic riso/hi-viz duotone).
        // k>=3: black + (k-2) hues spanning the spectrum + white, like light
        // through a prism.
        if (k <= 2) return pad10([[0.65, 0.27, 0], [0.92, 0.18, 95]]);
        const out = [[0, 0, 0]];
        const inner = k - 2;
        for (let i = 0; i < inner; i++) {
          const hue = (i * 360 / inner + 30) % 360;
          out.push([0.65, 0.18, hue]);
        }
        out.push([1, 0, 0]);
        return pad10(out);
      },
    },

    // ----- Themes (group: theme) -----
    { name: 'paper',
      group: 'theme',
      bg: [0.96, 0.005, 80],
      gen: (k) => pad10(evenStops([0.86, 0.02, 80], [0.16, 0.02, 280], k)),
    },
    { name: 'gold',
      group: 'theme',
      bg: [0.04, 0.005, 280],
      gen: (k) => pad10(evenStops([0.18, 0.02, 280], [0.78, 0.13, 80], k)),
    },
    { name: 'rust',
      group: 'theme',
      bg: [0.08, 0.04, 30],
      gen: (k) => pad10(evenStops([0.20, 0.06, 30], [0.72, 0.18, 35], k)),
    },
    { name: 'plum',
      group: 'theme',
      bg: [0.06, 0.02, 320],
      gen: (k) => pad10(evenStops([0.22, 0.08, 320], [0.72, 0.16, 350], k)),
    },
    { name: 'cobalt',
      group: 'theme',
      bg: [0.06, 0.02, 260],
      gen: (k) => pad10(evenStops([0.18, 0.06, 260], [0.72, 0.16, 240], k)),
    },
    { name: 'sage',
      group: 'theme',
      bg: [0.08, 0.012, 150],
      gen: (k) => pad10(evenStops([0.32, 0.04, 150], [0.78, 0.10, 140], k)),
    },

    // ----- Chromatic (group: chroma) -----
    { name: 'spectra',
      group: 'chroma',
      bg: [0.04, 0.005, 280],
      gen: (k) => {
        const out = [];
        for (let i = 0; i < 10; i++) {
          const hue = (i * 360 / Math.max(k, 1) + 30) % 360;
          out.push([0.65, 0.18, hue]);
        }
        return out;
      },
    },
    { name: 'girih',
      group: 'chroma',
      // Historical Islamic girih palette — turquoise/cobalt/cream/ochre with
      // gilt strapwork, per Lu & Steinhardt's analysis of the Darb-i Imam
      // shrine (1453 CE), which used quasi-periodic tilings 500 years before
      // Penrose. Distinctive and grounded — definitely not "modern Penrose".
      bg: [0.12, 0.018, 250],
      gen: (k) => pad10([
        [0.92, 0.04,  85],   // cream
        [0.42, 0.10, 220],   // cobalt
        [0.66, 0.12, 200],   // turquoise
        [0.62, 0.14,  60],   // ochre / gilt
        [0.30, 0.06,  20],   // dark earth
        [0.78, 0.15,  90],   // warm gold
      ]),
    },
  ];

  const state = {
    generation: 6,
    familyId: 'p3',
    seedIdx: 0,
    rotation: 0,
    tris: [],
    triClass: null,
    zoom: 1, panX: 0, panY: 0,
    w: 0, h: 0, dpr: 1,
    uiHidden: false,
    colorMode: 'type',
    colorCount: 2,
    colors: PRESETS[4].gen(2),  // 'gold' default at K=2
    editingColorIdx: -1,
    presetIdx: 4,                     // 'gold'
    borderOn: true,
    borderWidth: 0.8,
    borderL: 0.95, borderC: 0, borderH: 0, borderA: 0.35,
    bgMode: 'solid',
    bgL: 0.04, bgC: 0.005, bgH: 280,
    bgImageUrl: null,
  };

  // ===================================================================
  // Tile classification — assigns each tile to a color bucket based on the
  // current colorMode. The classifier reads tile.verts (uniform across
  // families) and tile.type. For Penrose triangles, "orient" mode bins by
  // the base direction (A → C, vert 0 → vert 2). For chair, "orient" mode
  // bins by the integer orientation encoded in the type.
  // ===================================================================
  function classifyTriangles() {
    const tiles = state.tris;
    const n = tiles.length;
    const cls = new Int32Array(n);
    const isChair = state.familyId === 'chair';

    if (state.colorMode === 'type') {
      if (isChair) {
        for (let i = 0; i < n; i++) cls[i] = +tiles[i].type[1];   // 'L0'→0, 'L1'→1, ...
      } else {
        for (let i = 0; i < n; i++) cls[i] = tiles[i].type === 'L' ? 0 : 1;
      }
    } else if (state.colorMode === 'orient') {
      if (isChair) {
        // Chair tiles encode orientation directly in their type ('L0'..'L3').
        // Cheaper and bit-exact compared to recovering it from vertex geometry.
        for (let i = 0; i < n; i++) cls[i] = +tiles[i].type[1];
      } else {
        // Penrose triangles: bin by the base direction (A → C). 10 bins for
        // 10-fold symmetry of the Robinson triangles.
        const bins = 10;
        const denom = 2 * Math.PI / bins;
        // Float-robust binning: add half-bin then floor, instead of round().
        // (Math.round(3.4999999) = 3 ≠ Math.round(3.5) = 4 — a hazard when
        // angles compute as e.g. 314.999...° instead of exactly 315°.)
        for (let i = 0; i < n; i++) {
          const v = tiles[i].verts;
          const dx = v[2].x - v[0].x, dy = v[2].y - v[0].y;
          let ang = Math.atan2(dy, dx);
          if (ang < 0) ang += 2 * Math.PI;
          cls[i] = Math.floor((ang + denom * 0.5) / denom) % bins;
        }
      }
    } else { // ring
      // Bin tiles by distance from origin. For Penrose, Euclidean distance fits
      // the natural rotational symmetry. For chair, the L-tromino grid is
      // square and seeds may be rectangular; we normalize each axis
      // independently and use the max — this gives concentric rectangles
      // matching the seed's aspect ratio, instead of distorted Chebyshev
      // banding favoring the wider axis.
      const cxs = new Float32Array(n);
      const cys = new Float32Array(n);
      let maxX = 0, maxY = 0, maxR = 0;
      for (let i = 0; i < n; i++) {
        const v = tiles[i].verts;
        let sx = 0, sy = 0;
        for (let j = 0; j < v.length; j++) { sx += v[j].x; sy += v[j].y; }
        const cx = sx / v.length, cy = sy / v.length;
        cxs[i] = cx; cys[i] = cy;
        const ax = Math.abs(cx), ay = Math.abs(cy);
        if (ax > maxX) maxX = ax;
        if (ay > maxY) maxY = ay;
        const r = Math.hypot(cx, cy);
        if (r > maxR) maxR = r;
      }
      const k = state.colorCount;
      let dist;
      if (isChair) {
        const invX = maxX > 0 ? 1 / maxX : 1;
        const invY = maxY > 0 ? 1 / maxY : 1;
        dist = (x, y) => Math.max(Math.abs(x) * invX, Math.abs(y) * invY);
      } else {
        const inv = maxR > 0 ? 1 / maxR : 1;
        dist = (x, y) => Math.hypot(x, y) * inv;
      }
      for (let i = 0; i < n; i++) {
        let bin = Math.floor(dist(cxs[i], cys[i]) * k);
        if (bin >= k) bin = k - 1;
        if (bin < 0) bin = 0;
        cls[i] = bin;
      }
    }
    state.triClass = cls;
  }

  // ===================================================================
  // Build / render
  // ===================================================================
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d', { alpha: true });
  let classBuckets = null;

  function rebuildBuckets() {
    const k = state.colorCount;
    const cm = state.colorMode;
    const numBuckets = (cm === 'orient') ? 10 : k;
    const buckets = new Array(numBuckets);
    for (let i = 0; i < numBuckets; i++) buckets[i] = [];
    const cls = state.triClass;
    for (let i = 0; i < state.tris.length; i++) {
      const b = cls[i] % numBuckets;
      buckets[b].push(i);
    }
    classBuckets = buckets;
  }

  // Safety: stop deflating if the next gen would exceed this. Prevents
  // accidental OOM if someone cranks gen high enough to overflow on a small
  // seed × deep chain.
  const MAX_TILES = 600000;

  function rebuild() {
    const fam = FAMILIES[state.familyId];
    const seed = fam.seeds[state.seedIdx % fam.seeds.length];
    let tris = seed.fn();
    for (let i = 0; i < state.generation; i++) {
      const next = fam.subdivide(tris);
      if (next.length > MAX_TILES) break;
      tris = next;
    }
    state.tris = tris;
    classifyTriangles();
    classBuckets = null;
    document.getElementById('tilesCount').textContent = tris.length.toLocaleString();
    document.getElementById('genVal').textContent = state.generation;
    document.getElementById('genDown').disabled = state.generation <= 0;
    document.getElementById('genUp').disabled = state.generation >= (MAX_GEN_BY_FAMILY[state.familyId] ?? ABSOLUTE_MAX_GEN);
    const sn = document.getElementById('seedName');
    if (sn) sn.textContent = seed.name;
    draw();
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    state.dpr = dpr;
    state.w = window.innerWidth;
    state.h = window.innerHeight;
    canvas.width = Math.floor(state.w * dpr);
    canvas.height = Math.floor(state.h * dpr);
    canvas.style.width = state.w + 'px';
    canvas.style.height = state.h + 'px';
    draw();
  }

  function draw() {
    if (!state.tris.length) return;
    if (!classBuckets) rebuildBuckets();

    const dpr = state.dpr;
    const w = state.w, h = state.h;
    const cx = w / 2 + state.panX;
    const cy = h / 2 + state.panY;
    const baseR = Math.min(w, h) * 0.45;
    const s = baseR * state.zoom;
    const rot = state.rotation * Math.PI / 180;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (state.bgMode === 'image' && state.bgImageUrl) {
      ctx.clearRect(0, 0, w, h);
    } else {
      let bgCss;
      if (state.bgMode === 'match') {
        const c0 = state.colors[0];
        bgCss = oklchToCss(c0[0], c0[1], c0[2]);
      } else {
        bgCss = oklchToCss(state.bgL, state.bgC, state.bgH);
      }
      ctx.fillStyle = bgCss;
      ctx.fillRect(0, 0, w, h);
    }

    // Approximate pixel size of one tile edge after deflation. P2/P3 deflate
    // by 1/phi per generation; chair deflates by 1/2. Used to skip borders
    // when tiles get too tiny to render meaningfully.
    const deflationRate = (state.familyId === 'chair') ? 0.5 : psi;
    const approxEdgePx = s * Math.pow(deflationRate, state.generation);
    const tris = state.tris;
    const numBuckets = classBuckets.length;
    const k = state.colorCount;

    // Fills — chunk into batches of ~4000 tiles per fill. Chrome's Skia
    // path renderer slows dramatically on giant single paths (degrades to
    // O(n²) in some cases). Smaller batches keep each path under the
    // pathological threshold, giving 3-5× better Chrome performance with no
    // visible difference.
    //
    // Color mapping: when numBuckets > k (orient mode with k smaller than the
    // family's natural bin count), we group CONTIGUOUS buckets together —
    // bins 0..(N/k-1) → color 0, bins (N/k)..(2N/k-1) → color 1, etc. This
    // gives meaningful "half/quadrant/etc." groupings instead of the
    // alternating-stripes pattern that bi % k would produce.
    const FILL_BATCH = 4000;
    const groupBy = numBuckets > k ? numBuckets / k : 1;
    for (let bi = 0; bi < numBuckets; bi++) {
      const bucket = classBuckets[bi];
      if (!bucket.length) continue;
      const ci = numBuckets > k ? Math.min(k - 1, Math.floor(bi / groupBy)) : bi % k;
      const c = state.colors[ci];
      ctx.fillStyle = oklchToCss(c[0], c[1], c[2]);
      for (let j0 = 0; j0 < bucket.length; j0 += FILL_BATCH) {
        const jEnd = Math.min(j0 + FILL_BATCH, bucket.length);
        ctx.beginPath();
        for (let j = j0; j < jEnd; j++) {
          const verts = tris[bucket[j]].verts;
          const nv = verts.length;
          const v0 = verts[0];
          ctx.moveTo(cx + (v0.x*cosR - v0.y*sinR) * s, cy + (v0.x*sinR + v0.y*cosR) * s);
          for (let vi = 1; vi < nv; vi++) {
            const vp = verts[vi];
            ctx.lineTo(cx + (vp.x*cosR - vp.y*sinR) * s, cy + (vp.x*sinR + vp.y*cosR) * s);
          }
          ctx.closePath();
        }
        ctx.fill();
      }
    }

    // Borders — family-aware edge rendering.
    //
    // Each family provides an edges(tile) function returning an array of
    // {p1, p2, kind} describing each edge of the tile. We dedup edges by
    // their midpoint coordinates. When two tiles share an edge, the family's
    // hideSeam(k1, k2) rule decides whether to suppress it for tiles of the
    // same type (for Penrose, this hides interior diagonals of rhombi/kites/
    // darts; for chair, no edges are hidden).
    if (state.borderOn && state.borderWidth > 0 && approxEdgePx > 0.6) {
      const lw = Math.max(0.25, state.borderWidth * Math.min(1.4, approxEdgePx * 0.06 + 0.4));
      ctx.strokeStyle = oklchToCss(state.borderL, state.borderC, state.borderH, state.borderA);
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      const familyEdges = FAMILIES[state.familyId].edges;
      const hideSeam = FAMILIES[state.familyId].hideSeam;
      const KEY_SCALE = 1e5;
      const edgeMap = new Map();
      for (let i = 0; i < tris.length; i++) {
        const t = tris[i];
        const eList = familyEdges(t);
        for (let e = 0; e < eList.length; e++) {
          const ed = eList[e];
          const mx = (ed.p1.x + ed.p2.x) * 0.5, my = (ed.p1.y + ed.p2.y) * 0.5;
          const key = (Math.round(mx * KEY_SCALE) | 0) + ',' + (Math.round(my * KEY_SCALE) | 0);
          const existing = edgeMap.get(key);
          if (existing) {
            existing.t2 = t.type;
            existing.k2 = ed.kind;
          } else {
            edgeMap.set(key, {
              p1x: ed.p1.x, p1y: ed.p1.y, p2x: ed.p2.x, p2y: ed.p2.y,
              t1: t.type, k1: ed.kind,
              t2: null, k2: null,
            });
          }
        }
      }

      // Walk edges, draw each unless it's an internal seam per family rule.
      ctx.beginPath();
      for (const e of edgeMap.values()) {
        if (e.t2 !== null && e.t1 === e.t2 && hideSeam(e.k1, e.k2)) continue;
        const p1x = cx + (e.p1x*cosR - e.p1y*sinR) * s;
        const p1y = cy + (e.p1x*sinR + e.p1y*cosR) * s;
        const p2x = cx + (e.p2x*cosR - e.p2y*sinR) * s;
        const p2y = cy + (e.p2x*sinR + e.p2y*cosR) * s;
        ctx.moveTo(p1x, p1y);
        ctx.lineTo(p2x, p2y);
      }
      ctx.stroke();
    }
  }

  // ===================================================================
  // Pointer / gestures
  // ===================================================================
  const pointers = new Map();
  let pinchStart = null;
  let lastTap = 0;

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY });
    if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      pinchStart = {
        dist: Math.hypot(p2.x - p1.x, p2.y - p1.y),
        zoom: state.zoom,
        midX: (p1.x + p2.x) / 2,
        midY: (p1.y + p2.y) / 2,
        panX: state.panX, panY: state.panY,
      };
    }
    if (pointers.size === 1) {
      const now = performance.now();
      if (now - lastTap < 320) { setUiHidden(!state.uiHidden); lastTap = 0; }
      else lastTap = now;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.lx = p.x; p.ly = p.y; p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2 && pinchStart) {
      const [p1, p2] = [...pointers.values()];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const newZoom = Math.max(0.3, Math.min(8, pinchStart.zoom * (dist / pinchStart.dist)));
      const cx = state.w / 2, cy = state.h / 2;
      const mx = pinchStart.midX - cx, my = pinchStart.midY - cy;
      const ratio = newZoom / pinchStart.zoom;
      state.panX = pinchStart.panX - mx * (ratio - 1);
      state.panY = pinchStart.panY - my * (ratio - 1);
      const curMid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      state.panX += curMid.x - pinchStart.midX;
      state.panY += curMid.y - pinchStart.midY;
      state.zoom = newZoom;
      document.getElementById('zoom').value = state.zoom.toFixed(3);
      draw();
    } else if (pointers.size === 1) {
      state.panX += p.x - p.lx;
      state.panY += p.y - p.ly;
      draw();
    }
  });
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 1) {
      const p = [...pointers.values()][0];
      p.lx = p.x; p.ly = p.y;
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', endPointer);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    const newZoom = Math.max(0.3, Math.min(8, state.zoom * factor));
    const cx = state.w / 2, cy = state.h / 2;
    const ratio = newZoom / state.zoom;
    state.panX -= (e.clientX - cx) * (ratio - 1);
    state.panY -= (e.clientY - cy) * (ratio - 1);
    state.zoom = newZoom;
    document.getElementById('zoom').value = state.zoom.toFixed(3);
    draw();
  }, { passive: false });

  // ===================================================================
  // UI wiring
  // ===================================================================
  const panel = document.getElementById('panel');
  const topbar = document.getElementById('topbar');
  const showPanelBtn = document.getElementById('showPanelBtn');

  function setUiHidden(hidden) {
    state.uiHidden = hidden;
    panel.classList.toggle('hidden', hidden);
    topbar.classList.toggle('hidden', hidden);
    showPanelBtn.classList.toggle('visible', hidden);
    // If we just revealed the UI while in fullscreen, start the idle countdown.
    if (!hidden && typeof inFullscreen !== 'undefined' && inFullscreen) {
      armIdleTimer();
    }
  }
  showPanelBtn.addEventListener('click', () => setUiHidden(false));

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
      const target = tab.dataset.tab;
      document.querySelectorAll('.pane').forEach(p =>
        p.classList.toggle('active', p.dataset.pane === target));
    });
  });

  // Seed cycle (prev/next)
  document.getElementById('seedPrev').addEventListener('click', () => {
    const n = FAMILIES[state.familyId].seeds.length;
    state.seedIdx = (state.seedIdx - 1 + n) % n;
    state.panX = 0; state.panY = 0;
    rebuild();
  });
  document.getElementById('seedNext').addEventListener('click', () => {
    const n = FAMILIES[state.familyId].seeds.length;
    state.seedIdx = (state.seedIdx + 1) % n;
    state.panX = 0; state.panY = 0;
    rebuild();
  });

  // Family segmented control. Each family has its own preferred default
  // generation since deflation rates differ (Penrose: phi per gen, chair:
  // 2 per gen → much faster tile count growth).
  const DEFAULT_GEN_BY_FAMILY = { p3: 6, p2: 6, chair: 4 };
  function applyFamilyUI() {
    document.querySelectorAll('#familySeg button').forEach(b =>
      b.classList.toggle('on', b.dataset.fam === state.familyId));
  }
  document.querySelectorAll('#familySeg button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.fam === state.familyId) return;
      state.familyId = btn.dataset.fam;
      state.seedIdx = 0;
      state.generation = DEFAULT_GEN_BY_FAMILY[state.familyId] ?? 6;
      state.panX = 0; state.panY = 0;
      // Re-pin colorCount if we're in type mode (Penrose=2, chair=4).
      if (state.colorMode === 'type') {
        state.colorCount = typeModeK();
        document.getElementById('colorCount').value = state.colorCount;
        document.getElementById('colorCountVal').textContent = String(state.colorCount);
        applyCurrentPreset();
        rebuildPaletteStrip();
      }
      applyFamilyUI();
      rebuild();
    });
  });

  // Tiling pane
  document.getElementById('genUp').addEventListener('click', () => {
    const cap = MAX_GEN_BY_FAMILY[state.familyId] ?? ABSOLUTE_MAX_GEN;
    if (state.generation < cap) { state.generation++; rebuild(); }
  });
  document.getElementById('genDown').addEventListener('click', () => {
    if (state.generation > 0) { state.generation--; rebuild(); }
  });
  document.getElementById('resetBtn').addEventListener('click', () => {
    state.zoom = 1; state.panX = 0; state.panY = 0; state.rotation = 0;
    document.getElementById('zoom').value = '1';
document.getElementById('rotate').value = '0';
    document.getElementById('rotVal').textContent = '0°';
    draw();
  });
  document.getElementById('zoom').addEventListener('input', (e) => {
    state.zoom = parseFloat(e.target.value);
    draw();
  });
  document.getElementById('rotate').addEventListener('input', (e) => {
    state.rotation = parseFloat(e.target.value);
    document.getElementById('rotVal').textContent = state.rotation.toFixed(0) + '°';
    draw();
  });

  // Color mode
  function applyColorModeUI() {
    document.querySelectorAll('#colorMode button').forEach(b =>
      b.classList.toggle('on', b.dataset.mode === state.colorMode));
    // Hide colorCount slider in Type mode — the natural K is determined by
    // the family (2 for Penrose, 4 for chair) and shouldn't be user-set.
    const ccRow = document.getElementById('colorCountRow');
    if (ccRow) ccRow.classList.toggle('disabled-row', state.colorMode === 'type');
  }
  document.querySelectorAll('#colorMode button').forEach(btn => {
    btn.addEventListener('click', () => {
      state.colorMode = btn.dataset.mode;
      // Type mode K is fixed per family: 2 (Penrose L/S) or 4 (chair orientations).
      if (state.colorMode === 'type') {
        state.colorCount = typeModeK();
        document.getElementById('colorCount').value = state.colorCount;
        document.getElementById('colorCountVal').textContent = String(state.colorCount);
        applyCurrentPreset();
      }
      applyColorModeUI();
      classifyTriangles();
      classBuckets = null;
      rebuildPaletteStrip();
      draw();
    });
  });

  // Natural K for "type" coloring in the current family.
  function typeModeK() { return state.familyId === 'chair' ? 4 : 2; }

  // Re-run the current preset's generator at the current colorCount.
  // Skip if user has been hand-editing (presetIdx === -1).
  function applyCurrentPreset() {
    if (state.presetIdx < 0 || !PRESETS[state.presetIdx]) return;
    const p = PRESETS[state.presetIdx];
    const fresh = p.gen(state.colorCount);
    for (let i = 0; i < 10; i++) state.colors[i] = fresh[i].slice();
  }

  const colorCountInput = document.getElementById('colorCount');
  const colorCountVal = document.getElementById('colorCountVal');
  colorCountInput.addEventListener('input', (e) => {
    const k = parseInt(e.target.value, 10);
    if (state.colorMode === 'type') {
      // pinned to family's natural type count in type mode
      e.target.value = typeModeK();
      return;
    }
    state.colorCount = k;
    colorCountVal.textContent = k;
    // Generator-based presets respond to K — refresh colors from the active preset.
    applyCurrentPreset();
    rebuildPaletteStrip();
    if (state.colorMode === 'ring') classifyTriangles();
    classBuckets = null;
    draw();
  });

  const paletteStrip = document.getElementById('paletteStrip');
  const editor = document.getElementById('colorEditor');
  const oklchL = document.getElementById('oklchL');
  const oklchC = document.getElementById('oklchC');
  const oklchH = document.getElementById('oklchH');
  const oklchLVal = document.getElementById('oklchLVal');
  const oklchCVal = document.getElementById('oklchCVal');
  const oklchHVal = document.getElementById('oklchHVal');
  const colorPreview = document.getElementById('colorPreview');

  function rebuildPaletteStrip() {
    paletteStrip.innerHTML = '';
    for (let i = 0; i < state.colorCount; i++) {
      const c = state.colors[i];
      const sw = document.createElement('button');
      sw.className = 'swatch';
      sw.style.background = oklchToCss(c[0], c[1], c[2]);
      if (i === state.editingColorIdx) sw.classList.add('active');
      sw.addEventListener('click', () => {
        state.editingColorIdx = i;
        showEditor();
        rebuildPaletteStrip();
      });
      paletteStrip.appendChild(sw);
    }
    updateThumbs();
  }
  function showEditor() {
    const i = state.editingColorIdx;
    if (i < 0) { editor.classList.add('hidden'); return; }
    editor.classList.remove('hidden');
    const c = state.colors[i];
    oklchL.value = c[0]; oklchC.value = c[1]; oklchH.value = c[2];
    oklchLVal.textContent = c[0].toFixed(2).replace(/^0/, '');
    oklchCVal.textContent = c[1].toFixed(2).replace(/^0/, '');
    oklchHVal.textContent = c[2].toFixed(0) + '°';
    colorPreview.style.background = oklchToCss(c[0], c[1], c[2]);
  }
  function applyEditorChange() {
    const i = state.editingColorIdx;
    if (i < 0) return;
    const c = state.colors[i];
    c[0] = parseFloat(oklchL.value);
    c[1] = parseFloat(oklchC.value);
    c[2] = parseFloat(oklchH.value);
    oklchLVal.textContent = c[0].toFixed(2).replace(/^0/, '');
    oklchCVal.textContent = c[1].toFixed(2).replace(/^0/, '');
    oklchHVal.textContent = c[2].toFixed(0) + '°';
    colorPreview.style.background = oklchToCss(c[0], c[1], c[2]);
    // Manual edit detaches from active preset (so colorCount changes don't
    // overwrite the user's hand-picked color).
    if (state.presetIdx >= 0) {
      state.presetIdx = -1;
      rebuildPresets();
    }
    rebuildPaletteStrip();
    draw();
  }
  oklchL.addEventListener('input', applyEditorChange);
  oklchC.addEventListener('input', applyEditorChange);
  oklchH.addEventListener('input', applyEditorChange);

  const presetsEl = document.getElementById('presets');
  function rebuildPresets() {
    presetsEl.innerHTML = '';
    let prevGroup = null;
    PRESETS.forEach((p, i) => {
      // Insert a visual separator between groups
      if (prevGroup !== null && p.group !== prevGroup) {
        const sep = document.createElement('div');
        sep.className = 'preset-sep';
        presetsEl.appendChild(sep);
      }
      prevGroup = p.group;

      const btn = document.createElement('button');
      btn.className = 'preset' + (i === state.presetIdx ? ' active' : '');
      btn.title = p.name;
      // Show 4 chips of the preset's K=4 generation as a swatch preview
      const previewColors = p.gen(4).slice(0, 4);
      previewColors.forEach(c => {
        const ch = document.createElement('div');
        ch.className = 'pchip';
        ch.style.background = oklchToCss(c[0], c[1], c[2]);
        btn.appendChild(ch);
      });
      btn.addEventListener('click', () => {
        state.presetIdx = i;
        // Generate colors at the family-natural K in type mode, or user K otherwise.
        const k = state.colorMode === 'type' ? typeModeK() : state.colorCount;
        const fresh = p.gen(k);
        for (let j = 0; j < 10; j++) state.colors[j] = fresh[j].slice();
        // Apply preset's background
        state.bgL = p.bg[0]; state.bgC = p.bg[1]; state.bgH = p.bg[2];
        document.getElementById('bgOklchL').value = state.bgL;
        document.getElementById('bgOklchC').value = state.bgC;
        document.getElementById('bgOklchH').value = state.bgH;
        document.getElementById('bgOklchLVal').textContent = state.bgL.toFixed(2).replace(/^0/, '');
        document.getElementById('bgOklchCVal').textContent = state.bgC.toFixed(2).replace(/^0/, '');
        document.getElementById('bgOklchHVal').textContent = Math.round(state.bgH) + '°';
        colorCountInput.value = state.colorCount;
        colorCountVal.textContent = state.colorCount;
        rebuildPaletteStrip();
        rebuildPresets();
        if (state.colorMode === 'ring') classifyTriangles();
        classBuckets = null;
        draw();
      });
      presetsEl.appendChild(btn);
    });
  }

  // Border
  const borderToggle = document.getElementById('borderToggle');
  borderToggle.addEventListener('click', () => {
    state.borderOn = !state.borderOn;
    borderToggle.classList.toggle('on', state.borderOn);
    borderToggle.textContent = state.borderOn ? 'On' : 'Off';
    draw();
  });
  function updateBorderPreview() {
    const p = document.getElementById('borderPreview');
    if (p) p.style.background = oklchToCss(state.borderL, state.borderC, state.borderH, state.borderA);
  }
  function bindSlider(id, prop, fmt, after) {
    const el = document.getElementById(id);
    const valEl = document.getElementById(id + 'Val');
    el.addEventListener('input', () => {
      state[prop] = parseFloat(el.value);
      valEl.textContent = fmt(state[prop]);
      if (after) after();
      draw();
    });
  }
  bindSlider('borderWidth', 'borderWidth', v => v.toFixed(1));
  bindSlider('borderL', 'borderL', v => v.toFixed(2).replace(/^0/, ''), updateBorderPreview);
  bindSlider('borderC', 'borderC', v => v.toFixed(2).replace(/^0/, ''), updateBorderPreview);
  bindSlider('borderH', 'borderH', v => v.toFixed(0) + '°', updateBorderPreview);
  bindSlider('borderA', 'borderA', v => v.toFixed(2).replace(/^0/, ''), updateBorderPreview);

  // Background
  document.querySelectorAll('#bgMode button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#bgMode button').forEach(b =>
        b.classList.toggle('on', b === btn));
      state.bgMode = btn.dataset.bg;
      const showSolid = state.bgMode === 'solid';
      const showImage = state.bgMode === 'image';
      document.querySelectorAll('[data-bgrow=solid]').forEach(r =>
        r.style.display = showSolid ? '' : 'none');
      document.querySelectorAll('[data-bgrow=image]').forEach(r =>
        r.style.display = showImage ? '' : 'none');
      document.body.classList.toggle('has-bgimg', showImage && !!state.bgImageUrl);
      draw();
    });
  });
  bindSlider('bgOklchL', 'bgL', v => v.toFixed(2).replace(/^0/, ''));
  bindSlider('bgOklchC', 'bgC', v => v.toFixed(2).replace(/^0/, ''));
  bindSlider('bgOklchH', 'bgH', v => v.toFixed(0) + '°');

  document.querySelectorAll('#bgFit button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#bgFit button').forEach(b =>
        b.classList.toggle('on', b === btn));
      document.getElementById('bgimg').style.backgroundSize = btn.dataset.fit;
    });
  });

  document.getElementById('bgFileBtn').addEventListener('click', () => {
    document.getElementById('bgFile').click();
  });
  document.getElementById('bgFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    if (state.bgImageUrl) URL.revokeObjectURL(state.bgImageUrl);
    state.bgImageUrl = url;
    document.getElementById('bgimg').style.backgroundImage = `url("${url}")`;
    document.body.classList.add('has-bgimg');
    state.bgMode = 'image';
    document.querySelectorAll('#bgMode button').forEach(b =>
      b.classList.toggle('on', b.dataset.bg === 'image'));
    document.querySelectorAll('[data-bgrow=solid]').forEach(r => r.style.display = 'none');
    document.querySelectorAll('[data-bgrow=image]').forEach(r => r.style.display = '');
    draw();
  });
  document.getElementById('bgClearBtn').addEventListener('click', () => {
    if (state.bgImageUrl) URL.revokeObjectURL(state.bgImageUrl);
    state.bgImageUrl = null;
    document.getElementById('bgimg').style.backgroundImage = '';
    document.body.classList.remove('has-bgimg');
    draw();
  });

  // Mirror C1 onto slider thumbs
  function updateThumbs() {
    const c = state.colors[0];
    const thumbColor = oklchToCss(c[0], c[1], c[2]);
    ['zoom', 'rotate', 'colorCount'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.setProperty('--thumb', thumbColor);
    });
  }

  // Fullscreen + idle auto-hide
  // While in fullscreen, hide the UI after 4 seconds of no input.
  // Any pointer/wheel/keyboard activity resets the timer; once UI shown,
  // user keeps it on screen by interacting.
  const IDLE_HIDE_MS = 4000;
  let idleTimer = null;
  let inFullscreen = false;

  function clearIdleTimer() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }
  function armIdleTimer() {
    clearIdleTimer();
    if (!inFullscreen) return;
    if (state.uiHidden) return; // already hidden, nothing to do
    idleTimer = setTimeout(() => { setUiHidden(true); }, IDLE_HIDE_MS);
  }
  function onActivity() {
    if (!inFullscreen) return;
    // Any activity: re-arm the timer. Don't auto-show — user toggles via
    // the floating button or double-tap.
    armIdleTimer();
  }
  // Reset timer on input
  ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart'].forEach(ev => {
    window.addEventListener(ev, onActivity, { passive: true });
  });

  document.addEventListener('fullscreenchange', () => {
    inFullscreen = !!document.fullscreenElement;
    if (inFullscreen) armIdleTimer();
    else clearIdleTimer();
  });

  document.getElementById('fsBtn').addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      // iOS Safari fallback: simulate fullscreen by hiding chrome and
      // engaging the idle timer manually.
      inFullscreen = !inFullscreen;
      setUiHidden(inFullscreen);
      if (inFullscreen) armIdleTimer(); else clearIdleTimer();
    }
  });

  // Hint
  const hint = document.getElementById('hint');
  setTimeout(() => hint.classList.add('show'), 250);
  setTimeout(() => hint.classList.remove('show'), 2400);

  // Boot
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));
  try {
    applyFamilyUI();
    applyColorModeUI();
    rebuildPaletteStrip();
    rebuildPresets();
    updateBorderPreview();
    resize();
    rebuild();
  } catch (err) {
    console.error('boot failed:', err);
    const el = document.getElementById('topbar');
    if (el) {
      el.innerHTML = '<div style="color:#ff8080;padding:14px;font-size:11px;font-family:ui-monospace,monospace;text-shadow:0 1px 8px rgba(0,0,0,0.8)">boot failed: ' +
        (err && err.message ? err.message : String(err)) + '</div>';
    }
  }
})();
