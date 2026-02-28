'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { convertLocalToUTC, convertUTCToLocal, addTimezoneInfo } from '@/lib/timezone';

interface DateTimePickerProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  description?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  showTimeSelect?: boolean;
  minDate?: Date;
  maxDate?: Date;
}

export default function DateTimePicker({
  value,
  onChange,
  placeholder,
  label,
  description,
  error,
  disabled = false,
  required = false,
  showTimeSelect = true,
  minDate,
  maxDate
}: DateTimePickerProps) {
  const tCommon = useTranslations('common');
  const displayPlaceholder = placeholder ?? tCommon('selectDateTime');
  // Convert UTC from database to local datetime-local format (YYYY-MM-DDTHH:mm)
  const formatForInput = (utcValue: string | undefined): string => {
    if (!utcValue) return '';
    const localDatetimeString = convertUTCToLocal(utcValue);
    if (!localDatetimeString) return '';
    // datetime-local expects YYYY-MM-DDTHH:mm format
    return localDatetimeString.slice(0, 16);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const localValue = e.target.value; // YYYY-MM-DDTHH:mm format
    if (!localValue) {
      onChange('');
      return;
    }
    // Convert local time to UTC ISO string for database
    const utcIsoString = convertLocalToUTC(localValue);
    onChange(utcIsoString);
  };

  const handleClear = () => {
    onChange('');
  };

  const formatMinMax = (date?: Date): string | undefined => {
    if (!date) return undefined;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-medium text-gf-body">
          {label}
          {required && <span className="text-gf-danger ml-1">*</span>}
          {!required && <span className="text-xs text-gf-muted ml-1">({tCommon('optional')})</span>}
        </label>
      )}

      <div className="flex items-center gap-1.5">
        <input
          type="datetime-local"
          value={formatForInput(value)}
          onChange={handleChange}
          onClick={(e) => {
            if (!disabled && 'showPicker' in e.currentTarget) {
              try { (e.currentTarget as HTMLInputElement).showPicker(); } catch {}
            }
          }}
          min={formatMinMax(minDate)}
          max={formatMinMax(maxDate)}
          disabled={disabled}
          placeholder={displayPlaceholder}
          className={`
            flex-1 min-w-0 px-3 py-2.5 border rounded-lg shadow-sm transition-all duration-200
            focus:outline-none focus:ring-2 focus:ring-gf-accent focus:border-transparent
            ${disabled
              ? 'bg-gf-raised text-gf-muted cursor-not-allowed'
              : 'bg-gf-input text-gf-heading hover:border-gf-border'
            }
            ${error
              ? 'border-gf-danger'
              : 'border-gf-border'
            }
          `}
        />
        {value && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="flex-shrink-0 p-1.5 text-gf-muted hover:text-gf-body hover:bg-gf-hover rounded-lg transition-colors"
            aria-label={tCommon('clearDate')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {description && (
        <p className="text-xs text-gf-muted">
          {addTimezoneInfo(description)}
        </p>
      )}

      {error && (
        <p className="text-xs text-gf-danger">
          {error}
        </p>
      )}
    </div>
  );
}
