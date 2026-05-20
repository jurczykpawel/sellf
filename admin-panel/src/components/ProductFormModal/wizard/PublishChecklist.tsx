'use client';

import React from 'react';
import type { ProductFormData, TranslationFunction } from '../types';

interface ChecklistItem {
  key: 'name' | 'price' | 'recurring_price' | 'content';
  label: string;
  ok: boolean;
}

export function getPublishChecklist(
  formData: ProductFormData,
  priceDisplayValue: string,
  t: TranslationFunction,
): ChecklistItem[] {
  const items: ChecklistItem[] = [
    { key: 'name', label: t('publish.name'), ok: !!formData.name.trim() },
  ];

  const uxType = formData.ux_product_type;

  if (uxType === 'subscription') {
    items.push({
      key: 'recurring_price',
      label: t('publish.recurringPrice'),
      ok: (formData.recurring_price ?? 0) > 0,
    });
  } else if (uxType === 'lead-magnet') {
    const hasContent = (formData.content_config?.content_items?.length ?? 0) > 0;
    items.push({
      key: 'content',
      label: t('publish.leadMagnetFile'),
      ok: hasContent,
    });
  } else if (uxType === 'standard') {
    items.push({
      key: 'price',
      label: t('publish.price'),
      ok: priceDisplayValue !== '' && formData.price > 0,
    });
  }
  // tip-jar: only name required at publish (suggested amounts in step 1 PriceVatInline)

  return items;
}

interface PublishChecklistProps {
  formData: ProductFormData;
  priceDisplayValue: string;
  t: TranslationFunction;
}

export function PublishChecklist({ formData, priceDisplayValue, t }: PublishChecklistProps) {
  const items = getPublishChecklist(formData, priceDisplayValue, t);
  return (
    <ul
      data-testid="publish-checklist"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-sf-muted"
    >
      {items.map((item) => (
        <li
          key={item.key}
          data-checklist-key={item.key}
          data-checklist-ok={item.ok ? 'true' : 'false'}
          className="flex items-center gap-1.5"
        >
          <span className={item.ok ? 'text-sf-success' : 'text-sf-muted'}>
            {item.ok ? '✓' : '○'}
          </span>
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
