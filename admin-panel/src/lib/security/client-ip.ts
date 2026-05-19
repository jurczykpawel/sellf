/**
 * Resolve a best-guess client IP for audit logging.
 *
 * Browser-supplied headers (`x-forwarded-for`, `x-real-ip`) are only
 * trusted when the deployment opts in via `TRUSTED_PROXY=true`. Without
 * that env signal, those headers are spoofable, so we return 'unknown'
 * instead of forwarding attacker-chosen values into the database.
 */
export function getClientIp(request: Request): string {
  if (process.env.TRUSTED_PROXY === 'true') {
    const xff = request.headers.get('x-forwarded-for');
    if (xff) {
      const first = xff.split(',')[0]?.trim();
      if (first) return first;
    }
    const xRealIp = request.headers.get('x-real-ip');
    if (xRealIp) return xRealIp.trim();
  }
  return 'unknown';
}
