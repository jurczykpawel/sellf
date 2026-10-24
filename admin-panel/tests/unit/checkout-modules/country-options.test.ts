import { expect, it, vi } from 'vitest';
import { getCountryOptions } from '@/lib/checkout/countries';
it('includes all 249 ISO countries with localized names and preserves saved codes', () => {
  const en = getCountryOptions('en');
  const pl = getCountryOptions('pl', 'ZZ');
  expect(en).toHaveLength(249);
  expect(en.find(c => c.code === 'US')?.name).toBe('United States');
  expect(pl.find(c => c.code === 'US')?.name).toBe('Stany Zjednoczone');
  expect(pl.find(c => c.code === 'ZZ')).toBeTruthy();
  for (const code of ['GB', 'CH', 'NO', 'US', 'PL']) expect(en.some(c => c.code === code)).toBe(true);
});
it('keeps country labels and order identical across server and browser locale data', () => {
  const server = getCountryOptions('en');
  const original = Intl.DisplayNames.prototype.of;
  const displayName = vi.spyOn(Intl.DisplayNames.prototype, 'of').mockImplementation(function (this: Intl.DisplayNames, code) {
    return code === 'FK' ? 'Falkland Islands (Islas Malvinas)' : original.call(this, code);
  });
  try { expect(getCountryOptions('en')).toEqual(server); }
  finally { displayName.mockRestore(); }
});
