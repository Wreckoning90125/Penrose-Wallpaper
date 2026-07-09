import type { Edge, Node } from '@xyflow/react';
import { fxDescriptor } from '../render/postFxCatalog';
import type { PostChainSpec } from '../types';
import { FIELD_SOURCE_PHASE_INLET } from './fieldSourceSpec';
import { isMaterialLaneHandle } from './materialLanes';
import { dataBoolean, dataObject, dataString, numberRecordFromObject, stringRecordFromObject } from './nodeData';
import { isSignalSource, isSignalTarget } from './signalUtils';

const DEFAULT_FIELD_HANDLES = new Set(['displace', 'relief', 'color', 'undulate']);
const ADDABLE_FIELD_HANDLES = new Set(['relief', 'undulate', 'color']);

export type GraphConnectionLike = {
  source: string | null;
  sourceHandle?: string | null;
  target: string | null;
  targetHandle?: string | null;
};

function nodeById(nodes: readonly Node[], id: string | null): Node | null {
  if (!id) return null;
  return nodes.find(node => node.id === id) ?? null;
}

function isMaterialLaneSource(connection: GraphConnectionLike): boolean {
  return connection.source === 'material'
    && isMaterialLaneHandle(connection.sourceHandle);
}

function isDefaultFieldConnection(connection: GraphConnectionLike): boolean {
  const sourceHandle = connection.sourceHandle ?? null;
  return connection.source === 'postfx'
    && connection.target === 'renderer'
    && sourceHandle !== null
    && sourceHandle === (connection.targetHandle ?? null)
    && DEFAULT_FIELD_HANDLES.has(sourceHandle);
}

function isSignalConnection(connection: GraphConnectionLike, nodes: readonly Node[]): boolean {
  const source = nodeById(nodes, connection.source);
  const target = nodeById(nodes, connection.target);
  const sourceHandle = connection.sourceHandle ?? null;
  const targetHandle = connection.targetHandle ?? null;
  return !!source && !!target && isSignalSource(source, sourceHandle) && isSignalTarget(target, targetHandle);
}

function isFrameConnection(connection: GraphConnectionLike, nodes: readonly Node[]): boolean {
  const source = nodeById(nodes, connection.source);
  const target = nodeById(nodes, connection.target);
  const sourceHandle = connection.sourceHandle ?? null;
  const targetHandle = connection.targetHandle ?? null;
  if (!source || !target || sourceHandle !== 'frame' || targetHandle !== 'frame') return false;
  return (source.id === 'renderer' || source.type === 'fx') && (target.id === 'display' || target.type === 'fx');
}

function wouldCreateCycle(
  connection: GraphConnectionLike,
  nodes: readonly Node[],
  edges: readonly Edge[],
  accepts: (item: GraphConnectionLike, graphNodes: readonly Node[]) => boolean,
): boolean {
  if (!connection.source || !connection.target || !accepts(connection, nodes)) return false;
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!accepts(edge, nodes)) continue;
    const targets = adjacency.get(edge.source) ?? [];
    targets.push(edge.target);
    adjacency.set(edge.source, targets);
  }
  const targets = adjacency.get(connection.source) ?? [];
  targets.push(connection.target);
  adjacency.set(connection.source, targets);
  const seen = new Set<string>();
  const stack = [connection.target];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === connection.source) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of adjacency.get(id) ?? []) stack.push(next);
  }
  return false;
}

function wouldCreateSignalCycle(connection: GraphConnectionLike, nodes: readonly Node[], edges: readonly Edge[]): boolean {
  return wouldCreateCycle(connection, nodes, edges, isSignalConnection);
}

function wouldCreateFrameCycle(connection: GraphConnectionLike, nodes: readonly Node[], edges: readonly Edge[]): boolean {
  return wouldCreateCycle(connection, nodes, edges, isFrameConnection);
}

function isValidGraphConnection(connection: GraphConnectionLike, nodes: readonly Node[]): boolean {
  const source = nodeById(nodes, connection.source);
  const target = nodeById(nodes, connection.target);
  const sourceHandle = connection.sourceHandle ?? null;
  const targetHandle = connection.targetHandle ?? null;
  if (!source || !target || source.id === target.id || !sourceHandle || !targetHandle) return false;

  if (source.id === 'atlas') return sourceHandle === 'out' && target.id === 'tiling' && targetHandle === 'in';
  if (source.id === 'tiling') return sourceHandle === 'out' && target.id === 'projection' && targetHandle === 'in';
  if (source.id === 'projection') return sourceHandle === 'out' && target.id === 'palette' && targetHandle === 'in';
  if (source.id === 'palette') return sourceHandle === 'color' && target.id === 'material' && targetHandle === 'color';
  if (source.id === 'material') {
    if (sourceHandle === 'surface') return target.id === 'renderer' && targetHandle === 'surface';
    if (isMaterialLaneHandle(sourceHandle)) {
      return targetHandle === sourceHandle
        && (
          target.id === 'renderer'
          || target.id === 'postfx'
          || target.type === 'fieldSource'
        );
    }
    return false;
  }
  if (source.id === 'lighting') return sourceHandle === 'out' && target.id === 'renderer' && targetHandle === 'lighting';
  if (source.id === 'ifs') return sourceHandle === 'points' && target.id === 'renderer' && targetHandle === 'attractor';
  if (source.id === 'postfx') return isDefaultFieldConnection(connection);
  if (source.id === 'edgeProfile') return sourceHandle === 'border' && target.id === 'renderer' && targetHandle === 'border';
  if (source.id === 'clock' && sourceHandle === 'out' && targetHandle === FIELD_SOURCE_PHASE_INLET.id) {
    // Field-source phase inlets are clock-only transports; the lighting
    // choreography phase inlet shares the handle id but is a generic signal
    // target (any source may drive it — see isSignalTarget).
    return target.id === 'postfx' || target.type === 'fieldSource' || target.id === 'lighting';
  }
  if (source.type === 'fieldSource') {
    return target.id === 'renderer' && sourceHandle === targetHandle && ADDABLE_FIELD_HANDLES.has(sourceHandle);
  }
  if (source.id === 'transport') return sourceHandle === 'out' && target.id === 'analysis' && targetHandle === 'transport';

  if (sourceHandle === 'frame' && targetHandle === 'frame') {
    const sourceIsFrame = source.id === 'renderer' || source.type === 'fx';
    const targetIsFrame = target.id === 'display' || target.type === 'fx';
    return sourceIsFrame && targetIsFrame;
  }

  return isSignalSource(source, sourceHandle) && isSignalTarget(target, targetHandle);
}

export function canAddGraphConnection(connection: GraphConnectionLike, nodes: readonly Node[], edges: readonly Edge[]): boolean {
  return isValidGraphConnection(connection, nodes)
    && !wouldCreateSignalCycle(connection, nodes, edges)
    && !wouldCreateFrameCycle(connection, nodes, edges);
}

export function edgeConflictsWithConnection(edge: Edge, connection: GraphConnectionLike): boolean {
  return (edge.target === connection.target && edge.targetHandle === connection.targetHandle)
    || (connection.sourceHandle === 'frame' && edge.source === connection.source && edge.sourceHandle === connection.sourceHandle)
    || (isMaterialLaneSource(connection) && edge.source === 'material' && edge.sourceHandle === connection.sourceHandle);
}

export function edgesWithoutConnectionConflicts(edges: readonly Edge[], connection: GraphConnectionLike): Edge[] {
  return edges.filter(edge => !edgeConflictsWithConnection(edge, connection));
}

export function derivePostChain(nodes: readonly Node[], edges: readonly Edge[]): PostChainSpec {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const incomingFrame = (id: string): Edge | undefined =>
    edges.find(edge => edge.target === id && edge.targetHandle === 'frame');
  const chain: PostChainSpec = [];
  const seen = new Set<string>();
  let cursor = incomingFrame('display')?.source;
  for (let i = 0; i < 64 && cursor && !seen.has(cursor); i += 1) {
    if (cursor === 'renderer') return chain.reverse();
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node || node.type !== 'fx') break;
    const values = numberRecordFromObject(dataObject(node.data, 'values'));
    chain.push({
      id: node.id,
      kind: dataString(node.data, 'kind'),
      bypass: dataBoolean(node.data, 'bypass'),
      params: values,
      selects: stringRecordFromObject(dataObject(node.data, 'selects')),
    });
    cursor = incomingFrame(node.id)?.source;
  }
  return [];
}

export function domainMismatchedFxIds(nodes: readonly Node[], edges: readonly Edge[]): Set<string> {
  const warned = new Set<string>();
  const chain = derivePostChain(nodes, edges);
  let pastToneMap = false;
  for (const node of chain) {
    if (node.kind === 'toneMap') { pastToneMap = pastToneMap || !node.bypass; continue; }
    if (pastToneMap && fxDescriptor(node.kind)?.domain === 'linear') warned.add(node.id);
  }
  return warned;
}
