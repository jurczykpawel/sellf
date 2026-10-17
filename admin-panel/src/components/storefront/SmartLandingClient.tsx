'use client';

import { useAuth } from '@/contexts/AuthContext';
import DashboardLayout from '@/components/DashboardLayout';
import type { ReactNode } from 'react';
import type { Product } from '@/types';
import type { ShopConfig } from '@/lib/actions/shop-config';
import AdminOnboardingCTA from './AdminOnboardingCTA';
import ComingSoonEmptyState from './ComingSoonEmptyState';
import Storefront from './Storefront';

interface SmartLandingClientProps {
  hasProducts: boolean;
  products?: Product[];
  children?: ReactNode;
  templateId?: 'default' | 'd' | 'storefront-a' | 'storefront-b';
  shopConfig: ShopConfig | null;
  /** Override product link prefix. Default: '/p'. For seller storefronts: '/s/seller-slug' */
  productLinkPrefix?: string;
}

export default function SmartLandingClient({
  hasProducts,
  products = [],
  children,
  templateId,
  shopConfig,
  productLinkPrefix,
}: SmartLandingClientProps) {
  const { user, isAdmin } = useAuth();

  const shopName = shopConfig?.shop_name || 'Sellf';
  const contactEmail = shopConfig?.contact_email || null;

  // SCENARIO 1: No products + Admin user → Show onboarding
  if (!hasProducts && isAdmin) {
    return (
      <DashboardLayout user={user ? { email: user.email || '', id: user.id || '' } : null} shopConfig={shopConfig}>
        <AdminOnboardingCTA shopName={shopName} shopEmail={contactEmail} />
      </DashboardLayout>
    );
  }

  // SCENARIO 2: No products + Guest/Regular user → Show coming soon
  if (!hasProducts && !isAdmin) {
    return (
      <DashboardLayout 
        user={user ? { email: user.email || '', id: user.id || '' } : null} 
        shopConfig={shopConfig}
        showSellfCTA={true}
      >
        <ComingSoonEmptyState shopName={shopName} contactEmail={contactEmail} />
      </DashboardLayout>
    );
  }

  // SCENARIO 3: Products exist → Show storefront
  const featuredProducts = products.filter((p) => p.is_featured);
  // Subscriptions store the price in recurring_price; products.price=0 for them.
  // Without this guard a subscription would land in the "free" bucket.
  const freeProducts = products.filter(
    (p) => p.product_type !== 'subscription' && p.price === 0,
  );
  const paidProducts = products.filter(
    (p) => p.product_type === 'subscription' || p.price > 0,
  );

  return (
    <DashboardLayout storefrontTemplate={templateId} user={user ? { email: user.email || '', id: user.id || '' } : null} shopConfig={shopConfig}>
      {children ?? <Storefront
        products={products}
        shopName={shopName}
        featuredProducts={featuredProducts}
        freeProducts={freeProducts}
        paidProducts={paidProducts}
        productLinkPrefix={productLinkPrefix}
      />}
    </DashboardLayout>
  );
}
