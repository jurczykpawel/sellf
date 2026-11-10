import { describe, expect, it } from 'vitest';
import { accessLicenseSchema, canManageAccessLicense } from '@/lib/license-keys/access';

describe('access license options', () => {
  it('defaults issuance and revocation to true', () => {
    expect(accessLicenseSchema.parse({})).toMatchObject({ issue_license: true, revoke_license: true });
  });
  it('keeps explicit opt-outs and rejects non-boolean choices', () => {
    expect(accessLicenseSchema.parse({ issue_license: false, revoke_license: false })).toMatchObject({ issue_license: false, revoke_license: false });
    expect(accessLicenseSchema.safeParse({ issue_license: 'false' }).success).toBe(false);
    expect(accessLicenseSchema.safeParse({ revoke_license: 'false' }).success).toBe(false);
  });
  it('requires licenses:write in addition to user access permissions', () => {
    expect(canManageAccessLicense(['users:write'])).toBe(false);
    expect(canManageAccessLicense(['users:write', 'licenses:write'])).toBe(true);
  });
});
