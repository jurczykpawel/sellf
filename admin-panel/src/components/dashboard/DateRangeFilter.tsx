'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { CalendarIcon } from 'lucide-react';

interface DateRangeFilterProps {
  startDate: Date | null;
  endDate: Date | null;
  onChange: (start: Date | null, end: Date | null) => void;
}

export default function DateRangeFilter({ startDate, endDate, onChange }: DateRangeFilterProps) {
  const t = useTranslations('common');

  const formatDateForInput = (date: Date | null) => {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const handleStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const date = value ? new Date(value + 'T00:00:00') : null;
    onChange(date, endDate);
  };

  const handleEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const date = value ? new Date(value + 'T23:59:59') : null;
    onChange(startDate, date);
  };

  const handleClear = () => {
    onChange(null, null);
  };

  return (
    <div className="flex w-full flex-col items-start gap-2 sm:w-auto sm:flex-row sm:items-center">
      <div className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-2 px-3 py-2 bg-sf-base border-2 border-sf-border-subtle sm:flex sm:w-auto sm:gap-1">
        <CalendarIcon className="row-span-2 w-4 h-4 shrink-0 text-sf-muted" />
        <input
          type="date"
          value={formatDateForInput(startDate)}
          onChange={handleStartChange}
          max={formatDateForInput(endDate || new Date())}
          aria-label={t('startDate', { defaultValue: 'Start date' })}
          className="min-w-0 w-full bg-transparent border-none outline-none text-sm text-sf-body sm:w-[130px]"
        />
        <span className="hidden text-sf-muted text-sm sm:inline">-</span>
        <input
          type="date"
          value={formatDateForInput(endDate)}
          onChange={handleEndChange}
          min={formatDateForInput(startDate)}
          max={formatDateForInput(new Date())}
          aria-label={t('endDate', { defaultValue: 'End date' })}
          className="min-w-0 w-full bg-transparent border-none outline-none text-sm text-sf-body sm:w-[130px]"
        />
      </div>
      {(startDate || endDate) && (
        <button
          onClick={handleClear}
          className="px-3 py-2 text-sm text-sf-muted hover:text-sf-body"
        >
          {t('clear')}
        </button>
      )}
    </div>
  );
}
