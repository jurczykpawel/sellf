'use client';

/**
 * Buyer's license key with its state. A revoked key is never shown or copyable;
 * the buyer sees why it stopped working.
 * @see src/lib/license-keys/lookup.ts
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { IssuedLicenseResponse } from '@/lib/license-keys/lookup';

const STATUS_STYLE: Record<IssuedLicenseResponse['status'], string> = {
  active: 'bg-sf-success-soft text-sf-success',
  expired: 'bg-sf-warning-soft text-sf-warning',
  revoked: 'bg-sf-danger-soft text-sf-danger',
};
const STATUS_LABEL = { active: 'licenseStatusActive', expired: 'licenseStatusExpired', revoked: 'licenseStatusRevoked' } as const;

export default function BuyerLicenseKey({ license }: { license: IssuedLicenseResponse }) {
  const t = useTranslations('productView');
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const formatDate = (value: string) => new Date(value).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const revoked = license.status === 'revoked';

  return (
    <div className={`p-4 rounded-xl border text-left ${revoked ? 'border-sf-danger/30 bg-sf-danger-soft' : 'border-sf-accent/30 bg-sf-accent-soft'}`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-sf-accent">{t('licenseKey')}</span>
        <span className="flex items-center gap-2">
          {license.expiresAt && !revoked && <span className="text-xs text-sf-muted">{t('licenseExpires', { date: formatDate(license.expiresAt) })}</span>}
          <span data-license-status={license.status} className={`text-xs font-semibold px-2 py-0.5 rounded ${STATUS_STYLE[license.status]}`}>{t(STATUS_LABEL[license.status])}</span>
        </span>
      </div>
      {revoked || !license.token ? (
        <p className="text-sm text-sf-danger">{t(license.revokedReason === 'dispute' ? 'licenseRevokedDispute' : 'licenseRevokedOther')}</p>
      ) : (
        <div className="flex items-center gap-2">
          <code className={`flex-1 text-xs font-mono break-all bg-sf-base rounded-lg px-3 py-2 select-all ${license.status === 'expired' ? 'text-sf-muted line-through' : 'text-sf-body'}`}>{license.token}</code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(license.token!);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="shrink-0 px-3 py-2 rounded-lg text-xs font-medium bg-sf-accent-bg hover:bg-sf-accent-hover text-white transition-colors active:scale-[0.98]"
          >
            {copied ? t('licenseCopied') : t('licenseCopy')}
          </button>
        </div>
      )}
    </div>
  );
}
