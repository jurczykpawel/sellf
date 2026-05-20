// Read trusted client IP from the LAST X-Forwarded-For hop (the one our own
// proxy appends), never the first (attacker-controlled). See .env.example.

export type HeadersLike = { get(name: string): string | null };

export function extractTrustedClientIp(headers: HeadersLike): string | null {
  if (process.env.TRUSTED_PROXY !== 'true') return null;

  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }

  const xRealIp = headers.get('x-real-ip')?.trim();
  if (xRealIp) return xRealIp;

  return null;
}

export function getClientIp(request: Request): string {
  return extractTrustedClientIp(request.headers) ?? 'unknown';
}
