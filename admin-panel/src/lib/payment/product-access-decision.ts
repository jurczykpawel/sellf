// Pure decision: given product + user + access state, return what the product
// page should render or redirect to. Server-side replacement for the
// useProductAccess hook so /p/[slug] doesn't render a spinner-then-flicker UI.

export interface ProductAccessInput {
  user: { id: string } | null;
  product: {
    id: string;
    is_active: boolean;
    available_from: string | null | undefined;
    available_until: string | null | undefined;
  };
  userAccess: ResolvedUserAccess | null;
  now: Date;
  previewMode?: boolean;
}

export interface ResolvedUserAccess {
  access_expires_at: string | null | undefined;
  access_duration_days: number | null | undefined;
  granted_at: string;
}

export type ProductAccessOutcome =
  | { kind: 'render-content'; userAccess: ResolvedUserAccess | null; preview?: true }
  | { kind: 'render-inactive' }
  | { kind: 'render-temporal' }
  | { kind: 'render-expired'; userAccess: ResolvedUserAccess }
  | { kind: 'redirect-checkout' };

export function decideProductAccessOutcome(
  input: ProductAccessInput,
): ProductAccessOutcome {
  const { user, product, userAccess, now, previewMode } = input;

  if (previewMode) {
    return { kind: 'render-content', userAccess: userAccess ?? null, preview: true };
  }

  if (!product.is_active) {
    return { kind: 'render-inactive' };
  }

  // Existing buyers keep their content even after the sale window closes.
  if (userAccess) {
    const expiresAt = userAccess.access_expires_at ? new Date(userAccess.access_expires_at) : null;
    if (expiresAt && expiresAt < now) {
      return { kind: 'render-expired', userAccess };
    }
    return { kind: 'render-content', userAccess };
  }

  const availableFrom = product.available_from ? new Date(product.available_from) : null;
  const availableUntil = product.available_until ? new Date(product.available_until) : null;
  const insideWindow = (!availableFrom || availableFrom <= now) && (!availableUntil || availableUntil > now);
  if (!insideWindow) {
    return { kind: 'render-temporal' };
  }

  // Active product, in window, no existing access → send buyer to checkout.
  // Works the same for guest and authenticated user.
  void user; // surfaced in API for future per-tier rules.
  return { kind: 'redirect-checkout' };
}
