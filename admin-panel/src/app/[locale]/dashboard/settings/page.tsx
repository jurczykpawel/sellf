import { verifyAdminOrSellerAccess } from '@/lib/auth-server';
import { getTranslations } from 'next-intl/server';
import { isMarketplaceEnabled } from '@/lib/marketplace/feature-flag';
import SettingsTabs from '@/components/settings/SettingsTabs';

export default async function SettingsPage() {
  await verifyAdminOrSellerAccess();
  const t = await getTranslations('settings');

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
        marketplaceEnabled={isMarketplaceEnabled()}
      />
    </div>
  );
}
