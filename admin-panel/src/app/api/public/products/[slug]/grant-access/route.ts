import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limiting';
import { WebhookService } from '@/lib/services/webhook-service';
import { trackServerSideConversion } from '@/lib/tracking';
import { grantFreeProductAccess } from '@/lib/services/free-product-access';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params;
    const supabase = await createClient();
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limiting
    const rateLimitOk = await checkRateLimit('grant_access', 5, 60, user.id);
    
    if (!rateLimitOk) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    // Get product
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name, slug, price, currency, icon, is_active, available_from, available_until, allow_custom_price, custom_price_min')
      .eq('slug', slug)
      .single();

    if (productError || !product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    // Check temporal availability
    const now = new Date();
    const availableFrom = product.available_from ? new Date(product.available_from) : null;
    const availableUntil = product.available_until ? new Date(product.available_until) : null;
    
    const isTemporallyAvailable = (!availableFrom || availableFrom <= now) && (!availableUntil || availableUntil > now);
    
    if (!product.is_active || !isTemporallyAvailable) {
      return NextResponse.json({ error: 'Product not available for purchase' }, { status: 400 });
    }

    // Check if this is a PWYW product with free option (custom_price_min = 0)
    // SECURITY: Only explicit 0 qualifies — null is NOT treated as free (fail-closed)
    const isPwywFree = product.allow_custom_price && product.custom_price_min === 0;

    // Only allow free products or PWYW-free products
    if (product.price > 0 && !isPwywFree) {
      return NextResponse.json({ error: 'Payment required' }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const accessResult = await grantFreeProductAccess(supabase, adminClient, {
      product: { id: product.id, slug, price: product.price, isPwywFree },
      user: { id: user.id, email: user.email ?? '' },
    });

    if (!accessResult.accessGranted) {
      const status = accessResult.error?.includes('not be free or active') ? 400 : 500;
      return NextResponse.json({ error: accessResult.error }, { status });
    }

    // Trigger webhook and tracking only for new grants (not repeat calls)
    if (!accessResult.alreadyHadAccess) {
      WebhookService.trigger('lead.captured', {
        customer: { email: user.email, userId: user.id },
        product: {
          id: product.id,
          name: product.name,
          slug: product.slug,
          price: product.price,
          currency: product.currency,
          icon: product.icon,
        },
      }).catch(err => console.error('Webhook trigger error:', err));

      trackServerSideConversion({
        eventName: 'Lead',
        eventSourceUrl: request.headers.get('referer') || '',
        value: 0,
        currency: 'USD',
        items: [{ item_id: product.id, item_name: product.name, price: 0, quantity: 1 }],
        userEmail: user.email || undefined,
      }).catch(err => console.error('[FB CAPI] Server-side Lead tracking error:', err));
    }

    return NextResponse.json({
      success: true,
      message: accessResult.alreadyHadAccess ? 'Access already granted' : 'Access granted successfully',
      alreadyHadAccess: accessResult.alreadyHadAccess,
      ...(accessResult.otoInfo ? { otoInfo: accessResult.otoInfo } : {}),
    });

  } catch (error) {
    console.error('Error in grant access:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
