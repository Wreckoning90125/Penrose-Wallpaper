type Grid = readonly (readonly number[])[];
type D4Matrix = readonly [number, number, number, number];
type Point = readonly [number, number];

function sameGrid(a: Grid, b: Grid): boolean {
  if (a.length !== b.length) return false;
  for (let y = 0; y < a.length; y++) {
    const rowA = a[y]!;
    const rowB = b[y]!;
    if (rowA.length !== rowB.length) return false;
    for (let x = 0; x < rowA.length; x++) {
      if (rowA[x] !== rowB[x]) return false;
    }
  }
  return true;
}

function inverseReverse(grid: Grid): number[][] {
  return grid.map(row => [...row].reverse().map(value => 1 - value));
}

function mirrorReverse(grid: Grid): number[][] {
  return [...grid].reverse().map(row => [...row].reverse());
}

function connectedTile(grid: Grid): number[][] {
  const topRight = inverseReverse(grid);
  const bottomLeft = [...grid].reverse().map(row => row.map(value => 1 - value));
  const bottomRight = mirrorReverse(grid);
  const rows: number[][] = [];
  for (let y = 0; y < grid.length; y++) {
    rows.push([...grid[y]!, ...topRight[y]!]);
  }
  for (let y = 0; y < grid.length; y++) {
    rows.push([...bottomLeft[y]!, ...bottomRight[y]!]);
  }
  return rows;
}

function assertGrid(label: string, actual: Grid, expected: Grid): void {
  if (sameGrid(actual, expected)) return;
  throw new Error(`${label} mismatch: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}

function d4Apply(matrix: D4Matrix, point: Point): Point {
  return [
    matrix[0] * point[0] + matrix[1] * point[1],
    matrix[2] * point[0] + matrix[3] * point[1],
  ];
}

function samePoint(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function assertD4(label: string, matrix: D4Matrix, expected: D4Matrix): void {
  const probes: Point[] = [[1, 0], [0, 1], [-1, 1]];
  for (const point of probes) {
    const actualPoint = d4Apply(matrix, point);
    const expectedPoint = d4Apply(expected, point);
    if (!samePoint(actualPoint, expectedPoint)) {
      throw new Error(`${label} mismatch at ${JSON.stringify(point)}: ${JSON.stringify(actualPoint)} != ${JSON.stringify(expectedPoint)}`);
    }
  }
}

const source: Grid = [
  [0, 1, 1],
  [1, 0, 0],
];

assertGrid('Truchet transform none', source, [[0, 1, 1], [1, 0, 0]]);
assertGrid('Truchet inverse reverse', inverseReverse(source), [[0, 0, 1], [1, 1, 0]]);
assertGrid('Truchet mirror reverse', mirrorReverse(source), [[0, 0, 1], [1, 1, 0]]);
assertGrid('Truchet connected 2x2 tile', connectedTile([[0]]), [[0, 1], [1, 0]]);

const connected = connectedTile(source);
assertGrid('Truchet connected top-left', connected.slice(0, 2).map(row => row.slice(0, 3)), source);
assertGrid('Truchet connected top-right', connected.slice(0, 2).map(row => row.slice(3)), inverseReverse(source));
assertGrid('Truchet connected bottom-right', connected.slice(2).map(row => row.slice(3)), mirrorReverse(source));

// D4 square overlays draw the Wolfram Truchet primitive in the actual square
// cell coordinates. The D4 substitution state contributes the deterministic
// Truchet bit; it is not applied a second time as a coordinate transform.
const d4Matrices: D4Matrix[] = [
  [1, 0, 0, 1],
  [0, -1, 1, 0],
  [-1, 0, 0, -1],
  [0, 1, -1, 0],
  [-1, 0, 0, 1],
  [1, 0, 0, -1],
  [0, 1, 1, 0],
  [0, -1, -1, 0],
];

const d4DiagonalBit = [0, 1, 0, 1, 1, 1, 0, 0];
for (let i = 0; i < d4Matrices.length; i++) {
  const mapped = d4Apply(d4Matrices[i]!, [1, 1]);
  const bit = mapped[0] * mapped[1] < 0 ? 1 : 0;
  if (bit !== d4DiagonalBit[i]) throw new Error(`D4 diagonal bit ${i} mismatch: ${bit} != ${d4DiagonalBit[i]}`);
}

console.log('[truchet-sources] OK: notebook Truchet laws and D4 state-bit sampling');
