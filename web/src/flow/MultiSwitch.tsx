import { memo, useCallback } from 'react';
import type { KeyboardEvent } from 'react';

type MultiSwitchOption = { value: string; label: string };
type MultiSwitchProps = {
  label: string;
  value: string;
  options: readonly MultiSwitchOption[];
  onChange: (value: string) => void;
};

export const MultiSwitch = memo(function MultiSwitch({ label, value, options, onChange }: MultiSwitchProps) {
  const onKey = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const idx = options.findIndex(option => option.value === value);
    if (idx < 0) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      onChange(options[(idx + 1) % options.length]!.value);
      event.preventDefault();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      onChange(options[(idx - 1 + options.length) % options.length]!.value);
      event.preventDefault();
    }
  }, [onChange, options, value]);
  return (
    <div className="multiswitch nodrag nopan" role="listbox" aria-label={label} tabIndex={0} onKeyDown={onKey}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          role="option"
          aria-selected={option.value === value}
          className={option.value === value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >{option.label}</button>
      ))}
    </div>
  );
});
