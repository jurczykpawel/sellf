'use client';

import React from 'react';
import type { ProductFormData, TranslationFunction } from '../types';

interface ChecklistItem {
  key: 'name' | 'price' | 'recurring_price' | 'content' | 'bundle-components';
  /** Stable id alias of `key` — used by tests/integrations that key off `id`. */
  id: ChecklistItem['key'];
  label: string;
  ok: boolean;
  /** `done` alias of `ok` — mirrors the id/key naming so consumers can use either. */
  done: boolean;
}

/** Build a checklist item, keeping the key/id and ok/done aliases in sync. */
function item(key: ChecklistItem['key'], label: string, ok: boolean): ChecklistItem {
  return { key, id: key, label, ok, done: ok };
}

export function getPublishChecklist(
  formData: ProductFormData,
  priceDisplayValue: string,
  t: TranslationFunction,
): ChecklistItem[] {
  const items: ChecklistItem[] = [
    item('name', t('publish.name'), !!formData.name.trim()),
  ];

  const uxType = formData.ux_product_type;

  if (uxType === 'subscription') {
    items.push(item('recurring_price', t('publish.recurringPrice'), (formData.recurring_price ?? 0) > 0));
  } else if (uxType === 'lead-magnet') {
    const hasContent = (formData.content_config?.content_items?.length ?? 0) > 0;
    items.push(item('content', t('publish.leadMagnetFile'), hasContent));
  } else if (uxType === 'standard') {
    items.push(item('price', t('publish.price'), priceDisplayValue !== '' && formData.price > 0));
  }
  // tip-jar: only name required at publish (suggested amounts in step 1 PriceVatInline)

  // A bundle must group at least one component product before it can be published.
  if (formData.is_bundle) {
    items.push(item(
      'bundle-components',
      t('checklist.bundleComponents'),
      (formData.bundleItemIds?.length ?? 0) >= 1,
    ));
  }

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
