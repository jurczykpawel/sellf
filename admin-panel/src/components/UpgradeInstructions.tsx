'use client';

/** Deployment instructions shared by both update surfaces. @see useUpdateCheck.ts */
import { useTranslations } from 'next-intl';
import type { UpdateInfo } from '@/hooks/useUpdateCheck';

export default function UpgradeInstructions({ updateInfo }: { updateInfo: UpdateInfo }) {
  const t = useTranslations('systemUpdate');
  return (
    <div data-testid="upgrade-instructions" className="mt-3 text-sm text-sf-body space-y-2">
      <p>{t(`deployment.${updateInfo.upgrade?.runtime ?? 'manual'}`, { version: updateInfo.latest_version })}</p>
      <p>{t('deployment.migrations')}</p>
      <a className="text-sf-accent underline" href="https://docs.sellf.app/deployment/" target="_blank" rel="noopener noreferrer">
        {t('deployment.docs')}
      </a>
    </div>
  );
}
