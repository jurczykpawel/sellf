/**
 * Optional EU VAT check in VIES (European Commission REST API). Opt-in with
 * SELLF_VIES_CHECK_ENABLED=true. Never blocks an order: a timeout or an outage is
 * recorded as 'unavailable', and the number is stored either way. Server-only.
 *
 * @see ./tax-id.ts
 */

export type ViesStatus = 'valid' | 'invalid' | 'unavailable';

const VIES_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/ms';
export const VIES_TIMEOUT_MS = 3000;

interface ViesOptions {
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

export function isViesCheckEnabled(): boolean {
  return process.env.SELLF_VIES_CHECK_ENABLED === 'true';
}

/** `vat` is a normalized EU VAT number with its prefix, e.g. DE123456789 or EL123456789. */
export async function checkViesVat(vat: string, { fetchImpl = fetch, timeoutMs = VIES_TIMEOUT_MS }: ViesOptions = {}): Promise<ViesStatus> {
  const match = /^([A-Z]{2})([A-Z0-9+*]{2,13})$/.exec(vat);
  if (!match) return 'invalid';
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'unavailable'>(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve('unavailable'); }, timeoutMs);
  });
  const request = (async (): Promise<ViesStatus> => {
    const response = await fetchImpl(`${VIES_URL}/${match[1]}/vat/${encodeURIComponent(match[2])}`, {
      headers: { accept: 'application/json' }, redirect: 'error', signal: controller.signal,
    });
    if (!response.ok) return 'unavailable';
    const body = await response.json() as { isValid?: unknown; userError?: unknown };
    if (body.isValid === true) return 'valid';
    return body.userError === 'INVALID' ? 'invalid' : 'unavailable';
  })().catch((): ViesStatus => 'unavailable');
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Adds `tax_id_vies` to the buyer and a differing recipient when they carry an EU VAT number. */
export async function annotateViesStatus(details: Record<string, unknown>, options: ViesOptions = {}): Promise<void> {
  if (!isViesCheckEnabled()) return;
  const parties = [details.buyer, details.recipient].filter((party): party is Record<string, unknown> =>
    !!party && typeof party === 'object' && !Array.isArray(party)
    && (party as Record<string, unknown>).tax_id_type === 'eu_vat' && typeof (party as Record<string, unknown>).nip === 'string');
  await Promise.all(parties.map(async party => { party.tax_id_vies = await checkViesVat(party.nip as string, options); }));
}
