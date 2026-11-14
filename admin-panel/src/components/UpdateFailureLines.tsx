'use client';

/** Localized reason for a failed update check or update attempt. @see src/lib/system/update-failure.ts */
import { useLocale, useTranslations } from 'next-intl';
import { describeUpdateFailure } from '@/lib/system/update-failure';
import type { UpdateFailure } from '@/lib/system/update-failure';

interface UpdateFailureLinesProps {
  failure?: UpdateFailure;
  fallback?: string;
  attempt: boolean;
  rollback?: boolean;
  currentVersion?: string;
  className?: string;
}

export default function UpdateFailureLines({ failure, fallback, attempt, rollback, currentVersion, className }: UpdateFailureLinesProps) {
  const t = useTranslations('systemUpdate');
  const locale = useLocale();
  const lines = describeUpdateFailure(failure, {
    t: (key, values) => t(key, values),
    formatTime: iso => new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }),
    attempt, rollback, currentVersion, fallback,
  });
  return (
    <>
      {lines.map(line => <p key={line} className={className}>{line}</p>)}
    </>
  );
}
