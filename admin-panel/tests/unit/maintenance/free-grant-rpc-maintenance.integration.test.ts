/**
 * DB TEST: maintenance mode closes the public free-grant RPCs themselves, not only the Next.js
 * routes. A signed-in buyer can call PostgREST directly (`/rest/v1/rpc/grant_free_product_access`),
 * so the database refuses a NEW free grant while the database switch is on; completing a free-grant
 * request saved before the break (a context only the server can record) and the trusted service-role
 * paths (paid fulfillment) keep working.
 * Every case runs as the real `authenticated` role with buyer claims in a rolled-back transaction.
 *
 * REQUIRES: the local Supabase stack.
 * @see supabase/migrations/20261118000000_release_2026_11_1.sql
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../../helpers/database-container';

const BUYER = '00000000-0000-4000-8000-00000000c261';
const SLUG = 'w261c-direct-free';

/** Creates a confirmed buyer and an active free product, then runs `body` and rolls everything back. */
function run(body: string): { out: string[]; error?: string } {
  const setup = `
    BEGIN;
    SET LOCAL request.jwt.claims='{"role":"service_role"}';
    INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES ('${BUYER}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w261c-buyer@example.com', now(), '{}', '{}', now(), now());
    INSERT INTO public.products (name, slug, price, currency, is_active) VALUES ('W261c direct free', '${SLUG}', 0, 'PLN', true);
    CREATE TEMP TABLE ctx AS SELECT NULL::uuid AS id;
    GRANT SELECT ON ctx TO authenticated;
  `;
  try {
    const out = execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], {
      input: `${setup}${body}\nROLLBACK;`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { out: out.trim().split('\n') };
  } catch (error) {
    return { out: [], error: String((error as { stderr?: string }).stderr ?? error) };
  }
}

const maintenanceOn = `SELECT public.set_maintenance_mode(true, NULL, NULL, '${BUYER}') IS NOT NULL;`;
const asBuyer = `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${BUYER}","email":"w261c-buyer@example.com"}';`;
const asService = `RESET ROLE; SET LOCAL request.jwt.claims='{"role":"service_role"}';`;
const accessRows = `SELECT 'rows=' || count(*) FROM public.user_product_access a JOIN public.products p ON p.id = a.product_id WHERE p.slug = '${SLUG}' AND a.user_id = '${BUYER}';`;
const saveContext = `UPDATE ctx SET id = public.prepare_free_grant('w261c-buyer@example.com', (SELECT id FROM public.products WHERE slug = '${SLUG}'), '{}');`;

describe('free-grant RPCs during maintenance (real database privileges)', () => {
  it('refuses a new free grant called directly by a signed-in buyer, and no access row appears', () => {
    const result = run(`${maintenanceOn} ${asBuyer} SELECT public.grant_free_product_access('${SLUG}');`);
    expect(result.error).toMatch(/Down for maintenance/);
    const rows = run(`${maintenanceOn} ${asBuyer} SAVEPOINT s; DO $$ BEGIN PERFORM public.grant_free_product_access('${SLUG}'); EXCEPTION WHEN OTHERS THEN NULL; END $$; ${asService} ${accessRows}`);
    expect(rows.out).toContain('rows=0');
  });

  it('refuses grant_free_with_context without a saved request', () => {
    expect(run(`${maintenanceOn} ${asBuyer} SELECT public.grant_free_with_context('${SLUG}', NULL, NULL);`).error).toMatch(/Down for maintenance/);
  });

  it('the implementation behind the wrapper is not callable by authenticated or anon', () => {
    expect(run(`${asBuyer} SELECT public.grant_free_product_access_impl('${SLUG}', NULL, NULL);`).error).toMatch(/permission denied/);
    expect(run(`SET LOCAL ROLE anon; SET LOCAL request.jwt.claims='{"role":"anon"}'; SELECT public.grant_free_product_access('${SLUG}');`).error).toMatch(/permission denied/);
  });

  it('completes a free-grant request the server saved before the break', () => {
    const result = run(`${saveContext} ${maintenanceOn} ${asBuyer} SELECT 'granted=' || public.grant_free_with_context('${SLUG}', NULL, (SELECT id FROM ctx)); ${asService} ${accessRows}`);
    expect(result.error).toBeUndefined();
    expect(result.out).toEqual(expect.arrayContaining(['granted=true', 'rows=1']));
  });

  it('a saved request of another buyer does not open the RPC for this buyer', () => {
    const result = run(`
      INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
        VALUES ('00000000-0000-4000-8000-00000000c262', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w261c-other@example.com', now(), '{}', '{}', now(), now());
      SELECT public.prepare_free_grant('w261c-other@example.com', (SELECT id FROM public.products WHERE slug = '${SLUG}'), '{}') IS NOT NULL;
      ${maintenanceOn} ${asBuyer} SELECT public.grant_free_product_access('${SLUG}');`);
    expect(result.error).toMatch(/Down for maintenance/);
  });

  it('grants as before while maintenance is off', () => {
    const result = run(`${asBuyer} SELECT 'granted=' || public.grant_free_product_access('${SLUG}'); ${asService} ${accessRows}`);
    expect(result.error).toBeUndefined();
    expect(result.out).toEqual(expect.arrayContaining(['granted=true', 'rows=1']));
  });

  it('the trusted service-role grant (paid fulfillment) is unchanged during maintenance', () => {
    const result = run(`${maintenanceOn} SELECT (public.grant_product_access_service_role('${BUYER}', (SELECT id FROM public.products WHERE slug = '${SLUG}'))->>'success'); ${accessRows}`);
    expect(result.error).toBeUndefined();
    expect(result.out).toEqual(expect.arrayContaining(['true', 'rows=1']));
  });
});
