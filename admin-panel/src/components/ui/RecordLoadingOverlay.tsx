'use client';

/** Blocking "loading" layer shown while an edit form waits for its stored record. */

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

interface RecordLoadingOverlayProps {
  onCancel: () => void;
}

export default function RecordLoadingOverlay({ onCancel }: RecordLoadingOverlayProps) {
  const t = useTranslations('common');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div role="status" aria-live="polite" className="flex items-center gap-3 bg-sf-base px-6 py-4 border-2 border-sf-border-medium text-sf-body">
        <span className="h-5 w-5 animate-spin rounded-full border-b-2 border-sf-accent" aria-hidden="true" />
        {t('loading')}
      </div>
    </div>
  );
}
