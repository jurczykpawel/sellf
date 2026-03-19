import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createSellerAdminClient, getSellerBySlug } from '@/lib/marketplace/seller-client';
import { isSafeRedirectUrl } from '@/lib/validations/redirect';
import { productUrl, paymentStatusUrl } from '@/lib/utils/product-urls';

/**
 * Product Access Route
 *
 * Handles the magic link callback after a user claims a free product.
 * Flow: FreeProductForm → magic link email → /auth/callback → this route
 *
 * Query params:
 *   product    — product slug (required)
 *   seller     — seller slug (optional, for marketplace products)
 *   return_url — override redirect target (validated for safety)
 *   success_url — OTO/funnel success URL passthrough
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
  const sellerSlug = searchParams.get('seller');
  const returnUrl = searchParams.get('return_url');
  const successUrl = searchParams.get('success_url');

  if (!slug) {
    safeRedirect('/');
    return;
  }

  // Build product URL once — used for all fallback redirects
  const prodUrl = productUrl(slug, sellerSlug);
  const statusUrl = paymentStatusUrl(slug, sellerSlug);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    safeRedirect(prodUrl, returnUrl);
    return;
  }

  // Resolve data client: seller schema or platform (seller_main)
  let dataClient: typeof supabase = supabase;
  if (sellerSlug) {
    const seller = await getSellerBySlug(sellerSlug);
    if (seller) {
      dataClient = createSellerAdminClient(seller.schema_name) as unknown as typeof supabase;
    }
  }

  try {
    // Check existing access
    const { data: product } = await dataClient
      .from('products')
      .select('id')
      .eq('slug', slug)
      .single();

    let existingAccess = null;
    if (product) {
      const { data } = await dataClient
        .from('user_product_access')
        .select('*')
        .eq('user_id', user.id)
        .eq('product_id', product.id)
        .maybeSingle();
      existingAccess = data;
    }

    // No access yet — check if product is free and grant
    if (!existingAccess) {
      const { data: productDetails, error: productError } = await dataClient
        .from('products')
        .select('*')
        .eq('slug', slug)
        .eq('is_active', true)
        .single();

      if (productError || !productDetails) {
        safeRedirect('/', returnUrl);
        return;
      }

      const isPwywFree = productDetails.allow_custom_price && productDetails.custom_price_min === 0;
      const isFreeEligible = productDetails.price === 0 || isPwywFree;

      if (isFreeEligible) {
        const rpcName = isPwywFree && productDetails.price > 0 ? 'grant_pwyw_free_access' : 'grant_free_product_access';
        const { data: accessResult, error: grantError } = await dataClient
          .rpc(rpcName, {
            product_slug_param: slug,
            access_duration_days_param: null,
          });

        if (grantError) {
          console.error(`[ProductAccess] Error granting access:`, grantError);
          safeRedirect(prodUrl, returnUrl);
          return;
        }

        if (accessResult) {
          const qs = successUrl ? `${statusUrl.includes('?') ? '&' : '?'}success_url=${encodeURIComponent(successUrl)}` : '';
          safeRedirect(`${statusUrl}${qs}`, returnUrl);
          return;
        }

        console.error(`[ProductAccess] ${rpcName} returned false`);
        safeRedirect(prodUrl, returnUrl);
        return;
      }

      // Paid product — redirect to product/checkout page
      safeRedirect(prodUrl, returnUrl);
      return;
    }

    // User has access — check content delivery type for redirect products
    const { data: redirectProduct } = await dataClient
      .from('products')
      .select('content_delivery_type, content_config')
      .eq('slug', slug)
      .single();

    if (redirectProduct?.content_delivery_type === 'redirect' && redirectProduct?.content_config?.redirect_url) {
      try {
        const redirectUrl = new URL(redirectProduct.content_config.redirect_url);
        if (redirectUrl.protocol !== 'https:' && redirectUrl.protocol !== 'http:') {
          safeRedirect(prodUrl, returnUrl);
          return;
        }
        const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0'];
        if (blockedHosts.includes(redirectUrl.hostname)) {
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
