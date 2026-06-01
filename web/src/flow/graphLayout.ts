// The control graph's auto-layout engine: column placement, fit-to-view, and node
// measurement. Pure (nodes in → positions/bounds out); the ControlGraph
// orchestrator drives it from its layout effect. Built on the generic flowLayout
// primitives plus the app's control specs / port specs for per-node port counts.
import type { Node } from '@xyflow/react';
import {
  GRID_SIZE,
  clampFlowZoom,
  snapCeilValue,
  snapValue,
  type FlowBounds,
  type FlowFitController,
  type FlowFitMetrics,
  type FlowViewport,
} from './flowLayout';

export const LAYOUT_COLUMN_GAP = 120;
// Port labels sit outside the node card. Keep this in sync with the rail/pill
// width in CSS so measured auto-layout reserves enough room between columns.
export const LAYOUT_RAIL_CLEARANCE = GRID_SIZE * 5;
export const FLOW_CHROME_GAP = GRID_SIZE;
export const FLOW_SIDE_PADDING = GRID_SIZE;
export const FLOW_BOTTOM_PADDING = 42;
// Column membership for the default layout. Each column packs top-to-bottom with one
// grid cell between every node (see measuredLayoutPositions).
export const LAYOUT_COLUMNS: readonly (readonly string[])[] = [
  ['atlas', 'transport'],
  ['tiling', 'analysis', 'clock'],
  ['projection', 'operator-gain-glow', 'operator-gain-metal', 'operator-gain-film', 'operator-invert-1', 'operator-gain-relief'],
  ['palette', 'material', 'postfx', 'lighting', 'edgeProfile'],
  ['renderer', 'tonemap', 'display'],
];

export function nodeFitBounds(nodes: readonly Node[]): FlowBounds | null {
  if (nodes.length === 0) return null;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    const nodeLeft = node.position.x - LAYOUT_RAIL_CLEARANCE;
    const nodeTop = node.position.y;
    const nodeRight = node.position.x + measuredWidth(node) + LAYOUT_RAIL_CLEARANCE;
    const nodeBottom = node.position.y + measuredHeight(node);
    left = Math.min(left, nodeLeft);
    top = Math.min(top, nodeTop);
    right = Math.max(right, nodeRight);
    bottom = Math.max(bottom, nodeBottom);
  }

  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) {
    return null;
  }

  return {
    height: Math.max(GRID_SIZE, bottom - top),
    width: Math.max(GRID_SIZE, right - left),
    x: left,
    y: top,
  };
}

export function alignedViewportForNodes(nodes: readonly Node[], metrics: FlowFitMetrics): FlowViewport | null {
  const bounds = nodeFitBounds(nodes);
  if (!bounds || metrics.width <= 0 || metrics.height <= 0) return null;
  const top = Math.max(FLOW_SIDE_PADDING, Math.ceil(metrics.chromeTop + FLOW_CHROME_GAP));
  const left = Math.max(FLOW_SIDE_PADDING, Math.ceil(metrics.chromeLeft + FLOW_CHROME_GAP));
  const availableWidth = Math.max(GRID_SIZE, metrics.width - left - FLOW_SIDE_PADDING);
  const availableHeight = Math.max(GRID_SIZE, metrics.height - top - FLOW_BOTTOM_PADDING);
  const zoom = clampFlowZoom(Math.min(availableWidth / bounds.width, availableHeight / bounds.height));
  return {
    x: left - bounds.x * zoom,
    y: top - bounds.y * zoom,
    zoom,
  };
}

export function applyAlignedFlowFit(
  flow: FlowFitController,
  nodes: readonly Node[],
  metrics: FlowFitMetrics,
  duration: number,
): Promise<boolean> {
  const viewport = alignedViewportForNodes(nodes, metrics);
  return viewport ? flow.setViewport(viewport, { duration }) : Promise.resolve(false);
}

export function measuredWidth(node: Node): number {
  return node.measured?.width ?? node.width ?? 320;
}

export function measuredHeight(node: Node): number {
  return node.measured?.height ?? node.height ?? 240;
}

// The grid-snapped vertical footprint a node occupies. The node card already
// self-sizes to its real content + port rail and rounds to a full grid cell
// (NodeFrame), so the measured height is authoritative — no per-node port-count
// table here. Snapping again is idempotent and a safe guard before the card has
// measured.
export function layoutAdvanceHeight(id: string, node: Node): number {
  void id;
  return snapCeilValue(measuredHeight(node));
}

export function nodeHasMeasuredSize(node: Node): boolean {
  return typeof node.measured?.width === 'number'
    && typeof node.measured.height === 'number'
    && node.measured.width > 0
    && node.measured.height > 0;
}

export function allNodesMeasured(nodes: readonly Node[]): boolean {
  return nodes.length > 0 && nodes.every(nodeHasMeasuredSize);
}

export function measuredLayoutSignature(nodes: readonly Node[]): string {
  return nodes
    .map(node => `${node.id}:${Math.round(measuredWidth(node))}x${Math.round(measuredHeight(node))}`)
    .sort()
    .join('|');
}

export function measuredLayoutPositions(nodes: readonly Node[]): Map<string, { x: number; y: number }> {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const columnWidths: number[] = Array.from({ length: LAYOUT_COLUMNS.length }, () => 0);

  for (let columnIndex = 0; columnIndex < LAYOUT_COLUMNS.length; columnIndex += 1) {
    const column = LAYOUT_COLUMNS[columnIndex] ?? [];
    for (const id of column) {
      const node = byId.get(id);
      if (!node) continue;
      columnWidths[columnIndex] = Math.max(columnWidths[columnIndex] ?? 0, measuredWidth(node));
    }
  }

  const columnX: number[] = [];
  let x = 96;
  for (const width of columnWidths) {
    columnX.push(snapValue(x));
    x += snapValue(width + LAYOUT_COLUMN_GAP + LAYOUT_RAIL_CLEARANCE);
  }

  const positions = new Map<string, { x: number; y: number }>();
  // Pack each column top-to-bottom with the SAME minimal grid-snapped gap between
  // every node — no per-section spacing — so columns read as evenly stacked, the way
  // a hand-tidied layout does. Each node advances by its grid-snapped measured height
  // plus one grid cell, so the gaps stay consistent regardless of node heights.
  const columnNextY: number[] = LAYOUT_COLUMNS.map(() => 0);
  for (let columnIndex = 0; columnIndex < LAYOUT_COLUMNS.length; columnIndex += 1) {
    let y = 0;
    for (const id of LAYOUT_COLUMNS[columnIndex] ?? []) {
      const node = byId.get(id);
      if (!node) continue;
      positions.set(id, { x: columnX[columnIndex] ?? 0, y: snapValue(y) });
      y += layoutAdvanceHeight(id, node) + GRID_SIZE;
    }
    columnNextY[columnIndex] = y;
  }

  // Dynamically-added nodes (e.g. post-FX) aren't in the fixed columns; append each
  // under the column best matching its type, with the same gap. FX nodes live in the
  // frame/post chain, so they belong in the render-sink column (renderer / tonemap /
  // display), not at the bottom of the surface + colour-mapper column.
  const renderSinkColumn = LAYOUT_COLUMNS.length - 1;
  const placed = new Set(positions.keys());
  for (const node of nodes) {
    if (placed.has(node.id)) continue;
    const type = String(node.type ?? '');
    const columnIndex = type === 'clock' ? 1 : type === 'operator' ? 2 : type === 'fx' ? renderSinkColumn : 3;
    const y = snapValue(columnNextY[columnIndex] ?? 0);
    positions.set(node.id, { x: columnX[columnIndex] ?? 0, y });
    columnNextY[columnIndex] = y + layoutAdvanceHeight(node.id, node) + GRID_SIZE;
  }
  return positions;
}

export function autoLayoutNodes<T extends Node>(nodes: readonly T[]): T[] {
  const positions = measuredLayoutPositions(nodes);
  return nodes.map(node => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }));
}
