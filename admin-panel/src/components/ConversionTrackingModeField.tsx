'use client';

import type { ConversionTrackingMode } from '@/lib/tracking/consent-mode';
import { CONVERSION_TRACKING_MODES } from '@/lib/tracking/consent-mode';

interface Props {
  value: ConversionTrackingMode;
  onChange: (mode: ConversionTrackingMode) => void;
  disabled: boolean;
  t: (key: string) => string;
}

const TONE: Record<ConversionTrackingMode, { wrapper: string; dot: string }> = {
  strict: {
    wrapper: 'border-sf-border-medium',
    dot: 'bg-sf-success',
  },
  limited: {
    wrapper: 'border-sf-accent/40 bg-sf-accent-soft/30',
    dot: 'bg-sf-accent',
  },
  permissive: {
    wrapper: 'border-sf-warning/40 bg-sf-warning-soft',
    dot: 'bg-sf-warning',
  },
};

export default function ConversionTrackingModeField({ value, onChange, disabled, t }: Props) {
  return (
    <fieldset
      className="mt-6 p-4 border border-sf-border-medium space-y-3"
      aria-describedby="conversion-tracking-mode-help"
    >
      <legend className="px-2 text-sm font-semibold text-sf-heading">{t('consent.modeTitle')}</legend>
      <p id="conversion-tracking-mode-help" className="text-xs text-sf-body">
        {t('consent.modeHelp')}
      </p>

      {disabled && (
        <p className="text-xs text-sf-warning">⚠️ {t('consent.requiresCAPI')}</p>
      )}

      <div className="space-y-3">
        {CONVERSION_TRACKING_MODES.map((mode) => (
          <ModeOption
            key={mode}
            mode={mode}
            selected={value === mode}
            disabled={disabled}
            onSelect={() => onChange(mode)}
            t={t}
          />
        ))}
      </div>
    </fieldset>
  );
}

interface ModeOptionProps {
  mode: ConversionTrackingMode;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  t: (key: string) => string;
}

function ModeOption({ mode, selected, disabled, onSelect, t }: ModeOptionProps) {
  const id = `conversion_tracking_mode_${mode}`;
  const labelKey = `consent.mode${capitalize(mode)}`;
  const descKey = `consent.mode${capitalize(mode)}Desc`;
  const tone = TONE[mode];

  return (
    <label
      htmlFor={id}
      className={`flex items-start gap-3 p-3 border cursor-pointer transition ${tone.wrapper} ${
        selected ? 'ring-2 ring-sf-accent' : ''
      } ${disabled ? 'opacity-60 cursor-not-allowed' : 'hover:bg-sf-raised'}`}
    >
      <input
        id={id}
        type="radio"
        name="conversion_tracking_mode"
        value={mode}
        checked={selected}
        onChange={onSelect}
        disabled={disabled}
        className="w-4 h-4 mt-0.5 text-sf-accent"
      />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${tone.dot}`} aria-hidden />
          <span className="text-sm font-medium text-sf-heading">{t(labelKey)}</span>
          {mode === 'limited' && (
            <span className="text-[10px] font-semibold tracking-wide text-sf-accent">
              {t('consent.modeLimitedRecommended').toUpperCase()}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-sf-body">{t(descKey)}</p>
        {mode === 'permissive' && (
          <p className="mt-2 text-xs text-sf-warning">⚠️ {t('consent.modePermissiveWarning')}</p>
        )}
      </div>
    </label>
  );
}

function capitalize<S extends string>(s: S): Capitalize<S> {
  return (s.charAt(0).toUpperCase() + s.slice(1)) as Capitalize<S>;
}
