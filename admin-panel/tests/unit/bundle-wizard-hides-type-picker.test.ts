/**
 * A bundle is implicitly a one-time product — the "product type" picker
 * (Standard / Subscription / Tip jar / Lead magnet) must NOT appear in the
 * "New bundle" wizard. Regression: v2026.6.17 shipped bundles but the type
 * radio in the basics section lacked the `!is_bundle` guard.
 *
 * Rendered with renderToStaticMarkup (same approach as bundle-contents-preview).
 * The heavy sibling sections are stubbed so only the real ProductTypeRadio
 * (which emits `data-product-type` per option) participates in the assertion.
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';

vi.mock('@/components/ProductFormModal/sections', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ProductFormModal/sections')>();
  return {
    ...actual,
    BasicInfoSection: () => null,
    PriceVatInline: () => null,
    SubscriptionSection: () => null,
  };
});

import { BasicsPanel } from '@/components/ProductFormModal/wizard/panels/BasicsPanel';
import { initialFormData } from '@/components/ProductFormModal/types';

function renderStep(isBundle: boolean): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = {
    formData: { ...initialFormData, is_bundle: isBundle },
    setFormData: () => {},
    t: ((k: string) => k),
    nameInputRef: { current: null },
    slugModified: false,
    setSlugModified: () => {},
    currentDomain: 'example.com',
    generateSlug: (s: string) => s,
    fieldErrors: {},
    setFieldErrors: () => {},
    priceDisplayValue: '',
    setPriceDisplayValue: () => {},
    shopDefaultVatRate: 23,
    taxMode: 'local',
    isEditing: false,
  };
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      {
        locale: 'en',
        messages: {},
        onError: () => {},
        getMessageFallback: ({ key }: { key: string }) => key,
      },
      createElement(BasicsPanel, props),
    ),
  );
}

describe('Bundle wizard — product-type picker visibility', () => {
  it('shows the product-type radio for a normal (non-bundle) product', () => {
    expect(renderStep(false)).toContain('data-product-type');
  });

  it('hides the product-type radio when the product is a bundle', () => {
    expect(renderStep(true)).not.toContain('data-product-type');
  });
});
