// Production data for the D4 square-weave ornament (family 18). The renderer
// builds its TSL ornament mask from these values, and tools/
// verify_truchet_sources.mts cross-checks them: the matrix table against
// penrose.cpp's kD4Matrices (the C++ generator writes the state index into
// tile.type, which reaches the shader as tileType), and the diagonal-state
// set against the criterion derived independently from the matrices.
export type D4Matrix = readonly [number, number, number, number];

// MUST stay in penrose.cpp kD4Matrices order — the index IS the wire format
// (tile.type = state index, shader decodes d4State = round(tileType * 7)).
export const D4_MATRICES: readonly D4Matrix[] = [
  [1, 0, 0, 1],   // identity
  [0, -1, 1, 0],  // rotate 90
  [-1, 0, 0, -1], // rotate 180
  [0, 1, -1, 0],  // rotate 270
  [-1, 0, 0, 1],  // mirror left/right
  [1, 0, 0, -1],  // mirror up/down
  [0, 1, 1, 0],   // mirror main diagonal
  [0, -1, -1, 0], // mirror anti-diagonal
];

// States whose symmetry turns the truchet motif onto the other diagonal:
// exactly those whose matrix maps the (1,1) direction into a quadrant where
// x*y < 0. Stated explicitly here (the shader needs literal states) and
// re-derived from D4_MATRICES by the verify gate so the two can never drift.
export const D4_DIAGONAL_STATES: readonly number[] = [1, 3, 4, 5];
