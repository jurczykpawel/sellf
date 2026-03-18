import { verifyAdminOrSellerAccess } from '@/lib/auth-server';
import DashboardLayout from '@/components/DashboardLayout';
import { ReactNode } from 'react';
import { RealtimeProvider } from '@/contexts/RealtimeContext';
import { UserPreferencesProvider } from '@/contexts/UserPreferencesContext';
import { AdminSchemaProvider } from '@/contexts/AdminSchemaContext';
import { getShopConfig } from '@/lib/actions/shop-config';

export default async function Layout({ children }: { children: ReactNode }) {
  // Auth check: platform admin OR seller admin
  const access = await verifyAdminOrSellerAccess();

  const shopConfig = await getShopConfig();
  const shopDefaultCurrency = shopConfig?.default_currency || 'USD';

  // Extract initial preferences safely
  const initialHideValues = access.user.user_metadata?.preferences?.hideValues || false;
  const userSavedCurrency = access.user.user_metadata?.preferences?.displayCurrency;
  const initialDisplayCurrency = userSavedCurrency !== undefined ? userSavedCurrency : shopDefaultCurrency;
  const userSavedMode = access.user.user_metadata?.preferences?.currencyViewMode;
  const initialCurrencyViewMode = userSavedMode || 'converted';

  return (
    <UserPreferencesProvider
      initialHideValues={initialHideValues}
      initialDisplayCurrency={initialDisplayCurrency}
      initialCurrencyViewMode={initialCurrencyViewMode}
    >
      <AdminSchemaProvider
        role={access.role}
        sellerSchema={access.sellerSchema}
        sellerSlug={access.sellerSlug}
        sellerDisplayName={access.sellerDisplayName}
      >
        <RealtimeProvider>
          <DashboardLayout
            user={access.user}
            isAdmin={access.role === 'platform_admin' || access.role === 'seller_admin'}
            shopConfig={shopConfig}
            adminRole={access.role}
            sellerDisplayName={access.sellerDisplayName}
          >
            {children}
          </DashboardLayout>
        </RealtimeProvider>
      </AdminSchemaProvider>
    </UserPreferencesProvider>
  );
}