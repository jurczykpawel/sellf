'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isSafeRedirectUrl } from '@/lib/validations/redirect';

/**
 * Helper function to handle redirect with return_url support
 */
function handleRedirect(url: string, returnUrl?: string | null) {
  if (returnUrl && isSafeRedirectUrl(returnUrl)) {
    try {
      redirect(returnUrl);
    } catch (error) {
      // Only catch actual errors, not NEXT_REDIRECT
      if (error instanceof Error && error.message.includes('NEXT_REDIRECT')) {
        throw error;
      }
      redirect(url);
    }
  } else {
    redirect(url);
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const productSlug = searchParams.get('product');
  const returnUrl = searchParams.get('return_url');
  const successUrl = searchParams.get('success_url');

  // If no product slug is provided, redirect to homepage
  if (!productSlug) {
    handleRedirect('/');
    return;
  }

  // Initialize Supabase client
  const supabase = await createClient();

  // Get authenticated user
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    // If user is not authenticated, redirect to product page with return_url preserved
    handleRedirect(`/p/${productSlug}`, returnUrl);
    return;
  }

  try {
    // First, check if the user already has access to the product
    const { data: existingAccess, error: accessError } = await supabase
      .from('user_product_access')
      .select('*, products!inner(slug)')
      .eq('user_id', user.id)
      .eq('products.slug', productSlug)
      .single();

    if (accessError && accessError.code !== 'PGRST116') { // PGRST116 is "not found" error
      console.error(`[ProductAccess] Error checking existing access:`, accessError);
      // Continue execution instead of redirecting - we'll just attempt to grant access
    }

    // If the user doesn't have access, check if product is free and grant access if so
    if (!existingAccess) {
      const { data: product, error: productError } = await supabase
        .from('products')
        .select('*')
        .eq('slug', productSlug)
        .eq('is_active', true)
        .single();

      if (productError) {
        console.error(`[ProductAccess] Error fetching product:`, productError);
        // If we can't find the product, redirect to home page with return_url
        handleRedirect('/', returnUrl);
        return;
      }

      if (!product) {
        handleRedirect('/', returnUrl);
        return;
      }

      // Check if product qualifies for free access grant
      const isPwywFree = product.allow_custom_price && (product.custom_price_min === 0 || product.custom_price_min === null);
      const isFreeEligible = product.price === 0 || isPwywFree;

      if (isFreeEligible) {
        // Use appropriate RPC based on product type
        const rpcName = isPwywFree && product.price > 0 ? 'grant_pwyw_free_access' : 'grant_free_product_access';
        const { data: accessResult, error: grantError } = await supabase
          .rpc(rpcName, {
            product_slug_param: productSlug,
            access_duration_days_param: null // Will use product's auto_grant_duration_days
          });

        if (grantError) {
          console.error(`[ProductAccess] Error granting access:`, grantError);
          handleRedirect(`/p/${productSlug}`, returnUrl);
          return;
        } else if (accessResult) {
          // Redirect to payment success page to show confetti
          const paymentStatusUrl = `/p/${productSlug}/payment-status${successUrl ? `?success_url=${encodeURIComponent(successUrl)}` : ''}`;
          handleRedirect(paymentStatusUrl, returnUrl);
          return;
        } else {
          console.error(`[ProductAccess] ${rpcName} returned false - product might not qualify`);
          handleRedirect(`/p/${productSlug}`, returnUrl);
          return;
        }
      } else {
        // If product exists but is not free, redirect to payment page with return_url
        handleRedirect(`/p/${productSlug}`, returnUrl);
        return;
      }
    }
    // At this point, user either already had access or we've granted it (for free products)
    // Get the product's content delivery configuration
    const { data: product, error: redirectError } = await supabase
      .from('products')
      .select('content_delivery_type, content_config')
      .eq('slug', productSlug)
      .single();

    if (redirectError) {
      console.error(`[ProductAccess] Error fetching product for redirect:`, redirectError);
      // If we can't fetch the redirect info, just go to the product page with return_url
      handleRedirect(`/p/${productSlug}`, returnUrl);
      return;
    }

    // Redirect to the specified URL if available, otherwise to the product page
    if (product?.content_delivery_type === 'redirect' && product?.content_config?.redirect_url) {
      // Security: Validate redirect URL to prevent open redirect attacks
      try {
        const redirectUrl = new URL(product.content_config.redirect_url);
        
        // Basic security checks
        if (redirectUrl.protocol !== 'https:' && redirectUrl.protocol !== 'http:') {
          console.warn(`[ProductAccess] Invalid protocol in redirect URL: ${redirectUrl.protocol}`);
          handleRedirect(`/p/${productSlug}`, returnUrl);
          return;
        }
        
        // Block dangerous URLs (can be expanded)
        const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0'];
        if (blockedHosts.includes(redirectUrl.hostname)) {
          console.warn(`[ProductAccess] Blocked redirect to localhost/internal IP`);
          handleRedirect(`/p/${productSlug}`, returnUrl);
          return;
        }
        
        // Redirect to the validated URL
        redirect(product.content_config.redirect_url);
      } catch (error) {
        console.error(`[ProductAccess] Invalid redirect URL:`, error);
        handleRedirect(`/p/${productSlug}`, returnUrl);
        return;
      }
    } else {
      // Check if we have a return_url (cross-domain scenario)
      if (returnUrl) {
        handleRedirect(`/p/${productSlug}`, returnUrl);
      } else {
        // Standard redirect to product page
        handleRedirect(`/p/${productSlug}`, returnUrl);
      }
    }
  } catch (error) {
    // Handle any unexpected errors (but not NEXT_REDIRECT)
    if (error instanceof Error && error.message.includes('NEXT_REDIRECT')) {
      throw error; // Re-throw NEXT_REDIRECT - this is expected behavior
    }
    // Instead of redirecting to access-denied, redirect to the product page
    // This gives a better user experience if something goes wrong
    handleRedirect(`/p/${productSlug}`, returnUrl);
  }
}
