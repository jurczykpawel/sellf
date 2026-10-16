'use client';

import React, { useMemo } from 'react';
import { useLocale } from 'next-intl';
import { formatPrice } from '@/lib/constants';
import OrderedItemPicker from '@/components/ui/OrderedItemPicker';
import { computeBundleAnchor } from '@/lib/services/bundle-pricing';
import { getEffectiveUnitPrice } from '@/lib/services/omnibus';
import type { Product } from '@/types';
import type { BundleItemsSectionProps } from '@/components/ProductFormModal/types';

/**
 * BundleItemsSection — admin picker for the component products of a bundle.
 *
 * A bundle (is_bundle=true) groups existing one-time products as components.
 * This section lets the seller search for eligible products, add them (ordered),
 * reorder them, and see a live "anchor" comparing the sum of the components'
 * prices against the bundle's effective price.
 *
 * @see @/lib/services/bundle-pricing (computeBundleAnchor)
 * @see @/lib/services/omnibus (getEffectiveUnitPrice)
 */
export function BundleItemsSection({
  formData,
  setFormData,
  t,
  products,
  currentProductId,
}: BundleItemsSectionProps) {
  const locale = useLocale();


  // Stable reference for the ordered selection so memo deps don't churn each render.
  const selectedIds = useMemo(() => formData.bundleItemIds ?? [], [formData.bundleItemIds]);

  // Index products by id for O(1) lookup when resolving the ordered selection.
  const productsById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of products) map.set(p.id, p);
    return map;
  }, [products]);

  // Eligible components: not a bundle itself, not a subscription, not the product
  // being edited (no self-reference).
  const eligible = useMemo(
    () =>
      products.filter(
        (p) =>
          !p.is_bundle &&
          p.product_type !== 'subscription' &&
          p.id !== currentProductId,
      ),
    [products, currentProductId],
  );

  // Ordered, resolved selection (skips ids that no longer resolve to a product).
  const selectedComponents = useMemo(
    () =>
      selectedIds
        .map((id) => productsById.get(id))
        .filter((p): p is Product => p !== undefined),
    [selectedIds, productsById],
  );

  const setSelected = (next: string[]) => {
    setFormData((prev) => ({ ...prev, bundleItemIds: next }));
  };

  // Live anchor: compare the bundle's effective price to the sum of components.
  const anchor = useMemo(
    () => computeBundleAnchor(getEffectiveUnitPrice(formData), selectedComponents),
    [formData, selectedComponents],
  );

  const currency = formData.currency;

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium text-sf-heading">{t('bundle.title')}</h4>
        <p className="mt-1 text-xs text-sf-muted">{t('bundle.help')}</p>
      </div>

      <OrderedItemPicker
        label={t('bundle.addLabel')}
        items={eligible.map(product => ({ id: product.id, name: product.name, image: product.thumbnail_url ?? product.image_url,
          detail: formatPrice(getEffectiveUnitPrice(product), product.currency, locale), unavailable: !product.is_active }))}
        selectedIds={selectedIds}
        onChange={setSelected}
      />

      {/* Live anchor */}
      {selectedComponents.length > 0 && (
        <div className="bg-sf-accent-soft p-3 rounded-lg">
          {anchor.mode === 'savings' ? (
            <p className="text-sm text-sf-accent">
              <span className="line-through text-sf-muted mr-2">
                {formatPrice(anchor.componentsSum, currency, locale)}
              </span>
              {t('bundle.savings', {
                savings: formatPrice(anchor.savings, currency, locale),
                pct: anchor.savingsPct,
              })}
            </p>
          ) : (
            <p className="text-sm text-sf-accent">ℹ️ {t('bundle.includedInfo')}</p>
          )}
        </div>
      )}
    </div>
  );
}
