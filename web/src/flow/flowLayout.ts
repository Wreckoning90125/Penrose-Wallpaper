// Shared flow-graph layout primitives: the viewport/bounds value types plus the
// grid-snap and zoom-clamp helpers. Kept in a neutral module (only the xyflow Node
// type) so ControlGraph's layout code and the preset (de)serialization can both
// snap positions / clamp zoom without a circular import.
import type { Node } from '@xyflow/react';

export const GRID_SIZE = 24;
export const MIN_FLOW_ZOOM = 0.18;
export const MAX_FLOW_ZOOM = 1.25;

export type FlowViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type FlowFitMetrics = {
  chromeLeft: number;
  chromeTop: number;
  height: number;
  width: number;
};

export type FlowBounds = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type FlowFitController = {
  getNodes: () => Node[];
  setViewport: (viewport: FlowViewport, options?: { duration?: number }) => Promise<boolean>;
};

export function snapValue(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

export function snapCeilValue(value: number): number {
  return Math.ceil(value / GRID_SIZE) * GRID_SIZE;
}

export function clampFlowZoom(value: number): number {
  return Math.max(MIN_FLOW_ZOOM, Math.min(MAX_FLOW_ZOOM, value));
}
