// The render is downstream of the graph: derive, from edges alone, which renderer
// inputs are actually connected. Pure — nodes/edges in, RenderInputs out — so the
// renderer is a function of graph topology. geometry follows the whole source->
// sink chain; the side inlets (lighting / color / material / projection) each have
// their own distinct consequence when cut. Cut a wire and its input stops.
import type { Edge, Node } from '@xyflow/react';
import type { RenderInputs } from '../types';

export function renderChainConnected(nodes: readonly Node[], edges: readonly Edge[]): boolean {
  const link = (source: string, sourceHandle: string, target: string, targetHandle: string): boolean =>
    edges.some(edge => edge.source === source && edge.sourceHandle === sourceHandle
      && edge.target === target && edge.targetHandle === targetHandle);
  // palette->material:color (drops color), material->renderer:surface (neutral
  // material), and projection->palette (flat Euclidean) each have their OWN
  // distinct consequence, so they are NOT in the geometry chain. The geometry
  // chain is the source path atlas->tiling->projection plus the frame chain.
  const surface = link('atlas', 'out', 'tiling', 'in')
    && link('tiling', 'out', 'projection', 'in');
  if (!surface) return false;
  const byId = new Map(nodes.map(node => [node.id, node]));
  const incomingFrame = (id: string): Edge | undefined =>
    edges.find(edge => edge.target === id && edge.targetHandle === 'frame');
  let cursor = incomingFrame('display')?.source;
  const seen = new Set<string>();
  for (let i = 0; i < 64 && cursor && !seen.has(cursor); i += 1) {
    if (cursor === 'renderer') return true;
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node || node.type !== 'fx') return false;
    cursor = incomingFrame(cursor)?.source;
  }
  return false;
}

export function renderInputsFromEdges(nodes: readonly Node[], edges: readonly Edge[]): RenderInputs {
  const link = (source: string, sourceHandle: string, target: string, targetHandle: string): boolean =>
    edges.some(edge => edge.source === source && edge.sourceHandle === sourceHandle
      && edge.target === target && edge.targetHandle === targetHandle);
  const lighting = link('lighting', 'out', 'renderer', 'lighting');
  const color = link('palette', 'color', 'material', 'color');
  const material = link('material', 'surface', 'renderer', 'surface');
  const projection = link('projection', 'out', 'palette', 'in');
  // The field-source node emits three fields on three outlets; each wires into
  // its own renderer inlet. Cut one and only that field stops at the surface.
  const fieldDisplace = link('postfx', 'displace', 'renderer', 'displace');
  const fieldRelief = link('postfx', 'relief', 'renderer', 'relief');
  const fieldColor = link('postfx', 'color', 'renderer', 'color');
  return { geometry: renderChainConnected(nodes, edges), lighting, color, material, projection, fieldDisplace, fieldRelief, fieldColor };
}
