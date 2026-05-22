/**
 * Trusted storage providers allowed as download URLs for digital products.
 * Single source of truth — used by ProductFormModal (client), DigitalContentRenderer
 * (client) and validateCreateProduct/validateUpdateProduct (server).
 *
 * Operators can extend this list at deploy time via env var:
 *   NEXT_PUBLIC_SELLF_ALLOWED_DOWNLOAD_DOMAINS=lm.techskills.academy,assets.example.com
 *
 * Why NEXT_PUBLIC_*: Next.js inlines NEXT_PUBLIC_* into the client bundle at build
 * time AND keeps it readable on the server, so a single var feeds both validation
 * surfaces. Domains are not secrets — the URL itself becomes public after purchase.
 */

/** Hardcoded baseline — vetted storage providers that ship with Sellf. */
export const TRUSTED_DOWNLOAD_PROVIDERS_BASE = [
  // AWS
  'amazonaws.com',
  'cloudfront.net',
  // Google
  'googleapis.com',
  'drive.google.com',
  'docs.google.com',
  // Microsoft
  'onedrive.live.com',
  '1drv.ms',
  'sharepoint.com',
  'azureedge.net',
  // Supabase
  'supabase.co',
  'supabase.in',
  // Bunny CDN
  'bunny.net',
  'b-cdn.net',
  // Dropbox
  'dropbox.com',
  'dropboxusercontent.com',
  // Cloudflare R2
  'cloudflarestorage.com',
  // Other
  'box.com',
  'mega.nz',
  'mediafire.com',
  'wetransfer.com',
  'sendspace.com',
  'cloudinary.com',
  'imgix.net',
  'fastly.net',
] as const;

const ENV_VAR_NAME = 'NEXT_PUBLIC_SELLF_ALLOWED_DOWNLOAD_DOMAINS';

/**
 * Reject anything that isn't a clean hostname suffix:
 * no protocol, no path, no wildcards, no internal whitespace, must contain a dot.
 * (Single-label hosts like "localhost" rejected by design — never a CDN target.)
 */
function isValidDomainEntry(value: string): boolean {
  if (!value) return false;
  if (/[\s/\\*?@:]/.test(value)) return false;
  if (!value.includes('.')) return false;
  // Hostname charset: letters, digits, hyphen, dot
  if (!/^[a-z0-9.-]+$/.test(value)) return false;
  // No leading/trailing dot or hyphen
  if (/^[.-]|[.-]$/.test(value)) return false;
  return true;
}

function parseEnvDomains(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(isValidDomainEntry);
}

/**
 * Returns the active trusted-domain list: hardcoded baseline + sanitized env additions.
 * Env value is read on every call so tests and runtime config changes are picked up.
 */
export function getTrustedDownloadProviders(): readonly string[] {
  const envExtra = parseEnvDomains(process.env[ENV_VAR_NAME]);
  if (envExtra.length === 0) return TRUSTED_DOWNLOAD_PROVIDERS_BASE;
  // Dedupe in case operator re-adds a baseline domain
  return Array.from(new Set([...TRUSTED_DOWNLOAD_PROVIDERS_BASE, ...envExtra]));
}

/**
 * @deprecated Prefer `getTrustedDownloadProviders()` — env additions are not reflected.
 * Kept for any external import by name; baseline list only.
 */
export const TRUSTED_DOWNLOAD_PROVIDERS = TRUSTED_DOWNLOAD_PROVIDERS_BASE;

/**
 * Returns true if the URL uses HTTPS and its hostname is the configured provider
 * itself or a direct subdomain of one. Match is exact-host or `.suffix` so an
 * unrelated host that merely ends with the provider string does not pass.
 *
 * `providers` lets the client pass the server-resolved list (via /api/runtime-config)
 * — NEXT_PUBLIC_* envs are inlined at build time with CI placeholders, so client
 * bundles never see the operator's additions unless they arrive at runtime.
 */
export function isTrustedDownloadUrl(url: string, providers?: readonly string[]): boolean {
  if (!url.startsWith('https://')) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const list = providers ?? getTrustedDownloadProviders();
    return list.some(
      (provider) => hostname === provider || hostname.endsWith('.' + provider)
    );
  } catch {
    return false;
  }
}
