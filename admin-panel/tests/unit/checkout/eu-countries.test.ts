import { describe, it, expect } from 'vitest';
import { EU_COUNTRIES, EU_COUNTRY_CODES } from '@/lib/checkout/eu-countries';

describe('EU countries (single source for selector + eu_vat gate)', () => {
  it('contains all 27 EU member states', () => {
    expect(EU_COUNTRIES).toHaveLength(27);
    expect(EU_COUNTRY_CODES.size).toBe(27);
  });
  it('codes set is derived from the list and includes PL + GR', () => {
    expect(EU_COUNTRY_CODES.has('PL')).toBe(true);
    expect(EU_COUNTRY_CODES.has('GR')).toBe(true); // ISO code GR (VAT prefix EL handled separately)
    expect(EU_COUNTRY_CODES.has('DE')).toBe(true);
  });
  it('excludes non-EU (e.g. US, GB, CH)', () => {
    expect(EU_COUNTRY_CODES.has('US')).toBe(false);
    expect(EU_COUNTRY_CODES.has('GB')).toBe(false);
    expect(EU_COUNTRY_CODES.has('CH')).toBe(false);
  });
  it('every entry has a code and a display name; codes are unique', () => {
    for (const c of EU_COUNTRIES) {
      expect(c.code).toMatch(/^[A-Z]{2}$/);
      expect(c.name.length).toBeGreaterThan(0);
    }
    expect(new Set(EU_COUNTRIES.map((c) => c.code)).size).toBe(EU_COUNTRIES.length);
  });
});
