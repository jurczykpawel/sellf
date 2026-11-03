// @vitest-environment happy-dom
/**
 * Legacy invoice form: the NIP/VAT blur check follows the company country (same rule as the
 * profile checkout) and GUS is asked only for Poland.
 * @see src/hooks/useInvoiceData.ts
 */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useInvoiceData } from '@/hooks/useInvoiceData';

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn(async () => ({ ok: false, code: 'not_found' })) }));
vi.mock('@/lib/gus/lookup', () => ({ lookupCompanyByNip: lookup }));
vi.mock('next-intl', () => { const translate = (key: string) => key; return { useTranslations: () => translate }; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function blur(country: string, nip: string) {
  const { result } = renderHook(() => useInvoiceData(undefined));
  act(() => { result.current.setCountry(country); result.current.setNip(nip); });
  await act(async () => { await result.current.handleNIPBlur(); });
  return result.current;
}

it.each([
  ['DE', 'DE12345', 'profile.errors.invalid_eu_vat'],
  ['US', '<x>', 'profile.errors.invalid_tax_id'],
  ['PL', '1234567890', 'nipValidation.invalidChecksum'],
])('%s %s shows %s', async (country, nip, message) => {
  expect((await blur(country, nip)).nipError).toBe(message);
  expect(lookup).not.toHaveBeenCalled();
});

it.each([['DE', '123456789'], ['US', 'EIN 12-3456789']])('accepts %s %s without asking GUS', async (country, nip) => {
  expect((await blur(country, nip)).nipError).toBeNull();
  expect(lookup).not.toHaveBeenCalled();
});

it('asks GUS for a valid Polish NIP', async () => {
  await blur('PL', '1181697228');
  expect(lookup).toHaveBeenCalledWith('1181697228');
});
