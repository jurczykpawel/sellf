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
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-semibold text-white bg-sf-deep/95 backdrop-blur border-2 border-sf-accent shadow-xl hover:bg-sf-accent hover:text-white transition-colors"
    >
      <span aria-hidden="true">↩</span>
      {t('declineCta')}
    </a>
  );
}
