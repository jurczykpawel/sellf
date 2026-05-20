'use client';

import React from 'react';
import { AdvancedSectionProps } from '../types';

export function AdvancedSection({
  formData,
  setFormData,
  t,
  omnibusEnabled,
}: AdvancedSectionProps) {
  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: checked,
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center">
        <input
          type="checkbox"
          id="is_active"
          name="is_active"
          checked={formData.is_active}
          onChange={handleCheckboxChange}
          className="h-4 w-4 text-sf-accent focus:ring-sf-accent border-sf-border rounded"
        />
        <label htmlFor="is_active" className="ml-3 block text-sm font-medium text-sf-heading">
          {t('productActive')}
        </label>
      </div>

      <div className="flex items-center">
        <input
          type="checkbox"
          id="is_listed"
          name="is_listed"
          checked={formData.is_listed}
          onChange={handleCheckboxChange}
          className="h-4 w-4 text-sf-accent focus:ring-sf-accent border-sf-border rounded"
        />
        <label htmlFor="is_listed" className="ml-3 block text-sm font-medium text-sf-heading">
          {t('productListed')}
        </label>
        <span className="ml-2 text-xs text-sf-muted">{t('productListedHelp')}</span>
      </div>

      {omnibusEnabled && (
        <div className="flex items-center">
          <input
            type="checkbox"
            id="omnibus_exempt"
            name="omnibus_exempt"
            checked={formData.omnibus_exempt}
            onChange={handleCheckboxChange}
            className="h-4 w-4 text-sf-accent focus:ring-sf-accent border-sf-border rounded"
          />
          <label
            htmlFor="omnibus_exempt"
            className="ml-3 block text-sm font-medium text-sf-heading"
          >
            {t('omnibusExempt')}
          </label>
          <span className="ml-2 text-xs text-sf-muted">{t('omnibusExemptHelp')}</span>
        </div>
      )}
    </div>
  );
}
