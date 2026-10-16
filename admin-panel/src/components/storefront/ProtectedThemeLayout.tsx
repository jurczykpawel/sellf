/** Core route subset of published public appearance. @see lib/theme-loader.ts */
import { loadProtectedThemeData } from '@/lib/theme-loader';
import { getShopConfig } from '@/lib/actions/shop-config';
import PublicThemeShell from '@/components/storefront/PublicThemeShell';
import type { ReactNode } from 'react';

export default async function ProtectedThemeLayout({ children }: { children: ReactNode }) {
  const [theme, shop] = await Promise.all([loadProtectedThemeData(), getShopConfig()]);
  return <PublicThemeShell surface="protected" tokens={theme.tokens} mode={shop?.checkout_theme}>{children}</PublicThemeShell>;
}
