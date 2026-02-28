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
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 px-3 py-2 bg-gf-base border border-gf-border rounded-lg shadow-sm">
        <CalendarIcon className="w-4 h-4 text-gf-muted" />
        <input
          type="date"
          value={formatDateForInput(startDate)}
          onChange={handleStartChange}
          max={formatDateForInput(endDate || new Date())}
          className="bg-transparent border-none outline-none text-sm text-gf-body w-[130px]"
        />
        <span className="text-gf-muted text-sm">-</span>
        <input
          type="date"
          value={formatDateForInput(endDate)}
          onChange={handleEndChange}
          min={formatDateForInput(startDate)}
          max={formatDateForInput(new Date())}
          className="bg-transparent border-none outline-none text-sm text-gf-body w-[130px]"
        />
      </div>
      {(startDate || endDate) && (
        <button
          onClick={handleClear}
          className="px-3 py-2 text-sm text-gf-muted hover:text-gf-body"
        >
          {t('clear')}
        </button>
      )}
    </div>
  );
}
