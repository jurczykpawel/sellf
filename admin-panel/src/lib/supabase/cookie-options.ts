/**
 * Centralized Supabase auth cookie options.
 *
 * Single source of truth for the cookie flags written by
 * `src/lib/supabase/server.ts`, `src/proxy.ts`, and the auth callback path
 * so flags cannot drift between code paths.
 */

type SameSite = 'lax' | 'strict' | 'none';

interface BuildOptionsInput {
  isProduction: boolean;
  /**
   * Caller's original cookie options (passed by `@supabase/ssr` for things
   * like `domain`, `maxAge`, `expires`). Security-related fields are
   * overridden — caller-supplied weaker values are ignored.
   */
  callerOptions?: Record<string, unknown>;
}

interface SupabaseCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: SameSite;
  path: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  priority?: 'low' | 'medium' | 'high';
}

function pickSameSite(input: BuildOptionsInput): SameSite {
  if (input.isProduction) return 'lax';
  const caller = input.callerOptions?.sameSite;
  if (caller === 'lax' || caller === 'strict' || caller === 'none') return caller;
  return 'lax';
}

function pickSecure(input: BuildOptionsInput): boolean {
  if (input.isProduction) return true;
  return Boolean(input.callerOptions?.secure);
}

/**
 * Build cookie options for a Supabase-issued cookie. The flag triple
 * (`httpOnly`, `secure`, `sameSite`) is owned by this helper and overrides
 * caller-supplied values; `domain`, `maxAge`, `expires`, `priority` pass
 * through.
 */
export function buildSupabaseCookieOptions(input: BuildOptionsInput): SupabaseCookieOptions {
  const caller = input.callerOptions ?? {};
  return {
    // @supabase/ssr createBrowserClient reads the session from document.cookie
    // on the client, so the cookie has to stay JS-readable. SameSite=Lax is the
    // primary CSRF defence (browser blocks cross-origin cookie sends); an XSS
    // would still let JS read the session, tracked separately.
    httpOnly: false,
    secure: pickSecure(input),
    sameSite: pickSameSite(input),
    path: '/',
    domain: typeof caller.domain === 'string' ? caller.domain : undefined,
    maxAge: typeof caller.maxAge === 'number' ? caller.maxAge : undefined,
    expires: caller.expires instanceof Date ? caller.expires : undefined,
    priority: caller.priority === 'low' || caller.priority === 'medium' || caller.priority === 'high'
      ? caller.priority
      : undefined,
  };
}

/**
 * Convenience that reads `process.env.NODE_ENV` for callers that just want
 * the same flags everyone else uses. Server.ts and proxy.ts both end up
 * passing `isProduction: NODE_ENV === 'production'`.
 */
export function buildSupabaseCookieOptionsFromEnv(callerOptions?: Record<string, unknown>): SupabaseCookieOptions {
  return buildSupabaseCookieOptions({
    isProduction: process.env.NODE_ENV === 'production',
    callerOptions,
  });
}
