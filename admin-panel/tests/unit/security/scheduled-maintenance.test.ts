/**
 * DB TEST: maintenance functions run on a pg_cron schedule
 *
 * REQUIRES: Supabase running locally (npx supabase start)
 *
 * @see supabase/migrations/20260924000000_access_scope_tightening.sql
 */

import { execSync } from 'child_process';
import { describe, it, expect } from 'vitest';

function scheduledCommands(): string[] {
  const out = execSync(`docker exec -i supabase_db_sellf psql -U postgres -t -A`, {
    input: 'SELECT command FROM cron.job WHERE active;',
    encoding: 'utf-8',
    timeout: 10000,
  });
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

function queryOne(sql: string): string {
  const out = execSync(`docker exec -i supabase_db_sellf psql -U postgres -t -A`, {
    input: sql,
    encoding: 'utf-8',
    timeout: 10000,
  });
  return out.trim();
}

describe('scheduled maintenance', () => {
  it.each([
    'cleanup_rate_limits',
    'cleanup_application_rate_limits',
    'cleanup_expired_oto_coupons',
    'mark_expired_pending_payments',
    'cleanup_captcha_nonces',
  ])('%s is scheduled', (fn) => {
    expect(scheduledCommands().some((cmd) => cmd.includes(`${fn}()`))).toBe(true);
  });

  it('cleanup_audit_logs is scheduled with a 12-month retention', () => {
    expect(scheduledCommands().some((cmd) => /cleanup_audit_logs\(\s*365\s*\)/.test(cmd))).toBe(true);
  });

  it('cleanup_old_guest_purchases is not scheduled (unclaimed guest purchases must be kept)', () => {
    expect(scheduledCommands().some((cmd) => cmd.includes('cleanup_old_guest_purchases('))).toBe(false);
  });

  it('cleanup_loginwall_tokens is not scheduled (the ledger was removed, nothing ever read it)', () => {
    expect(scheduledCommands().some((cmd) => cmd.includes('cleanup_loginwall_tokens('))).toBe(false);
  });

  it('cleanup_loginwall_tokens function no longer exists', () => {
    expect(queryOne("SELECT to_regproc('public.cleanup_loginwall_tokens');")).toBe('');
  });

  it('loginwall_tokens table no longer exists', () => {
    expect(queryOne("SELECT to_regclass('public.loginwall_tokens');")).toBe('');
  });
});
