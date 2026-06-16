import { describe, expect, it } from 'vitest';
import { parseLicenseClaimsForDisplay } from '@/lib/license/license-claims-display';

// Real bootstrap token (business / unlimited / sellf.techskills.academy)
const TOKEN =
  'eyJ2IjoxLCJraWQiOiI3MGM1MzA4ZTYzODllYTg4IiwicHJvZHVjdCI6InNlbGxmLXBybyIsImVtYWlsIjoicGF2dmVsZGV2QGdtYWlsLmNvbSIsIm9yZGVyIjoiYm9vdHN0cmFwLXNlbGZob3N0LTE3ODE2MzgxNzAiLCJ0aWVyIjoiYnVzaW5lc3MiLCJpYXQiOjE3ODE2MzgxNzAsImV4cCI6bnVsbCwiZG9tYWluIjoic2VsbGYudGVjaHNraWxscy5hY2FkZW15In0.sig';

describe('parseLicenseClaimsForDisplay', () => {
  it('decodes the display claims from a payload.sig token', () => {
    const c = parseLicenseClaimsForDisplay(TOKEN);
    expect(c).toEqual({
      product: 'sellf-pro',
      email: 'pavveldev@gmail.com',
      tier: 'business',
      domain: 'sellf.techskills.academy',
      issuedAt: 1781638170,
      expiresAt: null,
    });
  });

  it('returns null for malformed input', () => {
    expect(parseLicenseClaimsForDisplay('')).toBeNull();
    expect(parseLicenseClaimsForDisplay('not-a-token')).toBeNull();
    expect(parseLicenseClaimsForDisplay('.sig')).toBeNull();
    expect(parseLicenseClaimsForDisplay('@@@.sig')).toBeNull();
  });
});
