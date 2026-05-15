import { createPublicClient } from '@/lib/supabase/server';
import { getShopConfig } from '@/lib/actions/shop-config';
import SmartLandingClient from '@/components/storefront/SmartLandingClient';
import { Product } from '@/types';

// Enable ISR - product catalog rarely changes; refresh every 5 min.
export const revalidate = 300;

/**
 * /store — always shows the product catalog, even in demo mode.
 * The root page (/) redirects to /about in demo mode, so this route
 * provides a direct way to browse products.
 */
export default async function StorePage() {
  const supabase = createPublicClient();
  const shopConfig = await getShopConfig();

  const { data } = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .eq('is_listed', true)
    .order('is_featured', { ascending: false })
    .order('price', { ascending: true });

  const products = (data as Product[]) || [];
  const hasProducts = products.length > 0;

  return (
    <SmartLandingClient
      hasProducts={hasProducts}
      products={products}
      shopConfig={shopConfig}
    />
  );
}
