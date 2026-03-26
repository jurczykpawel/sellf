import { redirect } from 'next/navigation';
import { createPublicClient } from '@/lib/supabase/server';
import { getShopConfig } from '@/lib/actions/shop-config';
import SmartLandingClient from '@/components/storefront/SmartLandingClient';
import { Product } from '@/types';

// Build-time constant: production builds get ISR (60s), dev server gets revalidate=0 (no cache).
// next dev ignores ISR anyway, but revalidate=0 ensures test DB writes are immediately visible.
export const revalidate = process.env.NODE_ENV === 'production' ? 60 : 0;

export default async function SmartLandingPage() {
  // Demo mode: always show the landing/about page as homepage
  if (process.env.DEMO_MODE === 'true') {
    redirect('/about');
  }

  // Use public client (no cookies) to enable ISR
  const supabase = createPublicClient();
  const shopConfig = await getShopConfig();

  // OPTIMIZED: Single query instead of 2 separate queries
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
