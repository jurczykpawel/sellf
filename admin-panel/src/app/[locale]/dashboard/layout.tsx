import { verifyAdminAccess } from '@/lib/auth-server';
import DashboardLayout from '@/components/DashboardLayout';
import { ReactNode } from 'react';
import { RealtimeProvider } from '@/contexts/RealtimeContext';
import { UserPreferencesProvider } from '@/contexts/UserPreferencesContext';
import { getShopConfig } from '@/lib/actions/shop-config';

export default async function Layout({ children }: { children: ReactNode }) {
  const user = await verifyAdminAccess();

  const shopConfig = await getShopConfig();
  const shopDefaultCurrency = shopConfig?.default_currency || 'USD';

  // Extract initial preferences safely
  const initialHideValues = user.user_metadata?.preferences?.hideValues || false;
  const userSavedCurrency = user.user_metadata?.preferences?.displayCurrency;
  const initialDisplayCurrency = userSavedCurrency !== undefined ? userSavedCurrency : shopDefaultCurrency;
  const userSavedMode = user.user_metadata?.preferences?.currencyViewMode;
  const initialCurrencyViewMode = userSavedMode || 'converted';

  return (
    <UserPreferencesProvider
      initialHideValues={initialHideValues}
      initialDisplayCurrency={initialDisplayCurrency}
      initialCurrencyViewMode={initialCurrencyViewMode}
    >
      <RealtimeProvider>
        <DashboardLayout
          user={user}
          isAdmin={true}
          shopConfig={shopConfig}
          adminRole="platform_admin"
        >
          {children}
        </DashboardLayout>
      </RealtimeProvider>
    </UserPreferencesProvider>
  );
}
