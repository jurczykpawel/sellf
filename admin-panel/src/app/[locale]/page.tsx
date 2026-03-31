import { redirect } from 'next/navigation';
import { createPublicClient } from '@/lib/supabase/server';
import { getShopConfig } from '@/lib/actions/shop-config';
import SmartLandingClient from '@/components/storefront/SmartLandingClient';
import { Product } from '@/types';

// ISR: revalidate every 60s. Dev server ignores this (always fresh).
export const revalidate = 60;

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
