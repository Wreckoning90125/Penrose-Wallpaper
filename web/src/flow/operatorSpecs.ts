// Pure operator definitions for the control graph: the modulation-operator
// library + its lookups. No React/three — shared by the node components and the
// signal-evaluation engine. operatorKindFromData reads an operator node's wired
// `spec.kind` out of its loosely-typed data.
import { dataObject, dataString } from './nodeData';

export type OperatorKind = 'gain' | 'bias' | 'clamp' | 'smooth' | 'mix' | 'multiply' | 'add' | 'map' | 'envelope' | 'lag' | 'threshold' | 'invert' | 'math' | 'sh';

export type OperatorSelectSpec = {
  key: string;
  label: string;
  options: readonly { value: string; label: string }[];
  defaultValue: string;
};

export type OperatorSpec = {
  kind: OperatorKind;
  label: string;
  inputs: string[];
  outputs: string[];
  controls: readonly [string, string, number, number, number, number][];
  selects?: readonly OperatorSelectSpec[];
};

export const OPERATOR_LIBRARY: OperatorSpec[] = [
  { kind: 'gain', label: 'Gain', inputs: ['signal'], outputs: ['signal'], controls: [['gain', 'Gain', 0, 4, 0.01, 2]] },
  { kind: 'bias', label: 'Bias', inputs: ['signal'], outputs: ['signal'], controls: [['bias', 'Bias', -2, 2, 0.01, 2]] },
  { kind: 'clamp', label: 'Clamp', inputs: ['signal'], outputs: ['signal'], controls: [['min', 'Min', 0, 1, 0.01, 2], ['max', 'Max', 0, 1, 0.01, 2]] },
  { kind: 'smooth', label: 'Smooth', inputs: ['signal'], outputs: ['signal'], controls: [['amount', 'Amount', 0, 1, 0.01, 2]] },
  { kind: 'mix', label: 'Mix', inputs: ['a', 'b', 'mix'], outputs: ['signal'], controls: [['blend', 'Blend', 0, 1, 0.01, 2]] },
  { kind: 'multiply', label: 'Multiply', inputs: ['a', 'b'], outputs: ['signal'], controls: [['scale', 'Scale', 0, 4, 0.01, 2]] },
  { kind: 'add', label: 'Add', inputs: ['a', 'b'], outputs: ['signal'], controls: [['offset', 'Offset', -2, 2, 0.01, 2]] },
  { kind: 'map', label: 'Map range', inputs: ['signal'], outputs: ['signal'], controls: [['inMin', 'In min', 0, 1, 0.01, 2], ['inMax', 'In max', 0, 1, 0.01, 2], ['outMin', 'Out min', 0, 1, 0.01, 2], ['outMax', 'Out max', 0, 1, 0.01, 2]] },
  { kind: 'envelope', label: 'Envelope', inputs: ['gate'], outputs: ['signal'], controls: [['attack', 'Attack', 0, 2, 0.01, 2], ['release', 'Release', 0, 4, 0.01, 2]] },
  { kind: 'lag', label: 'Lag', inputs: ['signal'], outputs: ['signal'], controls: [['time', 'Time', 0, 2, 0.01, 2]] },
  { kind: 'threshold', label: 'Threshold', inputs: ['signal'], outputs: ['gate'], controls: [['threshold', 'Threshold', 0, 1, 0.01, 2]] },
  { kind: 'invert', label: 'Invert', inputs: ['signal'], outputs: ['signal'], controls: [['pivot', 'Pivot', 0, 1, 0.01, 2]] },
  {
    kind: 'math',
    label: 'Math',
    inputs: ['a', 'b'],
    outputs: ['signal'],
    controls: [['valB', 'B value', -4, 4, 0.01, 2]],
    selects: [{
      key: 'op',
      label: 'Operation',
      defaultValue: 'multiply',
      options: [
        { value: 'add', label: 'Add' },
        { value: 'subtract', label: 'Subtract' },
        { value: 'multiply', label: 'Multiply' },
        { value: 'divide', label: 'Divide' },
      ],
    }],
  },
  { kind: 'sh', label: 'Sample & hold', inputs: ['signal', 'trigger'], outputs: ['signal'], controls: [] },
];

export function isOperatorKind(value: string): value is OperatorKind {
  return OPERATOR_LIBRARY.some(item => item.kind === value);
}

export function operatorKindFromData(data: object): OperatorKind | null {
  const spec = dataObject(data, 'spec');
  if (!spec) return null;
  const kind = dataString(spec, 'kind');
  return isOperatorKind(kind) ? kind : null;
}

export function operatorSpec(kind: OperatorKind): OperatorSpec {
  const found = OPERATOR_LIBRARY.find(item => item.kind === kind);
  if (found) return found;
  const first = OPERATOR_LIBRARY.find(() => true);
  if (!first) throw new Error('operator library is empty');
  return first;
}

export type MathOperator = 'add' | 'subtract' | 'multiply' | 'divide';

export const MATH_IDENTITY: Record<MathOperator, number> = {
  add: 0,
  subtract: 0,
  multiply: 1,
  divide: 1,
};

export function isMathOperator(value: string): value is MathOperator {
  return value === 'add' || value === 'subtract' || value === 'multiply' || value === 'divide';
}
