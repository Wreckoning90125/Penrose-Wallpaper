// The graph node chrome shared by every control node: the framed card with a
// title, the IO port rails/handles, and the row-measurement hook that positions
// the xyflow handles to line up with their labels. Self-contained (React + xyflow
// + the ControlSpec type) and moved verbatim out of ControlGraph to shrink it.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Handle, Position, useNodeId, useReactFlow, useUpdateNodeInternals, type Edge, type Node } from '@xyflow/react';
import type { ControlSpec } from './controlSpecs';
import { snapCeilValue } from './flowLayout';

export type PortSpec = {
  id: string;
  label: string;
};
type PortRowRegistrar = (id: string) => (element: HTMLDivElement | null) => void;
type PortYReader = (id: string) => number | null;

type NodeFrameProps = {
  children: ReactNode;
  activeInputs?: string[] | undefined;
  activeOutputs?: string[] | undefined;
  kind: string;
  inlets?: PortSpec[];
  outlets?: PortSpec[];
  title: string;
  icon?: ReactNode;
  wide?: boolean;
  variant?: number;
};

export function portSpecsFromControls(controls: readonly ControlSpec[]): PortSpec[] {
  return controls.map(([id, label]) => ({ id, label }));
}

function portRowId(direction: 'in' | 'out', portId: string): string {
  return `${direction}:${portId}`;
}

function numberMapsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function numberMapSignature(values: Record<string, number>): string {
  return Object.keys(values)
    .sort()
    .map(key => `${key}:${values[key]}`)
    .join('|');
}

function measuredCenterY(element: HTMLElement, container: HTMLElement): number {
  let y = element.offsetHeight / 2;
  let node: HTMLElement | null = element;
  while (node && node !== container) {
    y += node.offsetTop;
    const parent: Element | null = node.offsetParent;
    node = parent instanceof HTMLElement ? parent : null;
  }
  return Math.round(y);
}

function useMeasuredPortRows(nodeId: string | null, labelsVisible: boolean) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLElement | null>>({});
  const rowCallbackRefs = useRef(new Map<string, (element: HTMLDivElement | null) => void>());
  const measureFrameRef = useRef(0);
  const scheduleMeasureRef = useRef<() => void>(() => undefined);
  const [yMap, setYMap] = useState<Record<string, number>>({});
  const [expandedYMap, setExpandedYMap] = useState<Record<string, number>>({});
  const updateNodeInternals = useUpdateNodeInternals();

  const measureNow = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const next: Record<string, number> = {};
    for (const id of Object.keys(rowRefs.current)) {
      const element = rowRefs.current[id];
      if (element) next[id] = measuredCenterY(element, container);
    }
    setYMap(current => numberMapsEqual(current, next) ? current : next);
    if (labelsVisible && Object.keys(next).length > 0) {
      setExpandedYMap(current => numberMapsEqual(current, next) ? current : next);
    }
  }, [labelsVisible]);

  const scheduleMeasure = useCallback(() => {
    if (measureFrameRef.current) return;
    measureFrameRef.current = window.requestAnimationFrame(() => {
      measureFrameRef.current = 0;
      measureNow();
    });
  }, [measureNow]);

  useEffect(() => {
    scheduleMeasureRef.current = scheduleMeasure;
  }, [scheduleMeasure]);

  const registerRow = useCallback<PortRowRegistrar>((id: string) => {
    const existing = rowCallbackRefs.current.get(id);
    if (existing) return existing;
    const callback = (element: HTMLDivElement | null) => {
      if (rowRefs.current[id] === element) return;
      rowRefs.current[id] = element;
      scheduleMeasureRef.current();
    };
    rowCallbackRefs.current.set(id, callback);
    return callback;
  }, []);

  const rowY = useCallback<PortYReader>((id: string) => yMap[id] ?? null, [yMap]);
  const expandedRowY = useCallback<PortYReader>((id: string) => expandedYMap[id] ?? null, [expandedYMap]);
  const ySignature = useMemo(() => (
    `${labelsVisible ? 'expanded' : 'collapsed'}::${numberMapSignature(yMap)}::${numberMapSignature(expandedYMap)}`
  ), [expandedYMap, labelsVisible, yMap]);

  useLayoutEffect(() => {
    measureNow();
    let frame = 0;
    let ticks = 0;
    const tick = () => {
      measureNow();
      ticks += 1;
      if (ticks < 12) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(scheduleMeasure);
      if (containerRef.current) observer.observe(containerRef.current);
      for (const id of Object.keys(rowRefs.current)) {
        const element = rowRefs.current[id];
        if (element) observer.observe(element);
      }
    }
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (measureFrameRef.current) {
        window.cancelAnimationFrame(measureFrameRef.current);
        measureFrameRef.current = 0;
      }
      observer?.disconnect();
    };
  }, [labelsVisible, measureNow, scheduleMeasure]);

  useEffect(() => {
    if (!nodeId) return;
    const frame = window.requestAnimationFrame(() => updateNodeInternals(nodeId));
    return () => window.cancelAnimationFrame(frame);
  }, [nodeId, updateNodeInternals, ySignature]);

  return { containerRef, expandedRowY, registerRow, rowY };
}

function renderPortRail(
  direction: 'in' | 'out',
  ports: readonly PortSpec[],
  activePorts: readonly string[],
  onPortPick: ((direction: 'in' | 'out', portId: string) => void) | undefined,
  registerPortRow: PortRowRegistrar,
  labelsVisible: boolean,
): ReactNode {
  if (ports.length === 0) return null;
  const active = new Set(activePorts);
  return (
    <div className={`node-port-rail ${direction === 'in' ? 'node-inlet-rail' : 'node-outlet-rail'}`}>
      {ports.map(port => {
        const populated = active.has(port.id);
        return (
          <div
            className={`node-port${populated ? ' active' : ''}`}
            key={port.id}
            ref={registerPortRow(portRowId(direction, port.id))}
          >
            <button
              type="button"
              className="node-port-label nodrag nopan"
              disabled={!populated}
              aria-label={port.label}
              onClick={() => onPortPick?.(direction, port.id)}
            >
              {labelsVisible ? <span>{port.label}</span> : null}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function renderPortHandles(
  direction: 'in' | 'out',
  ports: readonly PortSpec[],
  rowY: PortYReader,
  expandedRowY: PortYReader,
  labelsVisible: boolean,
): ReactNode {
  const firstPort = ports[0];
  const secondPort = ports[1];
  const firstKey = firstPort ? portRowId(direction, firstPort.id) : '';
  const firstExpandedY = firstPort ? expandedRowY(firstKey) : null;
  const firstMeasuredY = firstPort ? rowY(firstKey) : null;
  const anchorY = firstExpandedY ?? firstMeasuredY;
  let collapsedStep = 18;
  if (!labelsVisible && firstPort && secondPort) {
    const y0 = rowY(firstKey);
    const y1 = rowY(portRowId(direction, secondPort.id));
    if (y0 !== null && y1 !== null && y1 > y0) {
      collapsedStep = Math.max(12, Math.round(y1 - y0));
    }
  }
  return ports.map((port, index) => {
    const key = portRowId(direction, port.id);
    const measuredY = rowY(portRowId(direction, port.id));
    const expandedY = expandedRowY(key);
    const y = labelsVisible
      ? measuredY ?? expandedY ?? 54 + index * 30
      : anchorY !== null ? anchorY + index * collapsedStep : measuredY ?? 54 + index * 18;
    return (
      <Handle
        className={`rail-handle ${direction === 'in' ? 'node-inlet-handle' : 'node-outlet-handle'}`}
        id={port.id}
        key={`${direction}-${port.id}`}
        position={direction === 'in' ? Position.Left : Position.Right}
        style={{ top: y }}
        type={direction === 'in' ? 'target' : 'source'}
      />
    );
  });
}

export function NodeFrame({
  children,
  activeInputs = [],
  activeOutputs = [],
  inlets = [],
  outlets = [],
  kind,
  title,
  icon,
  wide = false,
  variant = 0,
}: NodeFrameProps) {
  const flow = useReactFlow<Node, Edge>();
  const nodeId = useNodeId();
  const portCycleRef = useRef(new Map<string, number>());
  const [portLabelsVisible, setPortLabelsVisible] = useState(true);
  const hasPorts = inlets.length > 0 || outlets.length > 0;
  const railClass = `${inlets.length > 0 ? ' has-inlet-rail' : ''}${outlets.length > 0 ? ' has-outlet-rail' : ''}`;
  const portLabelClass = portLabelsVisible ? '' : ' ports-collapsed';
  const { containerRef, expandedRowY, registerRow, rowY } = useMeasuredPortRows(nodeId, portLabelsVisible);
  // Self-size to the node's real footprint and round up to a full grid cell, so a
  // short node always contains its (taller) port rail AND vertical gaps stay
  // uniform. Generic: it measures the actual rendered content + rails — no per-node
  // port-count table — so it just works for any new node or new node content.
  const [autoMinHeight, setAutoMinHeight] = useState(0);
  useLayoutEffect(() => {
    const card = containerRef.current;
    if (!card) return undefined;
    const measure = (): void => {
      let bottom = 0;
      for (const child of Array.from(card.children)) {
        if (!(child instanceof HTMLElement)) continue;
        if (child.classList.contains('rail-handle')) continue;
        const isRail = child.classList.contains('node-port-rail');
        if (!isRail && window.getComputedStyle(child).position === 'absolute') continue;
        bottom = Math.max(bottom, child.offsetTop + child.offsetHeight);
      }
      if (bottom <= 0) return;
      const target = snapCeilValue(bottom + 8);
      setAutoMinHeight(prev => (prev === target ? prev : target));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    for (const child of Array.from(card.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [containerRef, portLabelsVisible, inlets.length, outlets.length]);
  const pickPortEdge = useCallback((direction: 'in' | 'out', portId: string) => {
    if (!nodeId) return;
    const connected = flow.getEdges().filter(edge => (
      direction === 'in'
        ? edge.target === nodeId && edge.targetHandle === portId
        : edge.source === nodeId && edge.sourceHandle === portId
    ));
    if (connected.length === 0) return;
    const key = `${nodeId}:${direction}:${portId}`;
    const selectedIndex = connected.findIndex(edge => edge.selected);
    const storedIndex = portCycleRef.current.get(key) ?? 0;
    const index = selectedIndex >= 0 ? (selectedIndex + 1) % connected.length : storedIndex % connected.length;
    const selectedEdgeId = connected[index]?.id;
    if (!selectedEdgeId) return;
    portCycleRef.current.set(key, (index + 1) % connected.length);
    flow.setEdges(current => current.map(edge => ({
      ...edge,
      selected: edge.id === selectedEdgeId,
    })));
  }, [flow, nodeId]);
  return (
    <div ref={containerRef} className={`flow-node control-node node-kind-${kind} node-variant-${variant}${wide ? ' wide-node' : ''}${railClass}${portLabelClass}`} style={autoMinHeight > 0 ? { minHeight: autoMinHeight } : undefined}>
      {renderPortRail('in', inlets, activeInputs, pickPortEdge, registerRow, portLabelsVisible)}
      {renderPortRail('out', outlets, activeOutputs, pickPortEdge, registerRow, portLabelsVisible)}
      {renderPortHandles('in', inlets, rowY, expandedRowY, portLabelsVisible)}
      {renderPortHandles('out', outlets, rowY, expandedRowY, portLabelsVisible)}
      <div className="flow-node-title">
        {hasPorts ? (
          <button
            type="button"
            className="port-label-toggle nodrag nopan"
            aria-label={portLabelsVisible ? 'Hide port labels' : 'Show port labels'}
            title={portLabelsVisible ? 'Hide port labels' : 'Show port labels'}
            onClick={() => setPortLabelsVisible(value => !value)}
          >
            IO
          </button>
        ) : null}
        {icon ? <span className="flow-node-icon" title={title} aria-hidden="true">{icon}</span> : null}
        <strong>{title}</strong>
      </div>
      {children}
    </div>
  );
}

// Fixed inlet specs for the renderer (scene + lighting) and display (frame) sink
// nodes — referenced by both those node components and the layout port counter.
export const SCENE_PASS_INLETS: PortSpec[] = [
  { id: 'surface', label: 'Surface' },
  { id: 'lighting', label: 'Lighting' },
  { id: 'displace', label: 'Displace' },
  { id: 'relief', label: 'Relief' },
  { id: 'color', label: 'Color' },
  { id: 'undulate', label: 'Undulate' },
  { id: 'border', label: 'Border' },
];

export const DISPLAY_INLETS: PortSpec[] = [{ id: 'frame', label: 'Frame' }];
