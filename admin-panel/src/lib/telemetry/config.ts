import { DEFAULT_TELEMETRY_URL } from './constants';

export function isTelemetryEnabled(): boolean {
  if (process.env.SELLF_TELEMETRY_DISABLED === 'true') return false;
  if (process.env.SELLF_TELEMETRY_ENABLED === 'false') return false;
  return true;
}

const PRIVATE_V4 = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[0-1])\./, /^127\./, /^0\.0\.0\.0$/];

export function isNonDeploymentHost(host: string): boolean {
  const h = host.toLowerCase().trim();
  if (h === '' || h === 'localhost' || h === '::1' || h === '0.0.0.0') return true;
  if (h.endsWith('.local') || h.endsWith('.localhost')) return true;
  if (!h.includes('.')) return true;                 // dotless / single-label host
  if (PRIVATE_V4.some((re) => re.test(h))) return true;
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
