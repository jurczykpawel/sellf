import { getEffectiveUnitPrice } from '@/lib/services/omnibus';

export interface BundleComponentPrice {
  price: number;
  sale_price?: number | null;
  sale_price_until?: string | null;
  sale_quantity_limit?: number | null;
  sale_quantity_sold?: number | null;
  allow_custom_price?: boolean;
  custom_price_min?: number | null;
}

export interface BundleAnchor {
  componentsSum: number;
  savings: number;
  savingsPct: number;
  mode: 'savings' | 'included';
}

/** Weight a component for the anchor sum: PWYW → custom_price_min (suggested), else effective price. */
function componentWeight(c: BundleComponentPrice): number {
  if (c.allow_custom_price) return Math.max(0, c.custom_price_min ?? 0);
  return getEffectiveUnitPrice(c);
}

export function computeBundleAnchor(
  bundleEffectivePrice: number,
  components: BundleComponentPrice[],
): BundleAnchor {
  const componentsSum = components.reduce((s, c) => s + componentWeight(c), 0);
  const isSavings = bundleEffectivePrice < componentsSum;
  const savings = isSavings ? componentsSum - bundleEffectivePrice : 0;
  const savingsPct = isSavings && componentsSum > 0 ? Math.round((savings / componentsSum) * 100) : 0;
  return { componentsSum, savings, savingsPct, mode: isSavings ? 'savings' : 'included' };
}
