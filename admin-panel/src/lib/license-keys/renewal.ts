export function isLicenseExpired(expiresAt: string | null | undefined, now = new Date()): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < now;
}

interface LicenseRenewalPolicyInput {
  renewLicense: boolean;
  productIssuesLicense: boolean;
  licenseExpiresAt: string | null | undefined;
  now?: Date;
}

export function canRenewExpiredLicenseWithActiveAccess(input: LicenseRenewalPolicyInput): boolean {
  return (
    input.renewLicense &&
    input.productIssuesLicense &&
    isLicenseExpired(input.licenseExpiresAt, input.now)
  );
}
