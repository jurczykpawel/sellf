/**
 * Regression coverage for the centralized Supabase cookie options helper:
 *   1. The helper does not emit `httpOnly: true` (would break the browser
 *      SDK that reads tokens from `document.cookie`).
 *   2. Production cookies stay on `secure: true` / `sameSite: 'none'` so
 *      the cross-domain SDK keeps working over HTTPS.
 *   3. The three writers (server.ts, proxy.ts, auth callback) still go
 *      through the central helper.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildSupabaseCookieOptions } from '@/lib/supabase/cookie-options';

const ADMIN_PANEL_SRC = join(__dirname, '../../../src');

describe('Supabase auth cookie options helper', () => {
  describe('buildSupabaseCookieOptions', () => {
    it('production: secure=true, sameSite=none, path=/, httpOnly=false', () => {
      const opts = buildSupabaseCookieOptions({ isProduction: true });
      expect(opts.secure).toBe(true);
      expect(opts.sameSite).toBe('none');
      expect(opts.path).toBe('/');
      // Required by the browser SDK that reads tokens via document.cookie.
      expect(opts.httpOnly).toBe(false);
    });

    it('development: secure=false, sameSite=lax (relaxed for http://localhost)', () => {
      const opts = buildSupabaseCookieOptions({ isProduction: false });
      expect(opts.secure).toBe(false);
      expect(opts.sameSite).toBe('lax');
      expect(opts.path).toBe('/');
      expect(opts.httpOnly).toBe(false);
    });

    it('caller-supplied options are merged but security flags ALWAYS win', () => {
      const opts = buildSupabaseCookieOptions({
        isProduction: true,
        callerOptions: {
          httpOnly: true,            // ignored — browser SDK requires JS-readable
          secure: false,             // ignored in production — must be true
          sameSite: 'strict',        // ignored in production — must be 'none'
          domain: '.shop.example',   // legitimate caller field, kept
          maxAge: 600,               // legitimate caller field, kept
        },
      });
      expect(opts.httpOnly).toBe(false);
      expect(opts.secure).toBe(true);
      expect(opts.sameSite).toBe('none');
      expect(opts.domain).toBe('.shop.example');
      expect(opts.maxAge).toBe(600);
    });

    it('dev: caller can opt into a stricter sameSite (lax→strict ok), but never weaker', () => {
      const opts = buildSupabaseCookieOptions({
        isProduction: false,
        callerOptions: { sameSite: 'strict' },
      });
      // Caller-supplied stricter sameSite kept in dev.
      expect(opts.sameSite).toBe('strict');
    });
  });

  describe('helper is used by all three Supabase cookie writers', () => {
    function fileContents(rel: string): string {
      return readFileSync(join(ADMIN_PANEL_SRC, rel), 'utf-8');
    }

    it('src/lib/supabase/server.ts imports buildSupabaseCookieOptions', () => {
      const sql = fileContents('lib/supabase/server.ts');
      expect(sql).toMatch(/buildSupabaseCookieOptions/);
    });

    it('src/proxy.ts imports buildSupabaseCookieOptions', () => {
      const sql = fileContents('proxy.ts');
      expect(sql).toMatch(/buildSupabaseCookieOptions/);
    });

    it('src/app/[locale]/auth/callback/route.ts imports buildSupabaseCookieOptions', () => {
      const sql = fileContents('app/[locale]/auth/callback/route.ts');
      expect(sql).toMatch(/buildSupabaseCookieOptions/);
    });
  });
});
