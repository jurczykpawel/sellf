'use client';
/**
 * Shared recovery notice for admin API requests.
 * @see src/lib/api/client.ts
 */
import { useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { getLoginReturnPath } from '@/lib/auth/magic-link-redirect';
export default function SessionExpiryNotice() {
  const t = useTranslations('navigation');
  const locale = useLocale();
  const auth = useTranslations('auth');
  useEffect(() => {
    if (new URLSearchParams(window.location.hash.slice(1)).get('error_code') === 'otp_expired') {
      const target = new URL(`/${locale}/login?error=magic_link_expired`, window.location.origin);
      const returnPath = getLoginReturnPath(new URLSearchParams(window.location.search).get('redirect_to'));
      if (returnPath) target.searchParams.set('redirect_to', returnPath);
      toast.error(auth('magicLinkExpired'), { id: 'auth-link-expired', duration: Infinity, description: <a href={`${target.pathname}${target.search}`}>{t('login')}</a> });
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    }
    const notify = () => toast.error(t('sessionExpired'), {
      id: 'session-expired', duration: Infinity,
      description: <a href={`/${locale}/login`}>{t('login')}</a>,
    });
    window.addEventListener('sellf:session-expired', notify);
    return () => window.removeEventListener('sellf:session-expired', notify);
  }, [t, auth, locale]);
  return null;
}
