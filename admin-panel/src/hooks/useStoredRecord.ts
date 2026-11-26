/**
 * Loads the stored record by id before an edit form opens, so a form never starts from a
 * list-row copy (which can predate the last save or lack fields the form writes back).
 *
 * @see src/components/ProductsPageContent.tsx
 * @see src/components/WebhooksPageContent.tsx
 */

import { useCallback, useState } from 'react';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { api } from '@/lib/api/client';

interface StoredRecordLoader<T> {
  /** Id of the record being loaded, or null when idle. */
  loadingId: string | null;
  /** Resolves with the record, or null when a newer load or `cancel` replaced this one. Throws on API errors. */
  load: (id: string) => Promise<T | null>;
  cancel: () => void;
}

export function useStoredRecord<T>(resource: string): StoredRecordLoader<T> {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const begin = useLatestRequest();

  const load = useCallback(async (id: string): Promise<T | null> => {
    const isCurrent = begin();
    setLoadingId(id);
    try {
      const record = await api.get<T>(resource, id);
      return isCurrent() ? record : null;
    } catch (err) {
      if (!isCurrent()) return null;
      throw err;
    } finally {
      if (isCurrent()) setLoadingId(null);
    }
  }, [begin, resource]);

  // Starting a new request generation makes any pending load resolve to null.
  const cancel = useCallback(() => {
    begin();
    setLoadingId(null);
  }, [begin]);

  return { loadingId, load, cancel };
}
