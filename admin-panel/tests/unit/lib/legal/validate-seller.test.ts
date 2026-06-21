import { describe, it, expect } from 'vitest';
import { validateSeller } from '@/lib/legal/validate-seller';
import type { LegalCompany } from '@/lib/legal/types';

const full: LegalCompany = {
  name: 'F', legalForm: 'fundacja', email: 'a@b.pl',
  street: 'X', buildingNo: '1', city: 'W', postal: '01-860',
};

describe('validateSeller', () => {
  it('passes when required fields present', () => {
    expect(validateSeller(full)).toEqual({ ok: true });
  });
  it('reports missing required fields', () => {
    const r = validateSeller({ ...full, name: '', postal: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(expect.arrayContaining(['name', 'postal']));
  });
  it('flags invalid postal format', () => {
    const r = validateSeller({ ...full, postal: '123' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain('postal');
  });
});
