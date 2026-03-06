/**
 * Trusted storage providers allowed as download URLs for digital products.
 * Used both in form validation (useProductForm) and content rendering (DigitalContentRenderer).
 * Keep this list as the single source of truth.
 */
/** Domain suffixes — matched via exact match or `.suffix` */
export const TRUSTED_DOWNLOAD_PROVIDERS = [
  'amazonaws.com',
  'googleapis.com',
  'supabase.co',
  'supabase.in',
  'bunny.net',
  'b-cdn.net',
  'drive.google.com',
  'docs.google.com',
  'dropbox.com',
  'dl.dropboxusercontent.com',
  'onedrive.live.com',
  '1drv.ms',
  'sharepoint.com',
  'box.com',
  'mega.nz',
  'mediafire.com',
  'wetransfer.com',
  'sendspace.com',
  'cloudinary.com',
  'imgix.net',
  'fastly.net',
] as const;

/**
 * Returns true if the given URL is from a trusted storage provider and uses HTTPS.
 */
export function isTrustedDownloadUrl(url: string): boolean {
  if (!url.startsWith('https://')) return false;
  try {
    const { hostname } = new URL(url);
    return TRUSTED_DOWNLOAD_PROVIDERS.some((provider) =>
      hostname === provider || hostname.endsWith('.' + provider)
    );
  } catch {
    return false;
  }
}
