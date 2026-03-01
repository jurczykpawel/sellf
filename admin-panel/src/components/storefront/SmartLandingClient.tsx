'use client';

import { useAuth } from '@/contexts/AuthContext';
import { Product } from '@/types';
import AdminOnboardingCTA from './AdminOnboardingCTA';
import ComingSoonEmptyState from './ComingSoonEmptyState';
import Storefront from './Storefront';
import DashboardLayout from '@/components/DashboardLayout';
import type { ShopConfig } from '@/lib/actions/shop-config';

interface SmartLandingClientProps {
  hasProducts: boolean;
  products: Product[];
  shopConfig: ShopConfig | null;
}

export default function SmartLandingClient({
  hasProducts,
  products,
  shopConfig,
}: SmartLandingClientProps) {
  const { user, isAdmin, loading } = useAuth();

  // Show loading spinner while auth is loading
  if (loading) {
    return (
      <div className="min-h-screen bg-sf-deep flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sf-accent"></div>
      </div>
    );
  }

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
  const freeProducts = products.filter((p) => p.price === 0);
  const paidProducts = products.filter((p) => p.price > 0);

  return (
    <DashboardLayout user={user ? { email: user.email || '', id: user.id || '' } : null} shopConfig={shopConfig}>
      <Storefront
        products={products}
        shopName={shopName}
        featuredProducts={featuredProducts}
        freeProducts={freeProducts}
        paidProducts={paidProducts}
      />
    </DashboardLayout>
  );
}
