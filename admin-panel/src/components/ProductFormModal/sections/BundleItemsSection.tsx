'use client';

import React, { useMemo, useState } from 'react';
import { formatPrice } from '@/lib/constants';
import { computeBundleAnchor } from '@/lib/services/bundle-pricing';
import { getEffectiveUnitPrice } from '@/lib/services/omnibus';
import type { Product } from '@/types';
import { BundleItemsSectionProps } from '../types';

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
  const [search, setSearch] = useState('');

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

  // Candidates for the "add" picker: eligible, not already selected, matching search.
  const candidates = useMemo(() => {
    const term = search.trim().toLowerCase();
    return eligible.filter(
      (p) =>
        !selectedIds.includes(p.id) &&
        (term === '' || p.name.toLowerCase().includes(term)),
    );
  }, [eligible, selectedIds, search]);

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

  const addComponent = (id: string) => {
    if (selectedIds.includes(id)) return;
    setSelected([...selectedIds, id]);
  };

  const removeComponent = (id: string) => {
    setSelected(selectedIds.filter((x) => x !== id));
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= selectedIds.length) return;
    const next = [...selectedIds];
    [next[index], next[target]] = [next[target], next[index]];
    setSelected(next);
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

      {/* Searchable picker */}
      <div>
        <label htmlFor="bundle-search" className="block text-sm font-medium text-sf-body mb-2">
          {t('bundle.addLabel')}
        </label>
        <input
          id="bundle-search"
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('bundle.searchPlaceholder')}
          className="w-full px-3 py-2.5 border-2 border-sf-border-medium focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent bg-sf-input text-sf-heading"
        />
        {candidates.length > 0 ? (
          <ul className="mt-2 max-h-48 overflow-y-auto border border-sf-border rounded-lg divide-y divide-sf-border bg-sf-raised">
            {candidates.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => addComponent(p.id)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-sf-hover transition-colors"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-base shrink-0">{p.icon || '📦'}</span>
                    <span className="truncate text-sm text-sf-heading">{p.name}</span>
                    {!p.is_active && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[0.55rem] font-semibold uppercase tracking-wide bg-sf-warning-soft text-sf-warning">
                        {t('bundle.inactiveBadge')}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-sf-muted">
                    {formatPrice(getEffectiveUnitPrice(p), p.currency)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-sf-muted">
            {search.trim() !== '' ? t('bundle.noMatches') : t('bundle.noMoreProducts')}
          </p>
        )}
      </div>

      {/* Selected components (ordered) */}
      <div>
        <label className="block text-sm font-medium text-sf-body mb-2">
          {t('bundle.selectedLabel', { count: selectedComponents.length })}
        </label>
        {selectedComponents.length === 0 ? (
          <p className="text-xs text-sf-muted bg-sf-raised border border-sf-border rounded-lg px-3 py-3">
            {t('bundle.emptyHint')}
          </p>
        ) : (
          <ul className="border border-sf-border rounded-lg divide-y divide-sf-border bg-sf-raised">
            {selectedComponents.map((p, index) => (
              <li key={p.id} className="px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-sf-muted w-5 shrink-0">{index + 1}.</span>
                    <span className="text-base shrink-0">{p.icon || '📦'}</span>
                    <span className="truncate text-sm text-sf-heading">{p.name}</span>
                    {!p.is_active && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[0.55rem] font-semibold uppercase tracking-wide bg-sf-warning-soft text-sf-warning">
                        {t('bundle.inactiveBadge')}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs text-sf-muted mr-1">
                      {formatPrice(getEffectiveUnitPrice(p), p.currency)}
                    </span>
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label={t('bundle.moveUp')}
                      title={t('bundle.moveUp')}
                      className="p-1 text-sf-muted hover:text-sf-heading disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === selectedComponents.length - 1}
                      aria-label={t('bundle.moveDown')}
                      title={t('bundle.moveDown')}
                      className="p-1 text-sf-muted hover:text-sf-heading disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeComponent(p.id)}
                      aria-label={t('bundle.remove')}
                      title={t('bundle.remove')}
                      className="p-1 text-sf-muted hover:text-sf-danger transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                </div>
                {!p.is_active && (
                  <p className="mt-1 ml-7 text-[0.7rem] text-sf-warning">
                    ℹ️ {t('bundle.inactiveWarning')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Live anchor */}
      {selectedComponents.length > 0 && (
        <div className="bg-sf-accent-soft p-3 rounded-lg">
          {anchor.mode === 'savings' ? (
            <p className="text-sm text-sf-accent">
              <span className="line-through text-sf-muted mr-2">
                {formatPrice(anchor.componentsSum, currency)}
              </span>
              {t('bundle.savings', {
                savings: formatPrice(anchor.savings, currency),
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
