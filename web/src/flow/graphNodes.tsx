// The xyflow node components for the control graph — one memo'd presentational
// component per node kind. Each takes its data via NodeComponentProps<TData> and
// renders a NodeFrame with its controls; no closure over the orchestrator, so they
// live here and the ControlGraph component just maps them in its nodeTypes.
import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useReactFlow, type Edge, type Node } from '@xyflow/react';
import {
  Clock,
  Mic,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  SkipBack,
  Square,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import { MultiSwitch } from './MultiSwitch';
import { RangeControl } from './RangeControl';
import { DISPLAY_INLETS, NodeFrame, SCENE_PASS_INLETS, portSpecsFromControls } from './nodeFrame';
import { MeterOutlet, drawWheel, formatTime, settingRangeHandlers, settingWithLiveBoost } from './nodeHelpers';
import { FAMILIES, familyByValue, seedLabel } from '../tiling/families';
import { dataObject, numberRecordFromObject, stringRecordFromObject } from './nodeData';
import { fxDescriptor } from '../render/postFxCatalog';
import {
  CLOCK_CONTROLS,
  BORDER_CONTROLS,
  LIGHT_CONTROLS,
  MATERIAL_CONTROLS,
  PROJECTION_CONTROLS,
  RIPPLE_TARGET_CONTROLS,
} from './controlSpecs';
import { MATH_IDENTITY, isMathOperator } from './operatorSpecs';
import { intSetting } from '../settings/androidSettings';
import { MAX_COLORS, oklchCss, type Oklch } from '../color/palette';
import type { AudioSnapshot } from '../types';

import type {
  AtlasNodeData,
  AudioAnalysisNodeData,
  AudioTransportNodeData,
  ClockNodeData,
  DisplayNodeData,
  FxNodeData,
  NodeComponentProps,
  OperatorNodeData,
  PaletteNodeData,
  ProjectionNodeData,
  RendererNodeData,
  SettingsNodeData,
  TilingNodeData,
} from './graphNodeData';

type WheelPointer = {
  clientX: number;
  clientY: number;
};

function oklch(l: number, c: number, h: number): Oklch {
  return [l, c, h];
}

const PALETTE_NAMES = [
  'B&W',
  'Greys',
  'Prism',
  'Paper',
  'Gold',
  'Rust',
  'Plum',
  'Cobalt',
  'Sage',
  'Spectra',
  'Girih',
  'Custom',
];

export const AtlasNode = memo(function AtlasNode({ data }: NodeComponentProps<AtlasNodeData>) {
  return (
    <NodeFrame
      title="Curated renders"
      kind="source"
      wide
      variant={0}
      outlets={[{ id: 'out', label: 'Out' }]}
      activeOutputs={data.activeOutputs}
    >
      <div className="control-grid">
        <label className="nodrag nopan">
          <span>Category</span>
          <select value={data.categoryId} onChange={event => data.onCategory(event.target.value)}>
            {data.categories.map(category => (
              <option key={category.id} value={category.id}>{category.label}</option>
            ))}
          </select>
        </label>
        <label className="nodrag nopan">
          <span>Render</span>
          <select value={data.targetId} onChange={event => data.onTarget(event.target.value)}>
            {data.targetId === data.currentValue ? <option value={data.currentValue}>Current graph controls</option> : null}
            {data.items.map(item => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
      </div>
    </NodeFrame>
  );
});

export const TilingNode = memo(function TilingNode({ data }: NodeComponentProps<TilingNodeData>) {
  const family = familyByValue(data.settings.family);
  return (
    <NodeFrame
      title="Tiling source"
      kind="source"
      wide
      variant={1}
      inlets={[{ id: 'in', label: 'In' }, { id: 'generation', label: 'Gen' }]}
      outlets={[{ id: 'out', label: 'Out' }]}
      activeInputs={data.activeInputs}
      activeOutputs={data.activeOutputs}
    >
      <div className="node-subtitle">{family.label} / {seedLabel(data.settings.family, data.settings.seed)}</div>
      <div className="control-grid">
        <label className="nodrag nopan">
          <span>Family</span>
          <select value={String(data.settings.family)} onChange={event => data.onFamily(event.target.value)}>
            {FAMILIES.map(item => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="nodrag nopan">
          <span>Seed</span>
          <select value={String(data.settings.seed)} onChange={event => data.onSetting('seed', event.target.value)}>
            {data.seedOptions.map(item => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <RangeControl
          label="Generation"
          value={Number(data.settings.generation)}
          min={0}
          max={data.maxGeneration}
          step={1}
          paramKey="generation"
          onBeginEdit={data.onBeginEdit}
          onChange={value => data.onSetting('generation', value)}
          onEndEdit={data.onEndEdit}
        />
      </div>
    </NodeFrame>
  );
});

export const PaletteNode = memo(function PaletteNode({ data }: NodeComponentProps<PaletteNodeData>) {
  const wheelRef = useRef<HTMLCanvasElement | null>(null);
  const selected = data.selectedColorValue;

  useEffect(() => {
    drawWheel(wheelRef.current, selected);
  }, [selected]);

  const applyWheel = (event: WheelPointer) => {
    const canvas = wheelRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * 2 - 1;
    const y = (event.clientY - rect.top) / rect.height * 2 - 1;
    const radius = Math.min(1, Math.hypot(x, y));
    const hue = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    data.onCustomColor(color => oklch(color[0], radius * 0.37, hue));
  };

  return (
    <NodeFrame
      title="Color mapper"
      kind="color"
      wide
      variant={0}
      inlets={[
        { id: 'in', label: 'Projection' },
        { id: 'color_count', label: 'Slots' },
        { id: 'luminance', label: 'Lum' },
      ]}
      outlets={[{ id: 'color', label: 'Color' }]}
      activeInputs={data.activeInputs}
      activeOutputs={data.activeOutputs}
    >
      <div className="control-grid two-col projection-control-grid">
        <label className="nodrag nopan">
          <span>Palette</span>
          <select value={String(data.settings.preset)} onChange={event => data.onPalette(event.target.value)}>
            {PALETTE_NAMES.map((name, idx) => (
              <option key={name} value={String(idx)}>{name}</option>
            ))}
          </select>
        </label>
        <RangeControl
          label="Slots"
          value={data.colorCount}
          min={2}
          max={MAX_COLORS}
          step={1}
          paramKey="color_count"
          onBeginEdit={data.onBeginEdit}
          onChange={value => data.onPreviewSetting('color_count', value)}
          onCommit={value => data.onSetting('color_count', value)}
          onEndEdit={data.onEndEdit}
        />
      </div>
      <div className="segmented nodrag nopan">
        {['Type', 'Orient', 'Ring'].map((label, idx) => (
          <button
            key={label}
            type="button"
            className={intSetting(data.settings, 'color_mode', 0, 2) === idx ? 'active' : ''}
            onClick={() => data.onSetting('color_mode', String(idx))}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="swatches nodrag nopan">
        {data.palette.colors.slice(0, data.colorCount).map((color, idx) => (
          <button
            type="button"
            className={`swatch${idx === data.selectedColor ? ' active' : ''}`}
            style={{ background: oklchCss(color) }}
            title={`Color ${idx + 1}`}
            key={`${idx}-${color.join(':')}`}
            onClick={() => data.onSelectedColor(idx)}
          />
        ))}
      </div>
      <div className="color-editor nodrag nopan">
        <canvas
          ref={wheelRef}
          id="colorWheel"
          width="220"
          height="220"
          aria-label="OKLCH hue and chroma selector"
          onPointerDown={event => {
            event.currentTarget.setPointerCapture(event.pointerId);
            applyWheel(event);
          }}
          onPointerMove={event => {
            if (event.buttons) applyWheel(event);
          }}
        />
        <RangeControl
          label="Luminance"
          value={selected[0]}
          min={0}
          max={1}
          step={0.001}
          digits={3}
          paramKey={`custom_color_${data.selectedColor}_luminance`}
          onBeginEdit={data.onBeginEdit}
          onChange={value => data.onCustomColor(color => oklch(value, color[1], color[2]))}
          onEndEdit={data.onEndEdit}
        />
        <div className="gamut">{data.gamut}</div>
      </div>
    </NodeFrame>
  );
});

export const MaterialNode = memo(function MaterialNode({ data }: NodeComponentProps<SettingsNodeData>) {
  return (
    <NodeFrame
      title="Surface material"
      kind="surface"
      wide
      variant={0}
      inlets={[
        { id: 'color', label: 'Color' },
        ...portSpecsFromControls(MATERIAL_CONTROLS),
      ]}
      outlets={[{ id: 'surface', label: 'Surface' }]}
      activeInputs={data.activeInputs}
      activeOutputs={data.activeOutputs}
    >
      <div className="control-grid two-col">
        {MATERIAL_CONTROLS.map(([key, label, min, max, step]) => {
          const handlers = settingRangeHandlers(data, key);
          return (
            <RangeControl
              key={key}
              label={label}
              value={intSetting(data.settings, key, min, max)}
              min={min}
              max={max}
              step={step}
              paramKey={key}
              onBeginEdit={data.onBeginEdit}
              onChange={handlers.onChange}
              onCommit={handlers.onCommit}
              onEndEdit={data.onEndEdit}
            />
          );
        })}
      </div>
    </NodeFrame>
  );
});

export const LightingNode = memo(function LightingNode({ data }: NodeComponentProps<SettingsNodeData>) {
  return (
    <NodeFrame
      title="Lighting"
      kind="surface"
      wide
      variant={1}
      inlets={portSpecsFromControls(LIGHT_CONTROLS)}
      outlets={[{ id: 'out', label: 'Out' }]}
      activeInputs={data.activeInputs}
      activeOutputs={data.activeOutputs}
    >
      <div className="control-grid two-col">
        {LIGHT_CONTROLS.map(([key, label, min, max, step]) => {
          const handlers = settingRangeHandlers(data, key);
          return (
            <RangeControl
              key={key}
              label={label}
              value={intSetting(data.settings, key, min, max)}
              min={min}
              max={max}
              step={step}
              paramKey={key}
              onBeginEdit={data.onBeginEdit}
              onChange={handlers.onChange}
              onCommit={handlers.onCommit}
              onEndEdit={data.onEndEdit}
            />
          );
        })}
      </div>
    </NodeFrame>
  );
});

export const EdgeProfileNode = memo(function EdgeProfileNode({ data }: NodeComponentProps<SettingsNodeData>) {
  const borderOn = String(data.settings.border_on) !== 'false';
  return (
    <NodeFrame title="Border" kind="surface" wide variant={0}>
      <div className="segmented two nodrag nopan">
        <button type="button" className={borderOn ? 'active' : ''} onClick={() => data.onSetting('border_on', 'true')}>On</button>
        <button type="button" className={!borderOn ? 'active' : ''} onClick={() => data.onSetting('border_on', 'false')}>Off</button>
      </div>
      <div className="control-grid two-col">
        {BORDER_CONTROLS.map(([key, label, min, max, step]) => {
          const handlers = settingRangeHandlers(data, key);
          return (
            <RangeControl
              key={key}
              label={label}
              value={intSetting(data.settings, key, min, max)}
              min={min}
              max={max}
              step={step}
              paramKey={key}
              onBeginEdit={data.onBeginEdit}
              onChange={handlers.onChange}
              onCommit={handlers.onCommit}
              onEndEdit={data.onEndEdit}
            />
          );
        })}
      </div>
    </NodeFrame>
  );
});

export const ProjectionNode = memo(function ProjectionNode({ data }: NodeComponentProps<ProjectionNodeData>) {
  const liveBoost = useSyncExternalStore(
    data.liveBoostStore.subscribe,
    data.liveBoostStore.getSnapshot,
    data.liveBoostStore.getSnapshot,
  );
  const displayedSettings = settingWithLiveBoost(data.settings, liveBoost);
  return (
    <NodeFrame
      title="Projection"
      kind="geometry"
      wide
      variant={0}
      inlets={[{ id: 'in', label: 'In' }, ...portSpecsFromControls(PROJECTION_CONTROLS)]}
      outlets={[{ id: 'out', label: 'Out' }]}
      activeInputs={data.activeInputs}
      activeOutputs={data.activeOutputs}
    >
      <div className="segmented two projection-mode-row nodrag nopan">
        <button
          type="button"
          className={String(data.settings.projection) === '0' ? 'active' : ''}
          onClick={() => data.onSetting('projection', '0')}
        >
          Euclidean
        </button>
        <button
          type="button"
          className={String(data.settings.projection) === '1' ? 'active' : ''}
          onClick={() => data.onSetting('projection', '1')}
        >
          Poincare disk
        </button>
      </div>
      <div className="control-grid two-col">
        {PROJECTION_CONTROLS.map(([key, label, min, max, step]) => {
          const handlers = settingRangeHandlers(data, key);
          return (
            <RangeControl
              key={key}
              label={label}
              value={intSetting(displayedSettings, key, min, max)}
              min={min}
              max={max}
              step={step}
              paramKey={key}
              onBeginEdit={data.onBeginEdit}
              onChange={handlers.onChange}
              onCommit={handlers.onCommit}
              onEndEdit={data.onEndEdit}
            />
          );
        })}
      </div>
      <div className="button-row projection-actions nodrag nopan">
        <button type="button" onClick={data.onResetBoost}>Center boost</button>
        <button type="button" onClick={data.onResetView}>Reset view</button>
      </div>
    </NodeFrame>
  );
});

export const ClockNode = memo(function ClockNode({ data }: NodeComponentProps<ClockNodeData>) {
  const flow = useReactFlow<Node, Edge>();
  const enabled = String(data.settings.clock_enabled ?? '1') !== '0';
  const deleteClock = useCallback(() => {
    const nodeId = data.id;
    if (!nodeId || !data.deletable) return;
    flow.setNodes(current => current.filter(node => node.id !== nodeId));
    flow.setEdges(current => current.filter(edge => edge.source !== nodeId && edge.target !== nodeId));
  }, [data.deletable, data.id, flow]);
  return (
    <NodeFrame
      title="Clock source"
      kind="signal"
      variant={0}
      inlets={[]}
      outlets={[{ id: 'out', label: 'Out' }]}
      activeInputs={data.activeInputs}
      activeOutputs={data.activeOutputs}
    >
      {data.deletable ? (
        <button
          type="button"
          className="node-delete nodrag nopan"
          aria-label="Delete clock"
          onClick={deleteClock}
        >
          <X size={13} />
        </button>
      ) : null}
      <div className="button-row audio-source-row nodrag nopan">
        <button type="button" className={enabled ? 'active' : ''} onClick={() => data.onSetting('clock_enabled', enabled ? '0' : '1')}>
          <Clock size={15} />
          {enabled ? 'Running' : 'Paused'}
        </button>
        <button type="button" onClick={data.onResetClock}>
          <RotateCcw size={15} />
          Reset
        </button>
      </div>
      {CLOCK_CONTROLS.map(([key, label, min, max, step]) => {
        const handlers = settingRangeHandlers(data, key);
        return (
          <RangeControl
            key={key}
            label={label}
            value={intSetting(data.settings, key, min, max)}
            min={min}
            max={max}
            step={step}
            paramKey={key}
            onBeginEdit={data.onBeginEdit}
            onChange={handlers.onChange}
            onCommit={handlers.onCommit}
            onEndEdit={data.onEndEdit}
          />
        );
      })}
    </NodeFrame>
  );
});

export const AudioTransportNode = memo(function AudioTransportNode({ data }: NodeComponentProps<AudioTransportNodeData>) {
  const snapshot = useSyncExternalStore(data.audio.subscribe, data.audio.getSnapshot, data.audio.getSnapshot);
  const transport = snapshot.transport;
  const hasFile = snapshot.status === 'file';
  const seekMax = Math.max(transport.duration, 0.01);
  const seekValue = Math.min(transport.currentTime, seekMax);
  const seekProgress = hasFile && transport.duration > 0 ? Math.max(0, Math.min(100, seekValue / transport.duration * 100)) : 0;
  const volume = Math.max(0, Math.min(1, transport.volume));
  const volumeProgress = volume * 100;
  const sourceLabel = hasFile && transport.sourceName
    ? `Source: File > ${transport.sourceName}`
    : snapshot.status === 'mic'
      ? 'Source: Microphone'
      : 'No audio source';
  return (
    <NodeFrame
      title="Audio transport"
      kind="signal"
      wide
      variant={1}
      outlets={[{ id: 'out', label: 'Out' }]}
      activeOutputs={data.activeOutputs}
    >
      <div className="audio-controls-row nodrag nopan">
        <label className="file-button audio-icon-button nopan" aria-label="Load audio file" title="Load audio file">
          <Upload size={15} />
          <input type="file" accept="audio/*" onChange={event => data.audio.loadFile(event.target.files?.[0])} />
        </label>
        <button type="button" className="audio-icon-button" onClick={data.audio.startMic} aria-label="Use microphone" title="Use microphone"><Mic size={15} /></button>
        <button type="button" className="audio-icon-button" onClick={data.audio.stop} aria-label="Stop audio" title="Stop audio"><Square size={15} /></button>
        <button type="button" className="audio-icon-button" disabled={!hasFile} onClick={() => data.audio.seek(0)} aria-label="Restart audio" title="Restart audio"><SkipBack size={15} /></button>
        <button type="button" className="audio-icon-button" disabled={!hasFile} onClick={transport.playing ? data.audio.pause : data.audio.play} aria-label={transport.playing ? 'Pause audio' : 'Play audio'} title={transport.playing ? 'Pause audio' : 'Play audio'}>
          {transport.playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button type="button" className={`audio-icon-button${transport.loop ? ' active' : ''}`} disabled={!hasFile} onClick={() => data.audio.setLoop(!transport.loop)} aria-label={transport.loop ? 'Disable loop' : 'Enable loop'} title={transport.loop ? 'Disable loop' : 'Enable loop'}>
          <Repeat size={15} />
        </button>
        <label className="audio-volume-control" aria-label="Audio volume" title="Audio volume">
          <Volume2 size={15} />
          <input
            className="audio-volume"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={event => data.audio.setVolume(Number(event.target.value))}
            style={{
              background: `linear-gradient(90deg, var(--accent) ${volumeProgress}%, color-mix(in oklch, var(--ink) 11%, transparent) ${volumeProgress}%)`,
            }}
          />
        </label>
      </div>
      <div className={`audio-status${snapshot.status === 'idle' ? ' is-idle' : ''}`}>{sourceLabel}</div>
      <div className="seek-row nodrag nopan">
        <span>{formatTime(transport.currentTime)}</span>
        <input
          className="audio-scrubber"
          type="range"
          min="0"
          max={seekMax}
          step="0.01"
          value={seekValue}
          disabled={!hasFile}
          onChange={event => data.audio.seek(Number(event.target.value))}
          style={{
            background: `linear-gradient(90deg, var(--accent) ${seekProgress}%, color-mix(in oklch, var(--ink) 11%, transparent) ${seekProgress}%)`,
          }}
          aria-label="Audio seek position"
        />
        <span>{formatTime(transport.duration)}</span>
      </div>
    </NodeFrame>
  );
});

export const AudioAnalysisNode = memo(function AudioAnalysisNode({ data }: NodeComponentProps<AudioAnalysisNodeData>) {
  const snapshot = useSyncExternalStore<AudioSnapshot>(data.audio.subscribe, data.audio.getSnapshot, data.audio.getSnapshot);
  const features = snapshot.features;
  return (
    <NodeFrame
      title="Audio analysis"
      kind="signal"
      wide
      variant={2}
      inlets={[{ id: 'transport', label: 'In' }]}
      activeInputs={data.activeInputs}
    >
      <MeterOutlet id="rms" label="RMS" value={features.rms} />
      <MeterOutlet id="bass" label="Bass" value={features.bass} />
      <MeterOutlet id="mid" label="Mid" value={features.mid} />
      <MeterOutlet id="high" label="High" value={features.high} />
      <MeterOutlet id="spectralFlux" label="Spectral flux" value={features.spectralFlux} />
      <MeterOutlet id="onsetStrength" label="Onset strength" value={features.onsetStrength} />
      <MeterOutlet id="cwtTransient" label="CWT transient" value={features.cwtTransient} />
      <MeterOutlet id="crestFactor" label="Crest factor" value={features.crestFactor} />
    </NodeFrame>
  );
});

export const OperatorNode = memo(function OperatorNode({ data }: NodeComponentProps<OperatorNodeData>) {
  const flow = useReactFlow<Node, Edge>();
  const [selectValues, setSelectValues] = useState(data.selectValues);
  const [values, setValues] = useState(data.values);

  useEffect(() => {
    setSelectValues(data.selectValues);
    setValues(data.values);
  }, [data.selectValues, data.values]);

  const deleteOperator = useCallback(() => {
    const nodeId = data.id;
    flow.setNodes(current => current.filter(node => node.id !== nodeId));
    flow.setEdges(current => current.filter(edge => edge.source !== nodeId && edge.target !== nodeId));
  }, [data.id, flow]);

  const updateValue = useCallback((key: string, value: number) => {
    setValues(current => {
      const next = { ...current, [key]: value };
      data.onOperatorPreview?.(data.id, next, selectValues);
      return next;
    });
    if (key === 'gain' && data.gainKey && data.onGain) {
      data.onGain(data.gainKey, value);
    }
  }, [data.gainKey, data.id, data.onGain, data.onOperatorPreview, selectValues]);

  const commitValue = useCallback((key: string, value: number) => {
    flow.setNodes(current => current.map(node => {
      if (node.id !== data.id) return node;
      const currentValues = numberRecordFromObject(dataObject(node.data, 'values'));
      return {
        ...node,
        data: {
          ...node.data,
          values: { ...currentValues, [key]: value },
        },
      };
    }));
  }, [data.id, flow]);

  const updateSelect = useCallback((key: string, value: string) => {
    const nextValues = { ...values };
    const nextSelectValues = { ...selectValues, [key]: value };
    if (data.spec.kind === 'math' && key === 'op' && isMathOperator(value)) {
      nextValues['valB'] = MATH_IDENTITY[value];
      setValues(nextValues);
    }
    setSelectValues(nextSelectValues);
    data.onOperatorPreview?.(data.id, nextValues, nextSelectValues);
    flow.setNodes(current => current.map(node => {
      if (node.id !== data.id) return node;
      const currentValues = numberRecordFromObject(dataObject(node.data, 'values'));
      const currentSelectValues = stringRecordFromObject(dataObject(node.data, 'selectValues'));
      return {
        ...node,
        data: {
          ...node.data,
          selectValues: { ...currentSelectValues, [key]: value },
          values: data.spec.kind === 'math' && key === 'op' && isMathOperator(value)
            ? { ...currentValues, valB: MATH_IDENTITY[value] }
            : currentValues,
        },
      };
    }));
  }, [data.id, data.onOperatorPreview, data.spec.kind, flow, selectValues, values]);

  return (
    <NodeFrame
      title={data.spec.label}
      kind="operator"
      variant={0}
      inlets={data.spec.inputs.map(id => ({ id, label: id }))}
      outlets={data.spec.outputs.map(id => ({ id, label: id }))}
      activeInputs={data.activeInputs}
      activeOutputs={data.activeOutputs}
    >
      <button
        type="button"
        className="node-delete nodrag nopan"
        aria-label={`Delete ${data.spec.label}`}
        onClick={deleteOperator}
      >
        <X size={13} />
      </button>
      <div className="operator-port-list">
        <span>In: {data.spec.inputs.join(', ')}</span>
        <span>Out: {data.spec.outputs.join(', ')}</span>
      </div>
      <div className="control-grid">
        {(data.spec.selects ?? []).map(select => (
          <label key={select.key} className="nodrag nopan">
            <span>{select.label}</span>
            <select
              value={selectValues[select.key] ?? select.defaultValue}
              onChange={event => updateSelect(select.key, event.target.value)}
            >
              {select.options.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        ))}
        {data.spec.controls.map(([key, label, min, max, step, digits]) => (
          <RangeControl
            key={key}
            label={label}
            value={values[key] ?? min}
            min={min}
            max={max}
            step={step}
            digits={digits}
            paramKey={data.gainKey && key === 'gain' ? `gain:${data.gainKey}` : `operator:${data.id}:${key}`}
            onBeginEdit={data.onBeginEdit}
            onChange={value => updateValue(key, value)}
            onCommit={value => commitValue(key, value)}
            onEndEdit={data.onEndEdit}
          />
        ))}
      </div>
    </NodeFrame>
  );
});

export const RippleTargetNode = memo(function RippleTargetNode({ data }: NodeComponentProps<SettingsNodeData>) {
  return (
    <NodeFrame
      title="Ripple / depth target"
      kind="surface"
      wide
      variant={2}
      inlets={portSpecsFromControls(RIPPLE_TARGET_CONTROLS)}
      outlets={[{ id: 'field', label: 'Field' }]}
      activeInputs={data.activeInputs}
      activeOutputs={data.activeOutputs}
    >
      <div className="control-grid two-col">
        {RIPPLE_TARGET_CONTROLS.map(([key, label, min, max, step]) => {
          const handlers = settingRangeHandlers(data, key);
          return (
            <RangeControl
              key={key}
              label={label}
              value={intSetting(data.settings, key, min, max)}
              min={min}
              max={max}
              step={step}
              paramKey={key}
              onBeginEdit={data.onBeginEdit}
              onChange={handlers.onChange}
              onCommit={handlers.onCommit}
              onEndEdit={data.onEndEdit}
            />
          );
        })}
      </div>
      <div className="segmented nodrag nopan">
        {['Color', 'Depth', 'Both', 'Fine both', 'None'].map((label, idx) => (
          <button
            key={label}
            type="button"
            className={intSetting(data.settings, 'ripple_kind', 0, 4) === idx ? 'active' : ''}
            onClick={() => data.onSetting('ripple_kind', String(idx))}
          >
            {label}
          </button>
        ))}
      </div>
    </NodeFrame>
  );
});


export const FxNode = memo(function FxNode({ data }: NodeComponentProps<FxNodeData>) {
  const flow = useReactFlow<Node, Edge>();
  const descriptor = fxDescriptor(data.kind);
  const deleteNode = useCallback(() => {
    const id = data.id;
    flow.setNodes(current => current.filter(node => node.id !== id));
    flow.setEdges(current => current.filter(edge => edge.source !== id && edge.target !== id));
  }, [data.id, flow]);
  if (!descriptor) return null;
  if (descriptor.compose === 'transform') {
    return (
      <NodeFrame
        title={descriptor.label}
        kind="output"
        variant={3}
        inlets={[{ id: 'frame', label: 'Frame' }]}
        outlets={[{ id: 'frame', label: 'Frame' }]}
        activeInputs={data.activeInputs}
        activeOutputs={data.activeOutputs}
      >
        <div className="node-subtitle">AgX → sRGB output transform</div>
      </NodeFrame>
    );
  }
  return (
    <NodeFrame
      title={descriptor.label}
      kind="output"
      variant={3}
      inlets={[{ id: 'frame', label: 'Frame' }, ...descriptor.params.map(p => ({ id: p.key, label: p.label }))]}
      outlets={[{ id: 'frame', label: 'Frame' }]}
      activeInputs={data.activeInputs}
      activeOutputs={data.activeOutputs}
    >
      <button
        type="button"
        className="node-delete nodrag nopan"
        aria-label={`Delete ${descriptor.label}`}
        onClick={deleteNode}
      >
        <X size={13} />
      </button>
      <div className="control-grid two-col">
        {descriptor.params.map(param => (
          <RangeControl
            key={param.key}
            label={param.label}
            value={data.values[param.key] ?? param.def}
            min={param.min}
            max={param.max}
            step={param.step}
            digits={param.step < 1 ? 2 : 0}
            paramKey={`fx:${data.id}:${param.key}`}
            onBeginEdit={data.onBeginEdit}
            onChange={value => data.onFxValue?.(data.id, param.key, value)}
            onEndEdit={data.onEndEdit}
          />
        ))}
      </div>
      {(descriptor.selects ?? []).map(select => (
        <MultiSwitch
          key={select.key}
          label={select.label}
          value={data.selects[select.key] ?? select.def}
          options={select.options}
          onChange={value => data.onFxSelect?.(data.id, select.key, value)}
        />
      ))}
      <button
        type="button"
        className={`fx-bypass nodrag nopan${data.bypass ? ' active' : ''}`}
        onClick={() => data.onFxBypass?.(data.id, !data.bypass)}
      >
        {data.bypass ? 'Bypassed' : 'Active'}
      </button>
    </NodeFrame>
  );
});

export const RendererNode = memo(function RendererNode({ data }: NodeComponentProps<RendererNodeData>) {
  return (
    <NodeFrame
      title="Scene pass"
      kind="output"
      variant={0}
      inlets={SCENE_PASS_INLETS}
      outlets={[{ id: 'frame', label: 'Frame' }]}
      activeInputs={data.activeInputs}
      activeOutputs={data.activeOutputs}
    >
      <div className="render-readout">
        <span>{data.tiles}</span>
        <em>tiles</em>
      </div>
      <div className="node-subtitle">{data.loading || 'WebGPU TSL r184'}</div>
    </NodeFrame>
  );
});

export const DisplayNode = memo(function DisplayNode({ data }: NodeComponentProps<DisplayNodeData>) {
  return (
    <NodeFrame
      title="Display sink"
      kind="output"
      variant={0}
      inlets={DISPLAY_INLETS}
      activeInputs={data.activeInputs}
    >
      <div className="node-subtitle">Canvas output</div>
    </NodeFrame>
  );
});
