'use client';

import { useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

export default function OtoDeclineButton() {
  const params = useParams<{ locale?: string }>();
  const searchParams = useSearchParams();
  const t = useTranslations('oto');

  const downsellCoupon = searchParams?.get('downsell_coupon') ?? null;
  const downsellSlug = searchParams?.get('downsell_slug') ?? null;
  const email = searchParams?.get('email') ?? null;
  const inOtoMode = searchParams?.get('oto') === '1';

  const declineHref = useMemo(() => {
    if (!downsellCoupon || !downsellSlug) return null;
    const locale = params?.locale ?? 'en';
    const qs = new URLSearchParams();
    if (email) qs.set('email', email);
    qs.set('coupon', downsellCoupon);
    qs.set('oto', '1');
    return `/${locale}/checkout/${downsellSlug}?${qs.toString()}`;
  }, [downsellCoupon, downsellSlug, email, params?.locale]);

  if (!inOtoMode || !declineHref) return null;

  return (
    <a
      href={declineHref}
      data-testid="oto-decline-button"
      className="mt-4 inline-flex items-center justify-center w-full px-4 py-3 rounded-xl text-sm font-medium text-sf-muted bg-sf-raised border border-sf-border hover:bg-sf-deep hover:text-sf-text transition-colors"
    >
      {t('declineCta')}
    </a>
  );
}
