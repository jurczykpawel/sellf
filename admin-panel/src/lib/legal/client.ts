/**
 * Legal Engine HTTP client
 *
 * Calls the external legal-engine service to render legal documents
 * (terms of service, privacy policy) as HTML fragments.
 *
 * @see /lib/legal/types.ts — LegalCompany, LegalFlags
 * @see /app/api/legal/generate/route.ts — caller
 */

import type { LegalCompany, LegalFlags } from './types';

export async function renderDocument(
  baseUrl: string,
  body: { type: 'terms' | 'privacy'; lang: 'pl'; format: 'html'; company: LegalCompany; flags: LegalFlags },
): Promise<{ ok: true; html: string } | { ok: false; status: number; errors?: unknown }> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error', // SSRF protection — no redirects
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, status: 0 }; // timeout / network error
  }

  if (!res.ok) {
    let errors: unknown;
    try {
      errors = (await res.json()).errors;
    } catch {
      // noop — response body may not be JSON
    }
    return { ok: false, status: res.status, errors };
  }

  return { ok: true, html: await res.text() };
}
