/**
 * Shared client helper for the GUS (Polish REGON) company-data lookup.
 *
 * Wraps the POST to /api/gus/fetch-company-data and classifies the outcome into
 * a small result union. This is the ONLY concern shared across call sites — the
 * field-to-form mapping stays at each call site, because the profile, checkout
 * invoice, and legal-documents forms map the same GUS fields to different field
 * names.
 *
 * @see src/app/api/gus/fetch-company-data/route.ts — the endpoint + response shape
 * @see src/components/ProfileForm.tsx — profile-page call site
 * @see src/hooks/useInvoiceData.ts — checkout call site
 * @see src/components/settings/LegalDocumentsSettings.tsx — legal-documents call site
 */

/** Company fields returned by the GUS endpoint and consumed by the call sites. */
export interface GusCompanyData {
  nazwa: string;
  ulica: string;
  nrNieruchomosci: string;
  nrLokalu: string;
  miejscowosc: string;
  kodPocztowy: string;
  regon: string;
  nip: string;
}

/**
 * Outcome of a lookup. `not_configured` is distinct from `error` so callers can
 * fail silently when the admin has not set up GUS (the same UX the inline call
 * sites had before this helper existed).
 */
export type GusLookupResult =
  | { ok: true; data: GusCompanyData }
  | { ok: false; code: 'rate_limit' | 'not_found' | 'security' | 'not_configured' | 'error' };

/** Maps the endpoint's response (HTTP status + `code`) to a result code. */
function classifyError(status: number, code: unknown): GusLookupResult {
  if (status === 429 || code === 'RATE_LIMIT_EXCEEDED') return { ok: false, code: 'rate_limit' };
  if (status === 404 || code === 'NOT_FOUND') return { ok: false, code: 'not_found' };
  if (status === 403 || code === 'INVALID_ORIGIN') return { ok: false, code: 'security' };
  if (code === 'NOT_CONFIGURED') return { ok: false, code: 'not_configured' };
  return { ok: false, code: 'error' };
}

/**
 * Looks up company data by NIP via the GUS endpoint.
 *
 * @param nip       normalized 10-digit Polish NIP
 * @param signal    optional AbortSignal (e.g. from a component-unmount cleanup)
 */
export async function lookupCompanyByNip(
  nip: string,
  signal?: AbortSignal,
): Promise<GusLookupResult> {
  try {
    const response = await fetch('/api/gus/fetch-company-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nip }),
      signal,
    });

    const result = await response.json();

    if (result.success && result.data) {
      return { ok: true, data: result.data as GusCompanyData };
    }

    return classifyError(response.status, result.code);
  } catch {
    return { ok: false, code: 'error' };
  }
}
