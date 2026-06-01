import type { Edge } from '@xyflow/react';

export const MATERIAL_LANE_HANDLES = ['relief', 'color'] as const;
const MATERIAL_LANE_HANDLE_SET = new Set<string>(MATERIAL_LANE_HANDLES);

export function isMaterialLaneHandle(handle: string | null | undefined): handle is typeof MATERIAL_LANE_HANDLES[number] {
  return handle !== null && handle !== undefined && MATERIAL_LANE_HANDLE_SET.has(handle);
}

export function spliceMaterialFieldBypasses(edges: Edge[], fieldNodeId: string): Edge[] {
  const next = edges.filter(edge => edge.source !== fieldNodeId && edge.target !== fieldNodeId);
  for (const handle of MATERIAL_LANE_HANDLES) {
    const hasMaterialInput = edges.some(edge => (
      edge.source === 'material'
      && edge.sourceHandle === handle
      && edge.target === fieldNodeId
      && edge.targetHandle === handle
    ));
    const hasRendererOutput = edges.some(edge => (
      edge.source === fieldNodeId
      && edge.sourceHandle === handle
      && edge.target === 'renderer'
      && edge.targetHandle === handle
    ));
    const alreadyBypassed = next.some(edge => (
      edge.source === 'material'
      && edge.sourceHandle === handle
      && edge.target === 'renderer'
      && edge.targetHandle === handle
    ));
    if (hasMaterialInput && hasRendererOutput && !alreadyBypassed) {
      next.push({
        id: `material-renderer-${handle}`,
        source: 'material',
        sourceHandle: handle,
        target: 'renderer',
        targetHandle: handle,
        animated: true,
      });
    }
  }
  return next;
}
