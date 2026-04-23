import { STRIPE_MINIMUM_AMOUNT } from '@/lib/constants';

export interface CouponPricingInput {
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  code: string;
  exclude_order_bumps?: boolean;
  allowed_product_ids?: string[];
}

export interface CouponAllocationItem {
  id?: string;
  kind: 'base' | 'bump';
  price: number;
}

export interface CouponAllocationLineItem {
  id?: string;
  kind: 'base' | 'bump';
  originalPrice: number;
  eligible: boolean;
  discountAmount: number;
  finalPrice: number;
}

export interface CouponAllocationResult {
  items: CouponAllocationLineItem[];
  subtotal: number;
  discountAmount: number;
  total: number;
  isFree: boolean;
}

export function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

function fromMinorUnits(amount: number): number {
  return amount / 100;
}

export function allocateCouponDiscount(params: {
  items: CouponAllocationItem[];
  baseProductId?: string;
  coupon?: CouponPricingInput | null;
  applyMinimumFloor?: boolean;
  minimumAmount?: number;
}): CouponAllocationResult {
  const {
    items,
    baseProductId,
    coupon,
    applyMinimumFloor = true,
    minimumAmount = STRIPE_MINIMUM_AMOUNT,
  } = params;

  const workingItems = items.map((item) => ({
    ...item,
    originalMinor: toMinorUnits(item.price),
    finalMinor: toMinorUnits(item.price),
    eligible: false,
  }));

  const subtotalMinor = workingItems.reduce((sum, item) => sum + item.originalMinor, 0);

  if (!coupon) {
    return {
      items: workingItems.map((item) => ({
        id: item.id,
        kind: item.kind,
        originalPrice: fromMinorUnits(item.originalMinor),
        eligible: false,
        discountAmount: 0,
        finalPrice: fromMinorUnits(item.finalMinor),
      })),
      subtotal: fromMinorUnits(subtotalMinor),
      discountAmount: 0,
      total: fromMinorUnits(subtotalMinor),
      isFree: false,
    };
  }

  const allowedProductIds = coupon.allowed_product_ids ?? [];
  const couponIsGlobal = allowedProductIds.length === 0;

  for (const item of workingItems) {
    if (item.kind === 'base') {
      item.eligible = couponIsGlobal || !baseProductId || allowedProductIds.includes(baseProductId);
      continue;
    }

    item.eligible = !coupon.exclude_order_bumps && couponIsGlobal;
  }

  const eligibleItems = workingItems.filter((item) => item.eligible && item.originalMinor > 0);
  const eligibleSubtotalMinor = eligibleItems.reduce((sum, item) => sum + item.originalMinor, 0);

  let discountMinor = 0;
  if (eligibleSubtotalMinor > 0) {
    discountMinor = coupon.discount_type === 'percentage'
      ? Math.min(
          eligibleSubtotalMinor,
          Math.round(eligibleSubtotalMinor * (coupon.discount_value / 100)),
        )
      : Math.min(eligibleSubtotalMinor, toMinorUnits(coupon.discount_value));
  }

  if (discountMinor > 0) {
    const allocations = eligibleItems.map((item) => {
      const rawShare = (discountMinor * item.originalMinor) / eligibleSubtotalMinor;
      const allocatedMinor = Math.floor(rawShare);
      return {
        item,
        allocatedMinor,
        remainder: rawShare - allocatedMinor,
      };
    });

    let remainingMinor = discountMinor - allocations.reduce((sum, allocation) => sum + allocation.allocatedMinor, 0);

    allocations
      .sort((a, b) => b.remainder - a.remainder)
      .forEach((allocation) => {
        if (remainingMinor <= 0) return;
        if (allocation.allocatedMinor >= allocation.item.originalMinor) return;
        allocation.allocatedMinor += 1;
        remainingMinor -= 1;
      });

    for (const allocation of allocations) {
      allocation.item.finalMinor = Math.max(0, allocation.item.originalMinor - allocation.allocatedMinor);
    }
  }

  let totalMinor = workingItems.reduce((sum, item) => sum + item.finalMinor, 0);
  const minimumMinor = toMinorUnits(minimumAmount);
  const isFree = coupon !== null && totalMinor <= 0;

  if (applyMinimumFloor && totalMinor > 0 && totalMinor < minimumMinor) {
    const baseItem = workingItems.find((item) => item.kind === 'base') ?? workingItems[0];
    if (baseItem) {
      baseItem.finalMinor += minimumMinor - totalMinor;
      totalMinor = minimumMinor;
    }
  }

  return {
    items: workingItems.map((item) => ({
      id: item.id,
      kind: item.kind,
      originalPrice: fromMinorUnits(item.originalMinor),
      eligible: item.eligible,
      discountAmount: fromMinorUnits(item.originalMinor - item.finalMinor),
      finalPrice: fromMinorUnits(item.finalMinor),
    })),
    subtotal: fromMinorUnits(subtotalMinor),
    discountAmount: fromMinorUnits(subtotalMinor - totalMinor),
    total: isFree ? 0 : fromMinorUnits(totalMinor),
    isFree,
  };
}
