/**
 * Magic-link `emailRedirectTo` URL builders.
 *
 * Both flows route post-login traffic through `/auth/product-access`, which
 * resolves access state and redirects to the product page.
 */

interface PostCheckoutInput {
  origin: string;
  productSlug: string;
  sessionId: string | undefined;
  paymentIntentId: string | undefined;
}

interface FreeProductInput {
  origin: string;
  productSlug: string;
  couponCode?: string | null;
  successUrl?: string | null;
}

function buildAuthCallbackUrl(origin: string, redirectPath: string): string {
  return `${origin}/auth/callback?redirect_to=${encodeURIComponent(redirectPath)}`;
}

function buildProductAccessPath(productSlug: string, params?: Record<string, string | null | undefined>): string {
  // encodeURIComponent (not URLSearchParams) so spaces become %20, not '+',
  // matching how the rest of the codebase builds redirect targets.
  const parts = [`product=${encodeURIComponent(productSlug)}`];
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) parts.push(`${k}=${encodeURIComponent(v)}`);
    }
  }
  return `/auth/product-access?${parts.join('&')}`;
}

/**
 * Magic-link callback URL for the post-checkout flow.
 *
 * `sessionId` / `paymentIntentId` are accepted by the call sites for symmetry
 * with the upstream API but are not embedded in the returned URL. After
 * login the user lands on /auth/product-access which resolves access state
 * and routes onward.
 */
export function buildPostCheckoutMagicLinkRedirect(input: PostCheckoutInput): string {
  void input.sessionId;
  void input.paymentIntentId;
  const redirectPath = buildProductAccessPath(input.productSlug);
  return buildAuthCallbackUrl(input.origin, redirectPath);
}

/**
 * Magic-link callback URL for a plain login (no product context). Deliberately
 * omits `redirect_to` so `/auth/callback` falls through to its own role-based
 * default (admins → /dashboard, everyone else → /my-products). `flow=login`
 * keeps a `?` in the URL — required because email templates append
 * `&token_hash=...` after it; the callback ignores unrecognized params.
 */
export function buildLoginMagicLinkRedirect(origin: string): string {
  return `${origin}/auth/callback?flow=login`;
}

/**
 * Magic-link callback URL for the free-product flow (`useFreeAccess`,
 * `FreeProductForm`, embed free-access API). Coupon and success_url are passed
 * through; the product slug + coupon are non-secret values already available
 * to the client building this URL.
 */
export function buildFreeProductMagicLinkRedirect(input: FreeProductInput): string {
  const redirectPath = buildProductAccessPath(input.productSlug, {
    coupon: input.couponCode ?? undefined,
    success_url: input.successUrl ?? undefined,
  });
  return buildAuthCallbackUrl(input.origin, redirectPath);
}
