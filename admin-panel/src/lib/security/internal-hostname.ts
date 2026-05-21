import { isPrivateOrReservedIp } from './ip-blocklist';

/**
 * True for hostnames that obviously point at an internal/private endpoint.
 *
 * Used by redirect validators that must refuse to bounce a user to private
 * networks (open-redirect / phishing mitigation). Lexical-only — no DNS
 * resolution; the caller is responsible for choosing whether to additionally
 * resolve the hostname before bouncing.
 */
export function isInternalHostname(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '0.0.0.0') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return isPrivateOrReservedIp(h);
  if (h.includes(':')) return isPrivateOrReservedIp(h);
  return false;
}
