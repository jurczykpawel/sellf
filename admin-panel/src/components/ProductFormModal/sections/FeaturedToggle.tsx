'use client';

import React from 'react';
import type { SectionProps } from '../types';

export function FeaturedToggle({ formData, setFormData, t }: SectionProps) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={formData.is_featured}
        onChange={(e) =>
          setFormData((prev) => ({ ...prev, is_featured: e.target.checked }))
        }
        className="h-4 w-4 text-sf-accent focus:ring-sf-accent border-sf-border rounded"
      />
      <span className="text-sm font-medium text-sf-heading">
        {t('featuredProduct')}
      </span>
      <span className="text-xs text-sf-muted">{t('featuredProductHelp')}</span>
    </label>
  );
}
