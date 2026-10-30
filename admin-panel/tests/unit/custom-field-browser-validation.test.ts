/** Canonical field validation works in browser runtimes without Node globals. */
import { expect, it, vi } from 'vitest';
import { validateCustomFieldValues } from '@/lib/validations/custom-checkout-fields';
it('validates a required checkout domain without a Buffer global', () => {
  let result: ReturnType<typeof validateCustomFieldValues> | undefined;
  let failure: unknown;
  try {
    vi.stubGlobal('Buffer', undefined);
    try { result = validateCustomFieldValues([{ id: '_sellf_license_domain', type: 'domain', label: { en: 'Domain', pl: 'Domena' }, required: true, max_length: 253 }], { _sellf_license_domain: 'https://www.buyer.example.com/path' }); }
    catch (error) { failure = error; }
  } finally { vi.unstubAllGlobals(); }
  expect(failure).toBeUndefined();
  expect(result).toEqual({ ok: true, values: { _sellf_license_domain: 'buyer.example.com' } });
});
