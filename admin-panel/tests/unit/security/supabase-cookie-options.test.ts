/**
 * Regression coverage for the centralized Supabase cookie options helper.
 *
 * The helper is the single source of truth for the security flags on
 * every Supabase-issued auth cookie. After the auth refactor the helper
 * mirrors the @supabase/ssr defaults so the browser blocks cross-origin
 * sends natively.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildSupabaseCookieOptions } from '@/lib/supabase/cookie-options';

const ADMIN_PANEL_SRC = join(__dirname, '../../../src');

describe('Supabase auth cookie options helper', () => {
  describe('buildSupabaseCookieOptions', () => {
    it('production: secure=true, sameSite=lax, path=/, httpOnly=false', () => {
      const opts = buildSupabaseCookieOptions({ isProduction: true });
      expect(opts.secure).toBe(true);
      expect(opts.sameSite).toBe('lax');
      expect(opts.path).toBe('/');
      expect(opts.httpOnly).toBe(false);
    });

    it('development: secure=false by default, sameSite=lax, httpOnly=false', () => {
      const opts = buildSupabaseCookieOptions({ isProduction: false });
      expect(opts.secure).toBe(false);
      expect(opts.sameSite).toBe('lax');
      expect(opts.path).toBe('/');
      expect(opts.httpOnly).toBe(false);
    });

    it('security flags ignore caller overrides, but domain/maxAge pass through', () => {
      const opts = buildSupabaseCookieOptions({
        isProduction: true,
        callerOptions: {
          httpOnly: true,
          secure: false,
          sameSite: 'none',
          domain: '.shop.example',
          maxAge: 600,
        },
      });
      expect(opts.httpOnly).toBe(false);
      expect(opts.secure).toBe(true);
      expect(opts.sameSite).toBe('lax');
      expect(opts.domain).toBe('.shop.example');
      expect(opts.maxAge).toBe(600);
    });

    it('dev: caller can opt into a stricter sameSite', () => {
      const opts = buildSupabaseCookieOptions({
        isProduction: false,
        callerOptions: { sameSite: 'strict' },
      });
      expect(opts.sameSite).toBe('strict');
    });
  });

  describe('helper is used by all three Supabase cookie writers', () => {
    function fileContents(rel: string): string {
      return readFileSync(join(ADMIN_PANEL_SRC, rel), 'utf-8');
    }

    it('src/lib/supabase/server.ts imports buildSupabaseCookieOptions', () => {
      expect(fileContents('lib/supabase/server.ts')).toMatch(/buildSupabaseCookieOptions/);
    });

    it('src/proxy.ts imports buildSupabaseCookieOptions', () => {
      expect(fileContents('proxy.ts')).toMatch(/buildSupabaseCookieOptions/);
    });

    it('src/app/[locale]/auth/callback/route.ts imports buildSupabaseCookieOptions', () => {
      expect(fileContents('app/[locale]/auth/callback/route.ts')).toMatch(/buildSupabaseCookieOptions/);
    });
  });
});
