// The xyflow node components for the control graph — one memo'd presentational
// component per node kind. Each takes its data via NodeComponentProps<TData> and
// renders a NodeFrame with its controls; no closure over the orchestrator, so they
// live here and the ControlGraph component just maps them in its nodeTypes.
import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNodeId, useReactFlow, type Edge, type Node } from '@xyflow/react';
import {
  AudioWaveform,
  Clock,
  FunctionSquare,
  Gem,
  Globe,
  Frame,
  Image as ImageIcon,
  Images,
  Lightbulb,
  Mic,
  Monitor,
  Music,
  Palette as PaletteIcon,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  Shapes,
  SkipBack,
  Square,
  TriangleAlert,
  Upload,
  Volume2,
  Waves,
  X,
} from 'lucide-react';
import { MultiSwitch } from './MultiSwitch';
import { RangeControl } from './RangeControl';
import { DISPLAY_INLETS, NodeFrame, SCENE_PASS_INLETS, portSpecsFromControls } from './nodeFrame';
import { fxIconComponent } from './fxIcons';
import { MeterOutlet, MeterRow, drawWheel, formatTime, positionWheelMarker, settingRangeHandlers, settingWithLiveBoost } from './nodeHelpers';
import { FAMILIES, familyByValue, generationLabelForFamily, generationShortLabelForFamily, seedLabel } from '../tiling/families';
import { dataObject, numberRecordFromObject, stringRecordFromObject } from './nodeData';
import { fxDescriptor } from '../render/postFxCatalog';
import { FIELD_SOURCE_OUTLETS, FIELD_SOURCE_PARAMS, FIELD_SOURCE_PHASE_INLET } from './fieldSourceSpec';
import {
  CLOCK_CONTROLS,
  BORDER_CONTROLS,
  LIGHT_CHOREO_PHASE_INLET,
  LIGHT_CONTROLS,
  MATERIAL_CONTROLS,
  PROJECTION_CONTROLS,
  RIPPLE_TARGET_CONTROLS,
} from './controlSpecs';
import { MATH_IDENTITY, isMathOperator } from './operatorSpecs';
import { intSetting } from '../settings/androidSettings';
import { MAX_COLORS, oklchCss, type Oklch } from '../color/palette';
import { familySupportsSourceOverlay, familySupportsWieringaRoof, sourceOverlayKindForFamily } from '../tiling/capabilities';
import type { AudioSnapshot } from '../types';
import type { SettingKey } from '../settings/androidSettings';

import type {
  AtlasNodeData,
  AudioAnalysisNodeData,
  AudioTransportNodeData,
  ClockNodeData,
  DisplayNodeData,
  FieldSourceNodeData,
  IfsAttractorNodeData,
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

const ORNAMENT_KEYS: readonly SettingKey[] = [
  'ornament_style',
  'ornament_amount',
  'ornament_width',
  'ornament_density',
  'ornament_phase',
  'ornament_twist',
];

const MATERIAL_SURFACE_CONTROLS = MATERIAL_CONTROLS.filter(([key]) => (
  key !== 'surface_contour_source'
  && !ORNAMENT_KEYS.some(ornamentKey => ornamentKey === key)
));
const ORNAMENT_TUNING_CONTROLS = MATERIAL_CONTROLS.filter(([key]) => (
  key === 'ornament_amount'
  || key === 'ornament_width'
  || key === 'ornament_density'
  || key === 'ornament_phase'
  || key === 'ornament_twist'
));
const SOURCE_MARKING_COLOR_CONTROLS: readonly [SettingKey, string, number, number, number][] = [
  ['source_mark_a_l', 'Mark A light', 0, 100, 1],
  ['source_mark_a_c', 'Mark A color', 0, 40, 1],
  ['source_mark_a_h', 'Mark A hue', 0, 360, 1],
  ['source_mark_b_l', 'Mark B light', 0, 100, 1],
  ['source_mark_b_c', 'Mark B color', 0, 40, 1],
  ['source_mark_b_h', 'Mark B hue', 0, 360, 1],
  ['source_mark_c_l', 'Line light', 0, 100, 1],
  ['source_mark_c_c', 'Line color', 0, 40, 1],
  ['source_mark_c_h', 'Line hue', 0, 360, 1],
] as const;

const CONTOUR_SOURCE_MODES = [
  { value: 0, label: 'Height', title: 'Relief surface-height isolines' },
  { value: 1, label: 'Relief', title: 'Relief-attribute isolines' },
  { value: 2, label: 'Lum', title: 'Surface luminance isolines' },
  { value: 3, label: 'Curve', title: 'Curvature and ridge-flux isolines' },
  { value: 4, label: 'Adj', title: 'Adjacency-degree field' },
  { value: 5, label: 'Motif', title: 'Local motif hash field' },
  { value: 6, label: 'Relax', title: 'Relaxed scalar field' },
  { value: 7, label: 'Biharm', title: 'Biharmonic scalar field' },
] as const;

const CLOCK_WAVEFORMS = [
  { value: '0', label: 'Saw' },
  { value: '1', label: 'Sine' },
  { value: '2', label: 'Triangle' },
  { value: '3', label: 'Square' },
] as const;

const ORNAMENT_MODES = [
  { value: 0, label: 'Off' },
  { value: 1, label: 'Arcs' },
  { value: 2, label: 'Diagonals' },
  { value: 3, label: 'Connected arcs' },
  { value: 4, label: 'Source markings' },
] as const;

const RELIEF_MODES = [
  { value: 0, label: 'Bevel relief' },
  { value: 1, label: 'P3 Wieringa roof' },
] as const;

// #2 Principled multi-sided-tile refinement (SurfLab 21ccnew/22remesh): resample
// the analytic relief field per fill child on multi-sided tiles instead of baking
// it linearly across the centroid-fan triangles. Off = today's output.
const FACET_REFINE_MODES = [
  { value: 0, label: 'Linear facets' },
  { value: 1, label: 'Refined facets' },
] as const;

const SOURCE_MARKING_DETAILS = [
  { value: 0, label: 'Outlines' },
  { value: 1, label: 'Outlines + arcs' },
  { value: 2, label: 'Filled tiles' },
] as const;
const AB_SOURCE_MARKING_DETAILS = [
  { value: 0, label: 'Diagonal graph' },
  { value: 1, label: 'Smith curves' },
  { value: 2, label: 'Dipped-corner fill' },
  { value: 3, label: 'Ammann bars' },
] as const;

export const AtlasNode = memo(function AtlasNode({ data }: NodeComponentProps<AtlasNodeData>) {
  return (
    <NodeFrame
      title="Curated renders"
      icon={<Images size={14} />}
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
  const generationLabel = generationLabelForFamily(data.settings.family);
  const generationShortLabel = generationShortLabelForFamily(data.settings.family);
  return (
    <NodeFrame
      title="Tiling source"
      icon={<Shapes size={14} />}
      kind="source"
      wide
      variant={1}
      inlets={[{ id: 'in', label: 'In' }, { id: 'generation', label: generationShortLabel }]}
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
          label={generationLabel}
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

export const IfsAttractorNode = memo(function IfsAttractorNode({ data }: NodeComponentProps<IfsAttractorNodeData>) {
  return (
    <NodeFrame
      title="Order-five IFS"
      icon={<FunctionSquare size={14} />}
      kind="source"
      variant={1}
      outlets={[{ id: 'points', label: 'Points' }]}
      activeOutputs={data.activeOutputs}
    >
      <div className="node-subtitle" />
    </NodeFrame>
  );
});

export const PaletteNode = memo(function PaletteNode({ data }: NodeComponentProps<PaletteNodeData>) {
  const wheelRef = useRef<HTMLCanvasElement | null>(null);
  const wheelMarkerRef = useRef<HTMLDivElement | null>(null);
  const wheelEditingRef = useRef(false);
  const selected = data.selectedColorValue;
  const wheelParamKey = `custom_color_${data.selectedColor}_chroma_hue`;
  const family = familyByValue(data.settings.family);
  const typeModeLabel = family.value === '15' ? 'Arm' : 'Type';
  const colorModes = family.showOrientMode === false
    ? [{ label: typeModeLabel, value: 0 }, { label: 'Phase', value: 3 }, { label: 'Ring', value: 2 }]
    : [{ label: typeModeLabel, value: 0 }, { label: 'Phase', value: 3 }, { label: 'Orient', value: 1 }, { label: 'Ring', value: 2 }];

  useEffect(() => {
    drawWheel(wheelRef.current, selected);
    positionWheelMarker(wheelMarkerRef.current, selected);
  }, [selected]);

  const applyWheel = (event: WheelPointer) => {
    const canvas = wheelRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const radiusPx = Math.max(1, Math.min(rect.width, rect.height) * 0.5);
    const x = (event.clientX - (rect.left + rect.width * 0.5)) / radiusPx;
    const y = (event.clientY - (rect.top + rect.height * 0.5)) / radiusPx;
    const radius = Math.min(1, Math.hypot(x, y));
    const hue = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    const updater = (color: Oklch) => oklch(color[0], radius * 0.37, hue);
    data.onPreviewCustomColor(updater);
    positionWheelMarker(wheelMarkerRef.current, updater(selected));
  };

  const finishWheelEdit = () => {
    if (!wheelEditingRef.current) return;
    wheelEditingRef.current = false;
    data.onCommitCustomColor();
    data.onEndEdit(wheelParamKey);
  };

  return (
    <NodeFrame
      title="Color mapper"
      icon={<PaletteIcon size={14} />}
      kind="color"
      wide
      variant={0}
      inlets={[
        { id: 'in', label: 'Projection' },
        { id: 'color_count', label: 'Slots' },
        { id: 'color_spread', label: 'Spread' },
        { id: 'color_spectral', label: 'Spectral' },
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
        <RangeControl
          label="Spread"
          title="Bucket spread across the selected Slots. 0% collapses to slot 1; 100% uses the full slot range."
          value={intSetting(data.settings, 'color_spread', 0, 100)}
          min={0}
          max={100}
          step={1}
          paramKey="color_spread"
          onBeginEdit={data.onBeginEdit}
          onChange={value => data.onPreviewSetting('color_spread', value)}
          onCommit={value => data.onSetting('color_spread', value)}
          onEndEdit={data.onEndEdit}
        />
        <RangeControl
          label="Spectral"
          title="Blend the selected palette toward Spectra. 0 keeps Greys/Paper/etc. literal; higher values intentionally add chroma for modulation."
          value={intSetting(data.settings, 'color_spectral', 0, 100)}
          min={0}
          max={100}
          step={1}
          paramKey="color_spectral"
          onBeginEdit={data.onBeginEdit}
          onChange={value => data.onPreviewSetting('color_spectral', value)}
          onCommit={value => data.onSetting('color_spectral', value)}
          onEndEdit={data.onEndEdit}
        />
      </div>
      <div className="segmented nodrag nopan">
        {colorModes.map(({ label, value }) => (
          <button
            key={label}
            type="button"
            className={intSetting(data.settings, 'color_mode', 0, 3) === value ? 'active' : ''}
            title={label === 'Phase' ? 'Continuous class phase: each type/arm gets a palette segment and progresses through it by ring depth or spiral order.' : undefined}
            onClick={() => data.onSetting('color_mode', String(value))}
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
        <div className="color-wheel-frame">
          <canvas
            ref={wheelRef}
            id="colorWheel"
            width="220"
            height="220"
            aria-label="OKLCH hue and chroma selector"
            onPointerDown={event => {
              if (!event.isPrimary || event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              wheelEditingRef.current = true;
              data.onBeginEdit(wheelParamKey);
              applyWheel(event);
            }}
            onPointerMove={event => {
              if (!wheelEditingRef.current || !event.isPrimary || (event.buttons & 1) === 0) return;
              event.preventDefault();
              applyWheel(event);
            }}
            onPointerUp={event => {
              event.preventDefault();
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              finishWheelEdit();
            }}
            onPointerCancel={event => {
              event.preventDefault();
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              finishWheelEdit();
            }}
            onLostPointerCapture={() => finishWheelEdit()}
          />
          <div ref={wheelMarkerRef} className="color-wheel-marker" aria-hidden="true" />
        </div>
        <RangeControl
          label="Luminance"
          value={selected[0]}
          min={0}
          max={1}
          step={0.001}
          digits={3}
          paramKey={`custom_color_${data.selectedColor}_luminance`}
          onBeginEdit={data.onBeginEdit}
          onChange={value => {
            const updater = (color: Oklch) => oklch(value, color[1], color[2]);
            data.onPreviewCustomColor(updater);
            drawWheel(wheelRef.current, updater(selected));
            positionWheelMarker(wheelMarkerRef.current, updater(selected));
          }}
          onCommit={() => data.onCommitCustomColor()}
          onEndEdit={data.onEndEdit}
        />
        <div className="gamut">{data.gamut}</div>
      </div>
    </NodeFrame>
  );
});

export const MaterialNode = memo(function MaterialNode({ data }: NodeComponentProps<SettingsNodeData>) {
  const ornamentStyle = intSetting(data.settings, 'ornament_style', 0, 4);
  const ornamentAmount = intSetting(data.settings, 'ornament_amount', 0, 100);
  const family = intSetting(data.settings, 'family', 0, 19);
  const sourceOverlayKind = sourceOverlayKindForFamily(family);
  const supportsSourceOverlay = familySupportsSourceOverlay(family);
  const supportsPenroseSourceDetail = sourceOverlayKind === 'penrose-robinson';
  const supportsAbSourceDetail = sourceOverlayKind === 'ammann-beenker-truchet';
  const displayedOrnamentStyle = ornamentStyle === 4 && !supportsSourceOverlay ? 0 : ornamentStyle;
  const sourceDetail = supportsAbSourceDetail ? intSetting(data.settings, 'source_mark_detail', 0, 3) : intSetting(data.settings, 'source_mark_detail', 0, 2);
  const supportsWieringaRoof = familySupportsWieringaRoof(family);
  const reliefMode = supportsWieringaRoof ? intSetting(data.settings, 'surface_relief_mode', 0, 1) : 0;
  const reliefModes = supportsWieringaRoof ? RELIEF_MODES : [RELIEF_MODES[0]!];
  const ornamentModes = supportsSourceOverlay
    ? ORNAMENT_MODES
    : ORNAMENT_MODES.filter(mode => mode.value !== 4);
  const setOrnamentMode = (value: number): void => {
    data.onSetting('ornament_style', value);
    if (value > 0 && ornamentAmount === 0) data.onSetting('ornament_amount', 70);
  };
  return (
    <NodeFrame
      title="Surface material"
      icon={<Gem size={14} />}
      kind="surface"
      wide
      variant={0}
      inlets={[
        { id: 'color', label: 'Color' },
        ...portSpecsFromControls(MATERIAL_CONTROLS),
      ]}
      outlets={[
        { id: 'surface', label: 'Surface' },
        { id: 'relief', label: 'Relief' },
        { id: 'color', label: 'Color' },
      ]}
      activeInputs={data.activeInputs}
      activeOutputs={data.activeOutputs}
    >
      <div className="control-grid two-col">
        {MATERIAL_SURFACE_CONTROLS.map(([key, label, min, max, step]) => {
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
      <div className="node-section-title">Contour source</div>
      <div className="segmented four nodrag nopan">
        {CONTOUR_SOURCE_MODES.map(mode => (
          <button
            key={mode.value}
            type="button"
            className={intSetting(data.settings, 'surface_contour_source', 0, 7) === mode.value ? 'active' : ''}
            title={mode.title}
            onClick={() => data.onSetting('surface_contour_source', mode.value)}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <div className="node-section-title">Relief law</div>
      <div className="segmented two nodrag nopan">
        {reliefModes.map(mode => (
          <button
            key={mode.value}
            type="button"
            className={reliefMode === mode.value ? 'active' : ''}
            onClick={() => data.onSetting('surface_relief_mode', mode.value)}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <div className="node-section-title">Facet refinement</div>
      <div className="segmented two nodrag nopan">
        {FACET_REFINE_MODES.map(mode => (
          <button
            key={mode.value}
            type="button"
            className={intSetting(data.settings, 'facet_refine', 0, 1) === mode.value ? 'active' : ''}
            onClick={() => data.onSetting('facet_refine', mode.value)}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <div className="node-section-title">Surface ornament</div>
      <div className={`segmented ${supportsSourceOverlay ? 'five' : 'four'} ornament-mode-row nodrag nopan`}>
        {ornamentModes.map(mode => (
          <button
            key={mode.value}
            type="button"
            className={displayedOrnamentStyle === mode.value ? 'active' : ''}
            onClick={() => setOrnamentMode(mode.value)}
          >
            {mode.label}
          </button>
        ))}
      </div>
      {displayedOrnamentStyle > 0 && (
        <div className="control-grid two-col ornament-controls">
          {ORNAMENT_TUNING_CONTROLS.map(([key, label, min, max, step]) => {
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
      )}
      {displayedOrnamentStyle === 4 && supportsPenroseSourceDetail && (
        <div className="segmented three nodrag nopan">
          {SOURCE_MARKING_DETAILS.map(mode => (
            <button
              key={mode.value}
              type="button"
              className={sourceDetail === mode.value ? 'active' : ''}
              onClick={() => data.onSetting('source_mark_detail', mode.value)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      )}
      {displayedOrnamentStyle === 4 && supportsAbSourceDetail && (
        <div className="segmented four nodrag nopan">
          {AB_SOURCE_MARKING_DETAILS.map(mode => (
            <button
              key={mode.value}
              type="button"
              className={sourceDetail === mode.value ? 'active' : ''}
              onClick={() => data.onSetting('source_mark_detail', mode.value)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      )}
      {displayedOrnamentStyle === 4 && supportsSourceOverlay && (
        <div className="control-grid two-col ornament-controls">
          {SOURCE_MARKING_COLOR_CONTROLS.map(([key, label, min, max, step]) => {
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
      )}
    </NodeFrame>
  );
});

export const LightingNode = memo(function LightingNode({ data }: NodeComponentProps<SettingsNodeData>) {
  return (
    <NodeFrame
      title="Lighting"
      icon={<Lightbulb size={14} />}
      kind="surface"
      wide
      variant={1}
      inlets={[LIGHT_CHOREO_PHASE_INLET, ...portSpecsFromControls(LIGHT_CONTROLS)]}
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
    <NodeFrame
      title="Border"
      icon={<Frame size={14} />}
      kind="surface"
      wide
      variant={0}
      inlets={portSpecsFromControls(BORDER_CONTROLS)}
      outlets={[{ id: 'border', label: 'Out' }]}
      activeInputs={data.activeInputs}
      activeOutputs={data.activeOutputs}
    >
      <div className="segmented two nodrag nopan">
        <button type="button" className={borderOn ? 'active' : ''} onClick={() => data.onSetting('border_on', 'true')}>On</button>
        <button type="button" className={!borderOn ? 'active' : ''} onClick={() => data.onSetting('border_on', 'false')}>Off</button>
      </div>
      <div className="segmented nodrag nopan">
        {['Miter', 'Round', 'Bevel'].map((label, idx) => (
          <button
            key={label}
            type="button"
            className={intSetting(data.settings, 'border_join', 0, 2) === idx ? 'active' : ''}
            onClick={() => data.onSetting('border_join', String(idx))}
          >
            {label}
          </button>
        ))}
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
      icon={<Globe size={14} />}
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
          onClick={() => {
            data.onSetting('projection', '0');
            data.onSetting('proj_blend', 0);
          }}
        >
          Euclidean
        </button>
        <button
          type="button"
          className={String(data.settings.projection) === '1' ? 'active' : ''}
          onClick={() => {
            data.onSetting('projection', '1');
            data.onSetting('proj_blend', 100);
          }}
        >
          Poincare disk
        </button>
      </div>
      <div className="segmented three poincare-scope-row nodrag nopan">
        {['Global', 'Per-tile', 'Both'].map((lbl, i) => (
          <button
            key={lbl}
            type="button"
            className={intSetting(data.settings, 'poincare_scope', 0, 2) === i ? 'active' : ''}
            onClick={() => data.onSetting('poincare_scope', i)}
          >
            {lbl}
          </button>
        ))}
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
    void flow.deleteElements({ nodes: [{ id: nodeId }] });
  }, [data.deletable, data.id, flow]);
  return (
    <NodeFrame
      title="Clock source"
      icon={<Clock size={14} />}
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
      <div className="node-section-title">Waveform</div>
      <div className="segmented four nodrag nopan">
        {CLOCK_WAVEFORMS.map(wave => (
          <button
            key={wave.value}
            type="button"
            className={String(data.settings.clock_waveform ?? '0') === wave.value ? 'active' : ''}
            onClick={() => data.onSetting('clock_waveform', wave.value)}
          >
            {wave.label}
          </button>
        ))}
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
  const snapshot = useSyncExternalStore(data.audio.subscribeUi, data.audio.getSnapshot, data.audio.getSnapshot);
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
      icon={<Music size={14} />}
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
  const snapshot = useSyncExternalStore<AudioSnapshot>(data.audio.subscribeUi, data.audio.getSnapshot, data.audio.getSnapshot);
  const features = snapshot.features;
  return (
    <NodeFrame
      title="Audio analysis"
      icon={<AudioWaveform size={14} />}
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
      <MeterOutlet id="beat" label="Beat envelope" value={features.beat} />
      <MeterOutlet id="beatPhase" label="Beat phase" value={features.beatPhase} />
      <MeterOutlet id="pulseLfo" label="Pulse LFO" value={features.pulseLfo} />
      <MeterRow label="Tempo" value={features.tempo}>
        <span>{Math.round(features.bpm)} BPM</span>
      </MeterRow>
      <MeterOutlet id="beatConfidence" label="Beat confidence" value={features.beatConfidence} />
      <MeterOutlet id="pulseConfidence" label="Pulse confidence" value={features.pulseConfidence} />
      <MeterOutlet id="tempoConfidence" label="Tempo confidence" value={features.tempoConfidence} />
      <MeterOutlet id="beatStrength" label="Beat strength" value={features.beatStrength} />
    </NodeFrame>
  );
});

export const OperatorNode = memo(function OperatorNode({ data }: NodeComponentProps<OperatorNodeData>) {
  const flow = useReactFlow<Node, Edge>();
  // Select only this node's slice: the store keeps unchanged slices
  // referentially stable, so React (Object.is on the getSnapshot result)
  // skips re-rendering nodes whose signals didn't move this frame.
  const nodeSignals = useSyncExternalStore(
    data.operatorSignals.subscribe,
    useCallback(() => data.operatorSignals.getSnapshot()[data.id], [data.id, data.operatorSignals]),
    useCallback(() => data.operatorSignals.getSnapshot()[data.id], [data.id, data.operatorSignals]),
  );
  const outputSignals = nodeSignals ?? {};
  const [selectValues, setSelectValues] = useState(data.selectValues);
  const [values, setValues] = useState(data.values);

  useEffect(() => {
    setSelectValues(data.selectValues);
    setValues(data.values);
  }, [data.selectValues, data.values]);

  const deleteOperator = useCallback(() => {
    const nodeId = data.id;
    void flow.deleteElements({ nodes: [{ id: nodeId }] });
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
      icon={<FunctionSquare size={14} />}
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
      <div className="operator-output-meters">
        {data.spec.outputs.map(output => (
          <MeterRow key={output} label={output} value={outputSignals[output] ?? 0} />
        ))}
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
            value={values[key] ?? data.spec.defaults?.[key] ?? min}
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
  const flow = useReactFlow<Node, Edge>();
  const nodeId = useNodeId();
  const deleteNode = useCallback(() => {
    if (!nodeId) return;
    void flow.deleteElements({ nodes: [{ id: nodeId }] });
  }, [flow, nodeId]);
  return (
    <NodeFrame
      title="Field source"
      icon={<Waves size={14} />}
      kind="surface"
      wide
      variant={2}
      inlets={[FIELD_SOURCE_PHASE_INLET, { id: 'relief', label: 'Relief in' }, { id: 'color', label: 'Color in' }, ...portSpecsFromControls(RIPPLE_TARGET_CONTROLS)]}
      outlets={[{ id: 'displace', label: 'Displace' }, { id: 'relief', label: 'Relief' }, { id: 'color', label: 'Color' }, { id: 'undulate', label: 'Undulate' }]}
      activeInputs={data.activeInputs}
      activeOutputs={data.activeOutputs}
    >
      <button type="button" className="node-delete nodrag nopan" aria-label="Delete field source" onClick={deleteNode}>
        <X size={13} />
      </button>
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
    </NodeFrame>
  );
});

// An addable field source: its own independent wave (freq/speed) plus relief/
// undulate/colour amplitudes, summed into the surface alongside the default. The
// param inlets are audio-drivable (operator -> inlet), the field outlets wire to
// the renderer; an unwired field outlet contributes nothing (§0).
export const FieldSourceNode = memo(function FieldSourceNode({ data }: NodeComponentProps<FieldSourceNodeData>) {
  const flow = useReactFlow<Node, Edge>();
  const deleteNode = useCallback(() => {
    const id = data.id;
    void flow.deleteElements({ nodes: [{ id }] });
  }, [data.id, flow]);
  return (
    <NodeFrame
      title="Field source +"
      icon={<Waves size={14} />}
      kind="surface"
      wide
      variant={2}
      inlets={[FIELD_SOURCE_PHASE_INLET, { id: 'relief', label: 'Relief in' }, { id: 'color', label: 'Color in' }, ...FIELD_SOURCE_PARAMS.map(([key, label]) => ({ id: key, label }))]}
      outlets={FIELD_SOURCE_OUTLETS.map(port => (
        port.id === 'relief' ? { ...port, label: 'Relief' }
          : port.id === 'color' ? { ...port, label: 'Color' }
          : port
      ))}
      activeInputs={data.activeInputs}
      activeOutputs={data.activeOutputs}
    >
      <button type="button" className="node-delete nodrag nopan" aria-label="Delete field source" onClick={deleteNode}>
        <X size={13} />
      </button>
      <div className="control-grid two-col">
        {FIELD_SOURCE_PARAMS.map(([key, label, min, max, step]) => (
          <RangeControl
            key={key}
            label={label}
            value={data.values[key] ?? 0}
            min={min}
            max={max}
            step={step}
            paramKey={`field:${data.id}:${key}`}
            onBeginEdit={data.onBeginEdit}
            onChange={value => data.onFieldValue?.(data.id, key, value)}
            onEndEdit={data.onEndEdit}
          />
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
    void flow.deleteElements({ nodes: [{ id }] });
  }, [data.id, flow]);
  if (!descriptor) return null;
  const Icon = fxIconComponent(descriptor.icon);
  if (descriptor.compose === 'transform') {
    return (
      <NodeFrame
        title={descriptor.label}
        icon={<Icon size={14} />}
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
      icon={<Icon size={14} />}
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
      {data.domainWarning ? (
        <div
          className="fx-domain-warning nodrag nopan"
          title="Linear-domain effect placed after Tone map, where the image is already display-referred. Move it before Tone map for correct results."
        >
          <TriangleAlert size={12} />
          <span>after tone map</span>
        </div>
      ) : null}
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
      icon={<ImageIcon size={14} />}
      kind="output"
      variant={0}
      inlets={SCENE_PASS_INLETS}
      outlets={[{ id: 'frame', label: 'Frame' }]}
      activeInputs={data.activeInputs}
      activeOutputs={data.activeOutputs}
    >
      <div className="render-readout">
        <span>{data.tiles}</span>
        <em>{data.unit}</em>
      </div>
      <div className="node-subtitle">{data.loading || 'WebGPU TSL r184'}</div>
    </NodeFrame>
  );
});

export const DisplayNode = memo(function DisplayNode({ data }: NodeComponentProps<DisplayNodeData>) {
  return (
    <NodeFrame
      title="Display sink"
      icon={<Monitor size={14} />}
      kind="output"
      variant={0}
      inlets={DISPLAY_INLETS}
      activeInputs={data.activeInputs}
    >
      <div className="node-subtitle">Canvas output</div>
    </NodeFrame>
  );
});
