'use client';

/**
 * Blocking "loading" layer shown while an edit form waits for its stored record. It holds the
 * keyboard focus (Tab stays on its Cancel button) so nothing behind it can be opened meanwhile.
 * Only Cancel and Escape end the load: a click on the backdrop does not, because the second click
 * of a double click on the control that started the load lands there.
 */

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';

interface RecordLoadingOverlayProps {
  onCancel: () => void;
}

export default function RecordLoadingOverlay({ onCancel }: RecordLoadingOverlayProps) {
  const t = useTranslations('common');
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { cancelRef.current?.focus(); }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
        if (event.key === 'Tab') { event.preventDefault(); cancelRef.current?.focus(); }
      }}
    >
      <div className="flex items-center gap-4 bg-sf-base px-6 py-4 border-2 border-sf-border-medium text-sf-body">
        <span className="h-5 w-5 animate-spin rounded-full border-b-2 border-sf-accent" aria-hidden="true" />
        <span role="status" aria-live="polite">{t('loading')}</span>
        <button ref={cancelRef} type="button" onClick={onCancel} className="text-sm text-sf-accent hover:text-sf-heading">
          {t('cancel')}
        </button>
      </div>
    </div>
  );
}
