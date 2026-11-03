import { getTestDatabaseContainer } from '@/../tests/helpers/database-container';
/** Disposable affiliate snapshot restore acceptance. @see ../database.ts */
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { resetAffiliateDatabase } from '../database';
const container = getTestDatabaseContainer();
const tables = ['affiliate_program_versions', 'affiliate_membership_events', 'affiliate_programs', 'affiliate_memberships', 'affiliate_rules', 'affiliate_coupon_bindings', 'affiliate_commissions', 'affiliate_payouts', 'affiliate_ledger', 'affiliate_payout_allocations', 'affiliate_work'];
// purchase_attribution (b062aa01) references affiliate_memberships, so the accounting snapshot carries it along.
const restored = [...tables, 'purchase_attribution'];
function sql(input: string): string {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8' }).trim();
}
function snapshot(): string {
  return restored.map(table => sql(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') FROM public.${table} t`)).join('\n');
}
it('restores the accounting snapshot and keeps the role matrix and immutable entries', () => {
  resetAffiliateDatabase();
  const before = snapshot();
  const dump = execFileSync('docker', ['exec', container, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--data-only', '--column-inserts', '--table=public.affiliate_*', '--table=public.purchase_attribution'], { encoding: 'utf8' });
  sql(`BEGIN; SET CONSTRAINTS ALL DEFERRED; TRUNCATE ${restored.map(t => `public.${t}`).join(',')};\n${dump}\nSET CONSTRAINTS ALL IMMEDIATE; COMMIT;`);
  expect(snapshot()).toBe(before);
  expect(sql("SELECT count(*) FROM pg_class WHERE relname LIKE 'affiliate_%' AND relkind='r' AND relrowsecurity")).toBe('11');
  expect(sql("SELECT has_table_privilege('anon','public.affiliate_ledger','SELECT'),has_table_privilege('authenticated','public.affiliate_ledger','SELECT')")).toBe('f|f');
  expect(() => sql('UPDATE public.affiliate_ledger SET amount_minor=amount_minor+1')).toThrow();
}, 125000);
