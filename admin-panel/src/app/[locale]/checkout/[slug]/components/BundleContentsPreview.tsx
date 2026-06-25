'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { formatPrice } from '@/lib/constants';
import { computeBundleAnchor } from '@/lib/services/bundle-pricing';
import type { BundleComponentPrice } from '@/lib/services/bundle-pricing';

/**
 * A single bundle component as surfaced on the public checkout page. The price
 * fields mirror BundleComponentPrice (consumed by computeBundleAnchor) plus the
 * display-only fields needed to render the list row.
 */
export interface BundleComponentSummary extends BundleComponentPrice {
  id: string;
  name: string;
  icon: string;
  slug: string;
}

interface BundleContentsPreviewProps {
  /** The bundle's effective (sale-aware) unit price — used as the anchor. */
  bundlePrice: number;
  /** Currency code shared by the bundle and its components. */
  currency: string;
  components: BundleComponentSummary[];
}

/**
 * Public checkout "This bundle includes:" block.
 *
 * Renders the component list (icon + name) and an adaptive pricing line:
 *  - `savings` mode (bundle cheaper than buying separately): struck-through
 *    components sum + a localized "Save {amount} ({pct}% off)" claim.
 *  - `included` mode (bundle not cheaper): a neutral "This bundle includes:"
 *    heading with NO savings claim (avoids a false discount statement).
 *
 * The component list is always rendered regardless of mode.
 */
export default function BundleContentsPreview({
  bundlePrice,
  currency,
  components,
}: BundleContentsPreviewProps) {
  const t = useTranslations('checkout');

  const anchor = useMemo(
    () => computeBundleAnchor(bundlePrice, components),
    [bundlePrice, components],
  );

  return (
    <div className="mb-8" data-testid="bundle-contents-preview">
      <h3 className="text-xl font-bold text-sf-heading mb-4">
        {t('bundleIncludes')}
      </h3>

      <ul className="space-y-3 mb-4">
        {components.map((component) => (
          <li
            key={component.id}
            className="flex items-center gap-3 text-sf-body"
          >
            <span className="text-2xl flex-shrink-0" aria-hidden="true">
              {component.icon}
            </span>
            <span className="font-medium text-sf-heading">{component.name}</span>
          </li>
        ))}
      </ul>

      {anchor.mode === 'savings' && (
        <div className="flex items-center gap-2 text-sm" data-testid="bundle-savings">
          <span className="text-sf-muted line-through">
            {formatPrice(anchor.componentsSum, currency)}
          </span>
          <span className="font-semibold text-sf-success">
            {t('bundleSavings', {
              amount: formatPrice(anchor.savings, currency),
              pct: anchor.savingsPct,
            })}
          </span>
        </div>
      )}
    </div>
  );
}
