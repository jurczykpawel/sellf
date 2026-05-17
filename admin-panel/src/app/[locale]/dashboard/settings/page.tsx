import { verifyAdminAccess } from '@/lib/auth-server';
import { getTranslations } from 'next-intl/server';
import SettingsTabs from '@/components/settings/SettingsTabs';
import { getMyShopConfig } from '@/lib/actions/shop-config';

export default async function SettingsPage() {
  await verifyAdminAccess();
  const t = await getTranslations('settings');

  const shopConfig = await getMyShopConfig();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[40px] font-[800] text-sf-heading tracking-[-0.03em] leading-[1.1]">
          {t('title')}
        </h1>
        <p className="text-sf-body mt-2">
          {t('subtitle')}
        </p>
      </div>

      <SettingsTabs
        siteUrl={process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || ''}
        initialCheckoutTheme={shopConfig?.checkout_theme ?? null}
      />
    </div>
  );
}
