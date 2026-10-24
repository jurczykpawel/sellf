'use client';
/**
 * Shared recovery notice for admin API requests.
 * @see src/lib/api/client.ts
 */
import { useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
export default function SessionExpiryNotice() {
  const t = useTranslations('navigation');
  const locale = useLocale();
  useEffect(() => {
    const notify = () => toast.error(t('sessionExpired'), {
      id: 'session-expired', duration: Infinity,
      description: <a href={`/${locale}/login`}>{t('login')}</a>,
    });
    window.addEventListener('sellf:session-expired', notify);
    return () => window.removeEventListener('sellf:session-expired', notify);
  }, [t, locale]);
  return null;
}
