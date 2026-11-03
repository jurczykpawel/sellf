import { afterEach, describe, expect, it, vi } from 'vitest';
import { annotateViesStatus, checkViesVat } from '@/lib/validation/vies';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('VIES check is optional and never blocks the order', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('asks the EU service for the country and number and reports a valid number', async () => {
    const fetchImpl = vi.fn(async () => json({ isValid: true, userError: 'VALID' }));
    expect(await checkViesVat('DE123456789', { fetchImpl })).toBe('valid');
    expect(fetchImpl).toHaveBeenCalledWith('https://ec.europa.eu/taxation_customs/vies/rest-api/ms/DE/vat/123456789', expect.objectContaining({ redirect: 'error' }));
  });
  it('reports a number unknown to VIES as invalid', async () => {
    expect(await checkViesVat('FRAB123456789', { fetchImpl: async () => json({ isValid: false, userError: 'INVALID' }) })).toBe('invalid');
  });
  it.each([
    ['member state down', async () => json({ isValid: false, userError: 'MS_UNAVAILABLE' })],
    ['HTTP error', async () => json({}, 503)],
    ['network error', async () => { throw new TypeError('fetch failed'); }],
  ])('reports %s as unavailable', async (_name, fetchImpl) => {
    expect(await checkViesVat('DE123456789', { fetchImpl })).toBe('unavailable');
  });
  it('gives up after the time limit', async () => {
    const hanging = (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    const started = Date.now();
    expect(await checkViesVat('DE123456789', { fetchImpl: hanging, timeoutMs: 50 })).toBe('unavailable');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('annotates EU buyer and recipient only when the seller turned the check on', async () => {
    const fetchImpl = vi.fn(async () => json({ isValid: true, userError: 'VALID' }));
    const details = () => ({ buyer: { nip: 'DE123456789', tax_id_type: 'eu_vat' }, recipient: { differs: true, nip: '5252248481', tax_id_type: 'pl_nip' } });
    const off = details();
    await annotateViesStatus(off, { fetchImpl });
    expect(off.buyer).not.toHaveProperty('tax_id_vies');
    expect(fetchImpl).not.toHaveBeenCalled();

    vi.stubEnv('SELLF_VIES_CHECK_ENABLED', 'true');
    const on = details();
    await annotateViesStatus(on, { fetchImpl });
    expect(on.buyer).toMatchObject({ tax_id_vies: 'valid' });
    expect(on.recipient).not.toHaveProperty('tax_id_vies');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
