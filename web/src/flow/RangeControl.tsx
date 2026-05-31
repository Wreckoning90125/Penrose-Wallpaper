// The slider + number-field control shared by every settings node in the graph.
// Self-contained (React + clampNumber only): drag the slider or type a value;
// onChange fires live, onCommit on release/blur/Enter, and onBeginEdit/onEndEdit
// bracket an edit gesture so the audio drive can hold a param while you tune it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { clampNumber } from '../util/clamp';

export type RangeControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  digits?: number;
  title?: string;
  paramKey?: string;
  onBeginEdit?: (paramKey: string) => void;
  onChange: (value: number) => void;
  onCommit?: ((value: number) => void) | undefined;
  onEndEdit?: (paramKey: string) => void;
};

function formatNumber(value: number, digits: number): string {
  return digits > 0 ? Number(value).toFixed(digits) : String(Math.round(Number(value)));
}

export function RangeControl({
  label,
  value,
  min,
  max,
  step,
  digits = 0,
  title,
  paramKey,
  onBeginEdit,
  onChange,
  onCommit,
  onEndEdit,
}: RangeControlProps) {
  const display = formatNumber(value, digits);
  const [draft, setDraft] = useState(display);
  const [sliderValue, setSliderValue] = useState(value);
  const dirtyRef = useRef(false);
  const editingRef = useRef(false);
  const draggingRef = useRef(false);
  const sliderValueRef = useRef(value);

  useEffect(() => {
    if (editingRef.current) return;
    setDraft(display);
    setSliderValue(value);
    sliderValueRef.current = value;
  }, [display, value]);

  const commit = useCallback(() => {
    const parsed = Number(draft);
    const next = clampNumber(parsed, min, max);
    setDraft(formatNumber(next, digits));
    setSliderValue(next);
    sliderValueRef.current = next;
    onChange(next);
    onCommit?.(next);
    dirtyRef.current = false;
  }, [digits, draft, max, min, onChange, onCommit]);

  const updateSlider = useCallback((next: number) => {
    const clamped = clampNumber(next, min, max);
    setSliderValue(clamped);
    setDraft(formatNumber(clamped, digits));
    sliderValueRef.current = clamped;
    dirtyRef.current = true;
    onChange(clamped);
  }, [digits, max, min, onChange]);

  const updateDraft = useCallback((next: string) => {
    setDraft(next);
    const trimmed = next.trim();
    if (!trimmed) return;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;
    const clamped = clampNumber(parsed, min, max);
    setSliderValue(clamped);
    sliderValueRef.current = clamped;
    dirtyRef.current = true;
    onChange(clamped);
  }, [max, min, onChange]);

  const beginEdit = useCallback(() => {
    if (!paramKey || editingRef.current) return;
    editingRef.current = true;
    onBeginEdit?.(paramKey);
  }, [onBeginEdit, paramKey]);

  const endEdit = useCallback(() => {
    if (!editingRef.current) return;
    editingRef.current = false;
    if (paramKey) onEndEdit?.(paramKey);
  }, [onEndEdit, paramKey]);

  const endSliderGesture = useCallback(() => {
    if (!draggingRef.current && !editingRef.current) return;
    const shouldCommit = dirtyRef.current;
    draggingRef.current = false;
    setDraft(formatNumber(sliderValueRef.current, digits));
    if (shouldCommit) {
      onCommit?.(sliderValueRef.current);
      dirtyRef.current = false;
    }
    endEdit();
  }, [digits, endEdit, onCommit]);

  const beginSliderGesture = useCallback(() => {
    draggingRef.current = true;
    beginEdit();
  }, [beginEdit]);

  useEffect(() => {
    const end = () => {
      if (draggingRef.current) endSliderGesture();
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [endSliderGesture]);

  return (
    <label className="range-row nodrag nopan" data-tip={title}>
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={sliderValue}
        onChange={event => updateSlider(Number(event.target.value))}
        onBlur={endSliderGesture}
        onFocus={beginEdit}
        onPointerCancel={endSliderGesture}
        onPointerDown={beginSliderGesture}
        onPointerUp={endSliderGesture}
      />
      <input
        className="number-field"
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={event => updateDraft(event.target.value)}
        onBlur={() => {
          commit();
          endEdit();
        }}
        onFocus={event => {
          event.currentTarget.select();
          beginEdit();
        }}
        onKeyDown={event => {
          if (event.key === 'Enter') commit();
        }}
      />
    </label>
  );
}
