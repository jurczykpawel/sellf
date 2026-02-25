'use client';

import React from 'react';
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
  placeholder = "Select date and time",
  label,
  description,
  error,
  disabled = false,
  required = false,
  showTimeSelect = true,
  minDate,
  maxDate
}: DateTimePickerProps) {
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
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
          {!required && <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">(optional)</span>}
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
          placeholder={placeholder}
          className={`
            flex-1 min-w-0 px-3 py-2.5 border rounded-lg shadow-sm transition-all duration-200
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
            ${disabled
              ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
              : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:border-gray-400 dark:hover:border-gray-500'
            }
            ${error
              ? 'border-red-300 dark:border-red-600'
              : 'border-gray-300 dark:border-gray-600'
            }
          `}
        />
        {value && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="flex-shrink-0 p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            aria-label="Clear date"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {description && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {addTimezoneInfo(description)}
        </p>
      )}

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
