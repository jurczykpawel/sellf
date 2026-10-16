/** Local lifecycle acceptance; requires the exclusive Sellf DB slot. @see supabase/tests/storefront-mutations.sql */
import { execFileSync } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { storefrontLifecycle } from '@/lib/storefront-templates/lifecycle';
import { verifyTemplateSession } from '@/lib/storefront-templates/mutations';
import { DEFAULT_CONFIG, D_CONFIG } from '@/lib/storefront-templates/fixtures';
import type { LifecycleResult } from '@/lib/storefront-templates/lifecycle';
const m = vi.hoisted(() => ({ tier: vi.fn(() => 'free') }));
vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: async () => true }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/auth-server', () => ({ requireAdminApi: async () => ({ user: { id: 'dddddddd-0000-4000-a000-000000000000' } }) }));
vi.mock('@/lib/license/public-snapshot', () => ({ getPublicLicenseTier: m.tier }));
const sql = (query: string): string => execFileSync('docker', ['exec', '-i', 'supabase_db_sellf', 'psql', '-U', 'postgres', '-tA', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' }).trim();
const literal = (value: unknown): string => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
const stateQuery = `SELECT jsonb_build_array(
  (SELECT to_jsonb(c) FROM public.storefront_config c),
  (SELECT jsonb_agg(to_jsonb(h) ORDER BY revision) FROM public.storefront_config_history h),
  (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.audit_log a WHERE table_name='storefront_config'),
  (SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY id)::text,'')) FROM public.products p),
  (SELECT md5(coalesce(jsonb_agg(to_jsonb(i) ORDER BY id)::text,'')) FROM public.integrations_config i));`;
it('saves free Pro drafts, publishes stored state, resets, diffs and rolls back through the live RPC', async () => {
  const url = new URL(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  expect(['localhost', '127.0.0.1']).toContain(url.hostname);
  const before = sql(stateQuery);
  const [original] = JSON.parse(before);
  const client = createAdminClient(); const auth = await verifyTemplateSession();
  const { data: products, error } = await client.from('products').select('id').eq('is_active', true).eq('is_listed', true).limit(1);
  expect(error).toBeNull(); expect(products).toHaveLength(1);
  const config = { ...structuredClone(D_CONFIG), tokens: { format: 1 as const, light: { accent: '#075C43' } }, settingsByTemplate: { d: { heroProduct: products![0].id, closingProduct: products![0].id } } };
  let revision = original.revision;
  const run = async (input: Record<string, unknown>): Promise<LifecycleResult> => storefrontLifecycle(auth, { expectedRevision: revision, ...input });
  const advance = (response: LifecycleResult): void => {
    expect(response).toMatchObject({ success: true, revision: revision + 1 });
    if (!response.success || !('revision' in response)) throw Error('Expected mutation revision');
    revision = response.revision;
  };
  try {
    advance(await run({ operation: 'draft', config: DEFAULT_CONFIG }));
    advance(await run({ operation: 'publish' })); const defaultRevision = revision;
    advance(await run({ operation: 'draft', config })); const authoringRevision = revision;
    expect(await run({ operation: 'publish' })).toMatchObject({ code: 'FORBIDDEN' });
    m.tier.mockReturnValue('pro');
    advance(await run({ operation: 'publish' })); const proRevision = revision;
    const { data: published } = await client.from('storefront_config').select('draft,published').eq('id', true).single();
    expect(published).toEqual({ draft: null, published: config });
    expect(await storefrontLifecycle(auth, { operation: 'publish', expectedRevision: authoringRevision })).toMatchObject({ status: 409, currentRevision: revision });
    advance(await run({ operation: 'reset', templateId: 'd', field: 'tokens.light.accent' }));
    expect(await storefrontLifecycle(auth, { operation: 'read' })).toMatchObject({ success: true, data: { published: config, draft: { tokens: null, content: config.content } } });
    expect(await storefrontLifecycle(auth, { operation: 'diff', fromRevision: proRevision, toRevision: revision })).toMatchObject({ success: true, data: { changes: [{ path: '/tokens', kind: 'changed', before: config.tokens, after: null }] } });
    advance(await run({ operation: 'rollback', targetRevision: defaultRevision }));
    expect(await storefrontLifecycle(auth, { operation: 'read' })).toMatchObject({ success: true, data: { draft: null, published: DEFAULT_CONFIG } });
    const history = await client.from('storefront_config_history').select('restored_from').eq('revision', revision).single();
    expect(history.data?.restored_from).toBe(defaultRevision);
    m.tier.mockReturnValue('free');
    expect(await run({ operation: 'rollback', targetRevision: proRevision })).toMatchObject({ code: 'FORBIDDEN' });
  } finally {
    const row = literal(original);
    sql(`BEGIN;
      UPDATE public.storefront_config c SET revision=b.revision,draft=b.draft,published=b.published,updated_at=b.updated_at,updated_by=b.updated_by
        FROM jsonb_populate_record(NULL::public.storefront_config,${row}) b WHERE c.id=true;
      DELETE FROM public.storefront_config_history WHERE revision>${original.revision};
      DELETE FROM public.audit_log WHERE table_name='storefront_config' AND (new_values->>'revision')::bigint>${original.revision};
      COMMIT;`);
    expect(sql(stateQuery)).toBe(before);
  }
}, 30_000);
