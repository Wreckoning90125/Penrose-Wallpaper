// The control graph's edge layer: per-node-kind colours, the gradient edge
// component (a bezier stroked with a source→target colour gradient, dimmed/
// highlighted by its data), and the edgeTypes map the ControlGraph hands to xyflow.
import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';

const NODE_TYPE_COLORS: Record<string, string> = {
  atlas: '#b99228',
  tiling: '#b99228',
  palette: '#c7682e',
  projection: '#3e83a8',
  material: '#a66f35',
  lighting: '#a66f35',
  postfx: '#a66f35',
  transport: '#3a9d75',
  analysis: '#3a9d75',
  clock: '#3a9d75',
  operator: '#756ed0',
  renderer: '#8764bc',
  display: '#8764bc',
};

export function nodeColor(type: string): string {
  return NODE_TYPE_COLORS[type] ?? '#69717e';
}

function edgeGradientId(id: string): string {
  return `edge-gradient-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

type GradientEdgeState = {
  dimmed: boolean;
  selected: boolean;
};
export type GradientEdgeData = GradientEdgeState & Record<'sourceColor' | 'targetColor', string>;
export type GradientEdgeModel = Edge<GradientEdgeData, 'gradient'>;

function GradientEdge({
  id,
  selected,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps<GradientEdgeModel>) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const gradientId = edgeGradientId(id);
  const sourceColor = data?.sourceColor ?? nodeColor('');
  const targetColor = data?.targetColor ?? nodeColor('');
  const isSelected = data?.selected ?? selected ?? false;
  const isDimmed = data?.dimmed ?? false;
  const edgeStyle = {
    ...style,
    stroke: `url(#${gradientId})`,
    strokeOpacity: isDimmed ? 0.24 : 1,
    strokeWidth: isSelected ? 3 : 1.65,
    filter: isSelected ? `drop-shadow(0 0 5px ${targetColor})` : undefined,
  };
  return (
    <>
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
          <stop offset="0%" stopColor={sourceColor} />
          <stop offset="100%" stopColor={targetColor} />
        </linearGradient>
      </defs>
      {markerEnd ? (
        <BaseEdge id={id} path={path} markerEnd={markerEnd} style={edgeStyle} />
      ) : (
        <BaseEdge id={id} path={path} style={edgeStyle} />
      )}
    </>
  );
}

export const edgeTypes = {
  gradient: GradientEdge,
};
