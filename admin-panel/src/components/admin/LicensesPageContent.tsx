'use client';

/**
 * Client gate for the Sales → Licenses page: same visibility rule the Settings tab used
 * (platform admin, not demo mode).
 * @see src/app/[locale]/dashboard/licenses/page.tsx
 */
import { useTranslations } from 'next-intl';
import IssuedLicensesSettings from '@/components/settings/IssuedLicensesSettings';
import { useConfig } from '@/components/providers/config-provider';
import { useAuth } from '@/contexts/AuthContext';

interface LicensesPageContentProps {
  enabled: boolean;
  initialEmail?: string;
  initialProductId?: string;
  initialSearch?: string;
}

export default function LicensesPageContent({ enabled, initialEmail, initialProductId, initialSearch }: LicensesPageContentProps) {
  const t = useTranslations('settings.issuedLicenses');
  const { demoMode } = useConfig();
  const { role } = useAuth();

  if (role !== 'platform_admin' || demoMode) {
    return <p className="text-sf-muted">{t('unavailable')}</p>;
  }
  return (
    <IssuedLicensesSettings
      enabled={enabled}
      initialEmail={initialEmail}
      initialProductId={initialProductId}
      initialSearch={initialSearch}
    />
  );
}
