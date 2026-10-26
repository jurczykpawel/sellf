'use client';

import { useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { resolveSafeRedirectPath } from '@/lib/validations/redirect';

export default function OtoDeclineButton() {
  const params = useParams<{ locale?: string }>();
  const searchParams = useSearchParams();
  const t = useTranslations('oto');

  const downsellCoupon = searchParams?.get('downsell_coupon') ?? null;
  const downsellSlug = searchParams?.get('downsell_slug') ?? null;
  const email = searchParams?.get('email') ?? null;
  const inOtoMode = searchParams?.get('oto') === '1';

  const locale = params?.locale ?? 'en';

  const purchaseReturn = resolveSafeRedirectPath(searchParams?.get('purchase_return') ?? '');
  const declineHref = useMemo(() => {
    if (downsellCoupon && downsellSlug) {
      const qs = new URLSearchParams();
      if (email) qs.set('email', email);
      qs.set('coupon', downsellCoupon);
      qs.set('oto', '1');
      if (purchaseReturn) qs.set('purchase_return', purchaseReturn);
      return `/${locale}/checkout/${downsellSlug}?${qs.toString()}`;
    }
    return purchaseReturn || `/${locale}/my-products`;
  }, [downsellCoupon, downsellSlug, email, locale, purchaseReturn]);

  if (!inOtoMode) return null;

  return (
    <a
      href={declineHref}
      data-testid="oto-decline-button"
      className="block mt-3 text-center text-sm text-sf-muted hover:text-sf-heading underline underline-offset-4 transition-colors"
    >
      {t('noThanks')}
    </a>
  );
}
