import { DEFAULT_TELEMETRY_URL } from './constants';

export function isTelemetryEnabled(): boolean {
  if (process.env.SELLF_TELEMETRY_DISABLED === 'true') return false;
  if (process.env.SELLF_TELEMETRY_ENABLED === 'false') return false;
  return true;
}

const PRIVATE_V4 = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^169\.254\./, // IPv4 link-local (169.254.0.0/16)
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT (100.64.0.0/10)
];

export function isNonDeploymentHost(host: string): boolean {
  // Strip IPv6 URL brackets — `new URL(...).hostname` returns the "[::1]" form.
  const h = host.toLowerCase().trim().replace(/^\[/, '').replace(/\]$/, '');
  if (h === '' || h === 'localhost' || h === '::1' || h === '0.0.0.0') return true;
  if (h.endsWith('.local') || h.endsWith('.localhost')) return true;
  // Dotless / single-label host — also catches every bracketless IPv6 literal
  // (incl. fc00::/fd00:: ULA and fe80:: link-local, which contain no '.').
  if (!h.includes('.')) return true;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) carries dots, so test the embedded IPv4.
  const v4 = h.startsWith('::ffff:') ? h.slice('::ffff:'.length) : h;
  if (PRIVATE_V4.some((re) => re.test(v4))) return true;
  return false;
}

export function resolveTelemetryUrl(): string {
  return process.env.TELEMETRY_URL || DEFAULT_TELEMETRY_URL;
}

/** SSRF guard for the operator-overridable URL: https only, no loopback/private targets. */
export function assertSafeOutboundUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('telemetry URL must be https');
  if (isNonDeploymentHost(url.hostname)) throw new Error('telemetry URL points at a private/loopback host');
  return url;
}
