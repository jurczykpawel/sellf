/** Login branding comes from the public shop settings. @see components/LoginPage.tsx */
import LoginPage from '@/components/LoginPage';
import { getShopConfig } from '@/lib/actions/shop-config';

export default async function Page() {
  const config = await getShopConfig();
  return <LoginPage shopName={config?.shop_name || 'Sellf'} />;
}
