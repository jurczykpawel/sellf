import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSafeRedirectUrl } from '@/lib/validations/redirect';
import { isInternalHostname } from '@/lib/security/internal-hostname';
import { grantFreeProductAccess } from '@/lib/services/free-product-access';

/**
 * Product Access Route
 *
 * Handles the magic link callback after a user claims a free product.
 * Flow: FreeProductForm -> magic link email -> /auth/callback -> this route
 *
 * Query params:
 *   product    - product slug (required)
 *   return_url - override redirect target (validated for safety)
 *   success_url - OTO/funnel success URL passthrough
 */

function safeRedirect(url: string, returnUrl?: string | null) {
  if (returnUrl && isSafeRedirectUrl(returnUrl)) {
    try {
      redirect(returnUrl);
    } catch (error) {
      if (error instanceof Error && error.message.includes('NEXT_REDIRECT')) throw error;
      redirect(url);
    }
  } else {
    redirect(url);
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('product');
  const returnUrl = searchParams.get('return_url');
  const successUrl = searchParams.get('success_url');
  const rawCoupon = searchParams.get('coupon');
  const couponCode = rawCoupon && rawCoupon.trim().length > 0
    ? rawCoupon.trim().toUpperCase()
    : null;

  if (!slug) {
    safeRedirect('/');
    return;
  }

  // Build product URL once - used for all fallback redirects
  const prodUrl = `/p/${slug}`;
  const statusUrl = `/p/${slug}/payment-status`;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    safeRedirect(prodUrl, returnUrl);
    return;
  }

  try {
    // Single product fetch (avoids redundant query).
    // Eligibility (price=0 / PWYW-free / full-discount coupon) is decided inside
    // the unified grant RPC, so this route only needs product + access state.
    const { data: product } = await supabase
      .from('products')
      .select('id, is_active, content_delivery_type, content_config')
      .eq('slug', slug)
      .single();

    if (!product) {
      safeRedirect('/', returnUrl);
      return;
    }

    // Check existing access
    const { data: existingAccess } = await supabase
      .from('user_product_access')
      .select('id')
      .eq('user_id', user.id)
      .eq('product_id', product.id)
      .maybeSingle();

    // No access yet — delegate to the service. It decides eligibility + validates
    // the coupon (if any) + records the redemption + generates OTO, all atomically.
    if (!existingAccess) {
      if (!product.is_active) {
        safeRedirect('/', returnUrl);
        return;
      }

      const adminClient = createAdminClient();
      const result = await grantFreeProductAccess(supabase, adminClient, {
        product: { id: product.id, slug },
        user: { id: user.id, email: user.email ?? '' },
        couponCode: couponCode ?? undefined,
      });

      if (!result.accessGranted) {
        // Product is paid and no valid full-discount coupon was supplied (or the
        // coupon was rejected). Send them to the product page so they can buy.
        console.error(`[ProductAccess] Grant failed: ${result.error}`);
        safeRedirect(prodUrl, returnUrl);
        return;
      }

      const propagatedSuccessUrl = successUrl && isSafeRedirectUrl(successUrl) ? successUrl : null;
      const qs = propagatedSuccessUrl
        ? `${statusUrl.includes('?') ? '&' : '?'}success_url=${encodeURIComponent(propagatedSuccessUrl)}`
        : '';
      safeRedirect(`${statusUrl}${qs}`, returnUrl);
      return;
    }

    // User has access - check content delivery type for redirect products
    if (product.content_delivery_type === 'redirect' && product.content_config?.redirect_url) {
      try {
        const redirectUrl = new URL(product.content_config.redirect_url);
        if (redirectUrl.protocol !== 'https:' && redirectUrl.protocol !== 'http:') {
          safeRedirect(prodUrl, returnUrl);
          return;
        }
        if (isInternalHostname(redirectUrl.hostname)) {
          safeRedirect(prodUrl, returnUrl);
          return;
        }
        redirect(redirectUrl.href);
      } catch (error) {
        if (error instanceof Error && error.message.includes('NEXT_REDIRECT')) throw error;
        safeRedirect(prodUrl, returnUrl);
        return;
      }
    } else {
      safeRedirect(prodUrl, returnUrl);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('NEXT_REDIRECT')) throw error;
    safeRedirect(prodUrl, returnUrl);
  }
}
