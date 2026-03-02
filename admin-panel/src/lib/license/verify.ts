/**
 * Sellf License Verification
 *
 * Verifies ECDSA-signed license keys for Sellf installations.
 * License format: SF-{domain}-{expiry}-{signature}
 */

import * as crypto from 'crypto';

// Sellf Public Key (ECDSA P-256)
// This key is used to verify license signatures
const SELLF_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE8K2XLvuxHQsCMSvBLemkdpMZqXpy
LeS3pFS7JyEEyi9Kew8TADDYBKh7mVLJSxqfXfy4H0qsCwy2S+zMdoCiIg==
-----END PUBLIC KEY-----`;

export interface LicenseInfo {
  valid: boolean;
  domain: string | null;
  expiry: string | null;
  expiryDate: Date | null;
  isExpired: boolean;
  error?: string;
}

export interface LicenseValidationResult {
  valid: boolean;
  info: LicenseInfo;
  domainMatch: boolean;
  error?: string;
}

/**
 * Parse a license key into its components
 */
export function parseLicense(licenseKey: string): {
  prefix: string;
  domain: string;
  expiry: string;
  signature: string;
} | null {
  if (!licenseKey || typeof licenseKey !== 'string') {
    return null;
  }

  const parts = licenseKey.split('-');
  if (parts.length < 4 || parts[0] !== 'SF') {
    return null;
  }

  return {
    prefix: parts[0],
    domain: parts[1],
    expiry: parts[2],
    signature: parts.slice(3).join('-'),
  };
}

/**
 * Verify the cryptographic signature of a license key
 */
export function verifyLicenseSignature(licenseKey: string): boolean {
  const parsed = parseLicense(licenseKey);
  if (!parsed) {
    return false;
  }

  const { domain, expiry, signature } = parsed;

  // Data that was signed
  const dataToVerify = `${domain}-${expiry}`;

  // Convert base64url signature back to base64
  let signatureBase64 = signature.replace(/-/g, '+').replace(/_/g, '/');
  while (signatureBase64.length % 4) {
    signatureBase64 += '=';
  }

  try {
    const signatureBuffer = Buffer.from(signatureBase64, 'base64');
    const verify = crypto.createVerify('SHA256');
    verify.update(dataToVerify);
    verify.end();
    return verify.verify(SELLF_PUBLIC_KEY, signatureBuffer);
  } catch {
    return false;
  }
}

/**
 * Parse expiry date from YYYYMMDD format
 */
export function parseExpiryDate(expiry: string): Date | null {
  if (expiry === 'UNLIMITED') {
    return null;
  }

  if (!/^\d{8}$/.test(expiry)) {
    return null;
  }

  const year = parseInt(expiry.substring(0, 4), 10);
  const month = parseInt(expiry.substring(4, 6), 10) - 1;
  const day = parseInt(expiry.substring(6, 8), 10);

  return new Date(year, month, day, 23, 59, 59);
}

/**
 * Check if a license is expired
 */
export function isLicenseExpired(expiry: string): boolean {
  if (expiry === 'UNLIMITED') {
    return false;
  }

  const expiryDate = parseExpiryDate(expiry);
  if (!expiryDate) {
    return true; // Invalid date format = expired
  }

  return expiryDate < new Date();
}

/**
 * Check if a license domain matches the current domain
 * Supports wildcard domains (*.example.com)
 */
export function doesDomainMatch(licenseDomain: string, currentDomain: string): boolean {
  if (!licenseDomain || !currentDomain) {
    return false;
  }

  // Normalize domains (lowercase, remove www.)
  const normalizedLicense = licenseDomain.toLowerCase().replace(/^www\./, '');
  const normalizedCurrent = currentDomain.toLowerCase().replace(/^www\./, '');

  // Exact match
  if (normalizedLicense === normalizedCurrent) {
    return true;
  }

  // Wildcard match (*.example.com matches sub.example.com)
  if (normalizedLicense.startsWith('*.')) {
    const baseDomain = normalizedLicense.substring(2);
    // Match both the base domain and any subdomain
    if (normalizedCurrent === baseDomain) {
      return true;
    }
    if (normalizedCurrent.endsWith('.' + baseDomain)) {
      return true;
    }
  }

  return false;
}

/**
 * Extract domain from a URL
 */
export function extractDomainFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    // If it's already just a domain, return it
    if (/^[a-zA-Z0-9.-]+$/.test(url)) {
      return url;
    }
    return null;
  }
}

/**
 * Get complete license information
 */
export function getLicenseInfo(licenseKey: string): LicenseInfo {
  const parsed = parseLicense(licenseKey);

  if (!parsed) {
    return {
      valid: false,
      domain: null,
      expiry: null,
      expiryDate: null,
      isExpired: true,
      error: 'Invalid license format',
    };
  }

  const signatureValid = verifyLicenseSignature(licenseKey);
  if (!signatureValid) {
    return {
      valid: false,
      domain: parsed.domain,
      expiry: parsed.expiry,
      expiryDate: parseExpiryDate(parsed.expiry),
      isExpired: isLicenseExpired(parsed.expiry),
      error: 'Invalid license signature',
    };
  }

  const expired = isLicenseExpired(parsed.expiry);

  return {
    valid: !expired,
    domain: parsed.domain,
    expiry: parsed.expiry,
    expiryDate: parseExpiryDate(parsed.expiry),
    isExpired: expired,
    error: expired ? 'License has expired' : undefined,
  };
}

/**
 * Validate a license key against a specific domain
 * This is the main validation function to use
 */
export function validateLicense(licenseKey: string, currentDomain?: string): LicenseValidationResult {
  if (!licenseKey) {
    return {
      valid: false,
      info: {
        valid: false,
        domain: null,
        expiry: null,
        expiryDate: null,
        isExpired: true,
        error: 'No license key provided',
      },
      domainMatch: false,
      error: 'No license key provided',
    };
  }

  const info = getLicenseInfo(licenseKey);

  if (!info.valid) {
    return {
      valid: false,
      info,
      domainMatch: false,
      error: info.error,
    };
  }

  // If no domain provided, skip domain check
  if (!currentDomain) {
    return {
      valid: true,
      info,
      domainMatch: true, // Assume match if no domain to check
    };
  }

  const domainMatch = doesDomainMatch(info.domain!, currentDomain);

  return {
    valid: domainMatch,
    info,
    domainMatch,
    error: domainMatch ? undefined : `License is for domain "${info.domain}", not "${currentDomain}"`,
  };
}

/**
 * Validate license format only (for quick client-side check)
 * Does NOT verify signature - use validateLicense for full verification
 */
export function isValidLicenseFormat(licenseKey: string): boolean {
  return /^SF-[a-zA-Z0-9.*-]+-(?:UNLIMITED|\d{8})-[A-Za-z0-9_-]+$/.test(licenseKey);
}
