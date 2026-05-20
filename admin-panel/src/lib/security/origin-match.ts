/**
 * Compare an incoming Origin/Referer header against an allowlist using
 * URL.origin exact match. Prevents prefix/suffix lookalike bypasses
 * (e.g. allowing `https://example.com.evil.com` when the allowlist has
 * `https://example.com`).
 */
export function isAllowedOrigin(
  value: string | null | undefined,
  allowed: readonly string[],
): boolean {
  if (!value) return false;

  let incoming: string;
  try {
    incoming = new URL(value).origin;
  } catch {
    return false;
  }

  for (const entry of allowed) {
    if (!entry) continue;
    try {
      if (new URL(entry).origin === incoming) return true;
    } catch {
      // skip malformed allowlist entries silently
    }
  }
  return false;
}
