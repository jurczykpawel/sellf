/**
 * Loads the stored record by id before an edit form opens, so a form never starts from a
 * list-row copy (which can predate the last save or lack fields the form writes back).
 *
 * The loading layer takes the keyboard focus while it waits, so the control that started the
 * load is remembered: Cancel and a failed read hand focus straight back to it, and the form
 * that opens returns focus to it on close via `opener`.
 *
 * @see src/components/ui/RecordLoadingOverlay.tsx
 * @see src/components/ProductsPageContent.tsx
 * @see src/components/WebhooksPageContent.tsx
 */

import { useCallback, useRef, useState } from 'react';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { api } from '@/lib/api/client';

interface StoredRecordLoader<T> {
  /** Id of the record being loaded, or null when idle. */
  loadingId: string | null;
  /** Control focused when the last load started; pass it to the form as its return-focus target. */
  opener: HTMLElement | null;
  /** Resolves with the record, or null when a newer load or `cancel` replaced this one. Throws on API errors. */
  load: (id: string) => Promise<T | null>;
  cancel: () => void;
}

function focusedControl(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

export function useStoredRecord<T>(resource: string): StoredRecordLoader<T> {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  // The opener of a load still in flight: the one to refocus if it ends without opening a form.
  const pendingOpener = useRef<HTMLElement | null>(null);
  const begin = useLatestRequest();

  const restorePendingFocus = useCallback(() => {
    pendingOpener.current?.focus();
    pendingOpener.current = null;
  }, []);

  const load = useCallback(async (id: string): Promise<T | null> => {
    const isCurrent = begin();
    const control = focusedControl();
    pendingOpener.current = control;
    setOpener(control);
    setLoadingId(id);
    try {
      const record = await api.get<T>(resource, id);
      return isCurrent() ? record : null;
    } catch (err) {
      if (!isCurrent()) return null;
      restorePendingFocus();
      throw err;
    } finally {
      if (isCurrent()) {
        pendingOpener.current = null;
        setLoadingId(null);
      }
    }
  }, [begin, resource, restorePendingFocus]);

  // Starting a new request generation makes any pending load resolve to null.
  const cancel = useCallback(() => {
    begin();
    restorePendingFocus();
    setLoadingId(null);
  }, [begin, restorePendingFocus]);

  return { loadingId, opener, load, cancel };
}
