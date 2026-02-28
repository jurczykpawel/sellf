import { verifyAdminAccess } from '@/lib/auth-server';
import ShopSettings from '@/components/settings/ShopSettings';
import BrandingSettings from '@/components/settings/BrandingSettings';
import CheckoutThemeSettings from '@/components/settings/CheckoutThemeSettings';
import StripeSettings from '@/components/settings/StripeSettings';
import StripeTaxSettings from '@/components/settings/StripeTaxSettings';
import PaymentMethodSettingsWrapper from '@/components/settings/PaymentMethodSettingsWrapper';
import OmnibusSettings from '@/components/settings/OmnibusSettings';
import LegalDocumentsSettings from '@/components/settings/LegalDocumentsSettings';
import LicenseSettings from '@/components/settings/LicenseSettings';
import SystemUpdateSettings from '@/components/settings/SystemUpdateSettings';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

export default async function SettingsPage() {
  await verifyAdminAccess();
  const t = await getTranslations('settings');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          {t('title')}
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          {t('subtitle')}
        </p>
      </div>

      <ShopSettings />

      <BrandingSettings />

      <CheckoutThemeSettings />

      <LegalDocumentsSettings />

      <OmnibusSettings />

      <StripeSettings />

      <StripeTaxSettings />

      <PaymentMethodSettingsWrapper />

      <LicenseSettings />

      <SystemUpdateSettings />
    </div>
  );
}
