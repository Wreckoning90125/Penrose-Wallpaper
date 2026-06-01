// The render is downstream of the graph: derive, from edges alone, which renderer
// inputs are actually connected. Pure — nodes/edges in, RenderInputs out — so the
// renderer is a function of graph topology. geometry follows the whole source->
// sink chain; the side inlets (lighting / color / material / projection) each have
// their own distinct consequence when cut. Cut a wire and its input stops.
import type { Edge, Node } from '@xyflow/react';
import type { RenderInputs } from '../types';

const FIELD_SOURCE_PHASE_HANDLE = 'phase';

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
  const fieldSourceIds = nodes
    .filter(node => node.id === 'postfx' || node.type === 'fieldSource')
    .map(node => node.id);
  const fieldOutput = (handle: string): boolean =>
    fieldSourceIds.some(id => link(id, handle, 'renderer', handle));
  const fieldOutputFrom = (id: string, handle: string): boolean =>
    link(id, handle, 'renderer', handle);
  const materialDirect = (handle: string): boolean =>
    link('material', handle, 'renderer', handle);
  const materialViaFieldFrom = (id: string, handle: string): boolean =>
    link('material', handle, id, handle) && link(id, handle, 'renderer', handle);
  const materialViaField = (handle: string): boolean =>
    fieldSourceIds.some(id => materialViaFieldFrom(id, handle));
  // Color and relief are real Surface Material lanes. A Field Source can sit in
  // the middle and add modulation, but deleting it may be bypassed by wiring the
  // material lane straight into the Scene Pass.
  const materialColor = materialDirect('color') || materialViaField('color');
  const materialRelief = materialDirect('relief') || materialViaField('relief');
  // Field-source outlets are the procedural fields. Cut one and only that field
  // stops at the surface; material color/relief can still bypass separately.
  const fieldDisplace = fieldOutput('displace');
  const fieldRelief = materialViaField('relief');
  const fieldColor = materialViaField('color');
  const fieldUndulate = fieldOutput('undulate');
  const defaultFieldActive = fieldOutputFrom('postfx', 'displace')
    || materialViaFieldFrom('postfx', 'relief')
    || materialViaFieldFrom('postfx', 'color')
    || fieldOutputFrom('postfx', 'undulate');
  const fieldPhase = link('clock', 'out', 'postfx', FIELD_SOURCE_PHASE_HANDLE) && defaultFieldActive;
  // The Border node wires its single outlet to the renderer; cut it and the edge
  // mesh stops rendering.
  const border = link('edgeProfile', 'border', 'renderer', 'border');
  return { geometry: renderChainConnected(nodes, edges), lighting, color, material, materialColor, materialRelief, projection, fieldDisplace, fieldRelief, fieldColor, fieldUndulate, fieldPhase, border };
}
