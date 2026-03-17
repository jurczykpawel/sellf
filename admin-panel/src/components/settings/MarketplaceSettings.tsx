'use client';

import { ExternalLink, ShoppingBag } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';

/** Platform admin view: link to sellers management page. */
function PlatformAdminView() {
  const t = useTranslations('settings.marketplace');
  const locale = useLocale();

  return (
    <div className="bg-sf-surface border border-sf-border rounded-lg p-6">
      <div className="flex items-center gap-3 mb-2">
        <ShoppingBag className="w-5 h-5 text-sf-accent" />
        <h3 className="text-lg font-semibold text-sf-heading">{t('title')}</h3>
      </div>
      <p className="text-sm text-sf-muted mb-6">{t('description')}</p>

      <a
        href={`/${locale}/admin/sellers`}
        className="flex items-center justify-between p-4 bg-sf-deep border border-sf-border rounded-lg hover:border-sf-accent/50 transition-colors group"
      >
        <div>
          <div className="text-sm font-medium text-sf-heading group-hover:text-sf-accent transition-colors">
            {t('sellersLink')}
          </div>
          <div className="text-xs text-sf-muted mt-0.5">
            {t('sellersDescription')}
          </div>
        </div>
        <ExternalLink className="w-4 h-4 text-sf-muted group-hover:text-sf-accent transition-colors flex-shrink-0 ml-4" />
      </a>
    </div>
  );
}

export default function MarketplaceSettings() {
  // Marketplace tab is only shown to platform admins (filtered in SettingsTabs)
  return <PlatformAdminView />;
}
