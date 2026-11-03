/**
 * Sales → Licenses: issued product licenses (list, manual issue, revoke).
 * Moved out of Settings, where it sat next to Sellf's own license (demo feedback 2026-10-29 #14).
 * `?email=&product=` prefill the manual-issue form (linked from order details).
 * @see src/components/admin/LicensesPageContent.tsx
 */
import { getTranslations } from 'next-intl/server';
import { verifyAdminAccess } from '@/lib/auth-server';
import { checkFeature } from '@/lib/license/resolve';
import LicensesPageContent from '@/components/admin/LicensesPageContent';

interface LicensesPageProps {
  searchParams: Promise<{ email?: string; product?: string; q?: string }>;
}

export default async function LicensesPage({ searchParams }: LicensesPageProps) {
  await verifyAdminAccess();
  const [t, hasLicenseIssuance, params] = await Promise.all([
    getTranslations('settings.issuedLicenses'),
    checkFeature('license-key-issuance'),
    searchParams,
  ]);
  const pick = (value?: string) => (typeof value === 'string' ? value.slice(0, 254) : '');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[40px] font-[800] text-sf-heading tracking-[-0.03em] leading-[1.1]">{t('title')}</h1>
        <p className="text-sf-body mt-2">{t('subtitle')}</p>
      </div>
      <LicensesPageContent
        enabled={hasLicenseIssuance}
        initialEmail={pick(params.email)}
        initialProductId={pick(params.product)}
        initialSearch={pick(params.q)}
      />
    </div>
  );
}
