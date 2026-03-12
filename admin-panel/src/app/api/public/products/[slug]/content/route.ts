import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getShopConfig } from '@/lib/actions/shop-config';

export async function GET(
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

    // Two-step query to avoid FK embedding through proxy views (PGRST200).
    // Step 1: Fetch product by slug
    const { data: productWithAccess, error: productError } = await supabase
      .from('products')
      .select(`
        id,
        name,
        slug,
        description,
        icon,
        price,
        currency,
        is_active,
        is_featured,
        available_from,
        available_until,
        content_config,
        content_delivery_type
      `)
      .eq('slug', slug)
      .single();

    if (productError || !productWithAccess) {
      console.error('Error fetching product:', productError);
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Step 2: Check user access separately
    const { data: userAccessData, error: accessError } = await supabase
      .from('user_product_access')
      .select('access_expires_at, access_duration_days, created_at')
      .eq('product_id', productWithAccess.id)
      .eq('user_id', user.id)
      .single();

    if (accessError || !userAccessData) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Additional security check: verify access hasn't expired
    const userAccess = userAccessData;
    const now = new Date();
    const expiresAt = userAccess.access_expires_at ? new Date(userAccess.access_expires_at) : null;
    const isExpired = expiresAt && expiresAt < now;

    if (isExpired) {
      return NextResponse.json({ error: 'Access expired' }, { status: 403 });
    }

    // For products marked as inactive, deny access completely
    // Note: We don't check temporal availability here because users who already 
    // have access should be able to access content even if the product is no longer 
    // available for new purchases
    if (!productWithAccess.is_active) {
      return NextResponse.json({ error: 'Product not available' }, { status: 403 });
    }

    // Fetch shop name for the footer
    const shopConfig = await getShopConfig();
    const shopName = shopConfig?.shop_name ?? null;

    // Return secure product data with computed access status
    return NextResponse.json({
      product: {
        id: productWithAccess.id,
        name: productWithAccess.name,
        slug: productWithAccess.slug,
        description: productWithAccess.description,
        icon: productWithAccess.icon,
        price: productWithAccess.price,
        currency: productWithAccess.currency,
        is_active: productWithAccess.is_active,
        is_featured: productWithAccess.is_featured,
        available_from: productWithAccess.available_from,
        available_until: productWithAccess.available_until,
        content_config: productWithAccess.content_config,
        content_delivery_type: productWithAccess.content_delivery_type
      },
      branding: {
        shop_name: shopName,
      },
      userAccess: {
        access_expires_at: userAccess.access_expires_at,
        access_duration_days: userAccess.access_duration_days,
        access_granted_at: userAccess.created_at,
        // Backend-computed status
        is_expired: isExpired,
        is_expiring_soon: expiresAt ? Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) <= 7 : false,
        days_until_expiration: expiresAt ? Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null
      }
    });

  } catch (error) {
    console.error('Error fetching product content:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
