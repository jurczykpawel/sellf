/** Local credential persistence acceptance. @see supabase/tests/template-credentials.sql */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { decryptSecret } from '@/lib/services/secret-encryption';
import { verifyTemplateSession } from '@/lib/storefront-templates/mutations';
import { saveTemplateCredential, readTemplateLicenseStatuses } from '@/lib/storefront-templates/template-credentials';
import { createPlatformClient } from '@/lib/supabase/admin';
import { getTestDatabaseContainer } from '../../helpers/database-container';
vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: async () => true }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/auth-server', () => ({ requireAdminApi: async () => ({ user: { id: 'dddddddd-0000-4000-a000-000000000000' } }) }));

it('persists ciphertext across clients and keeps presentation exports and audit separate @J129', async () => {
  const url = new URL(process.env.SUPABASE_URL ?? '');
  expect(['127.0.0.1', 'localhost']).toContain(url.hostname);
  const container = getTestDatabaseContainer();
  const port = execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' });
  const apiPort = execFileSync('docker', ['port', container.replace('supabase_db_', 'supabase_kong_'), '8000/tcp'], { encoding: 'utf8' });
  expect(port).not.toBe(''); expect(apiPort).toContain(`:${url.port}`);
  const sql = (query: string): string => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-tA', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' }).trim();
  const snapshotQuery = `SELECT jsonb_build_object(
    'credentials',(SELECT jsonb_agg(c ORDER BY template_id) FROM public.template_credentials c),
    'audit',(SELECT coalesce(jsonb_agg(a ORDER BY id),'[]'::jsonb) FROM public.audit_log a WHERE table_name='template_credentials'))`;
  const before = sql(snapshotQuery);
  const exported = (): string => sql(`SELECT jsonb_build_array((SELECT to_jsonb(c) FROM public.storefront_config c),
    (SELECT jsonb_agg(h ORDER BY revision) FROM public.storefront_config_history h))`);
  const presentation = exported();
  const token = `synthetic-credential.person@example.test.order-marker.${randomBytes(12).toString('hex')}`;
  const log = vi.spyOn(console, 'error');
  vi.stubEnv('APP_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  try {
    const auth = await verifyTemplateSession();
    expect(await saveTemplateCredential(auth, { templateId: 'storefront-a', token })).toEqual({ success: true, data: { templateId: 'storefront-a', state: 'unknown', verifiedAt: null } });
    const { data, error } = await createPlatformClient().from('template_credentials').select('encrypted_key,encryption_iv,encryption_tag').eq('template_id', 'storefront-a').single();
    expect(error).toBeNull();
    expect(data?.encrypted_key).not.toContain(token);
    expect(await decryptSecret({ encrypted_key: data!.encrypted_key!, encryption_iv: data!.encryption_iv!, encryption_tag: data!.encryption_tag! })).toBe(token);
    const statuses = await readTemplateLicenseStatuses(auth);
    expect(statuses).toMatchObject({ success: true, data: expect.arrayContaining([{ templateId: 'storefront-a', state: 'unknown', verifiedAt: null }]) });
    expect(JSON.stringify(statuses)).not.toMatch(/credential|person@|order-marker|encrypted_key/);
    expect(exported()).toBe(presentation);
    expect(sql("SELECT new_values FROM public.audit_log WHERE table_name='template_credentials'")).not.toMatch(/synthetic-credential|person@|order-marker|encrypted_key/);
    const saved = sql(snapshotQuery);
    vi.stubEnv('APP_ENCRYPTION_KEY', ''); vi.stubEnv('STRIPE_ENCRYPTION_KEY', '');
    expect(await saveTemplateCredential(auth, { templateId: 'storefront-a', token: 'replacement' })).toMatchObject({ code: 'UNAVAILABLE' });
    expect(sql(snapshotQuery)).toBe(saved);
    expect(log).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs(); log.mockRestore();
    const literal = "'" + before.replaceAll("'", "''") + "'::jsonb";
    sql(`BEGIN; DELETE FROM public.template_credentials;
      INSERT INTO public.template_credentials SELECT * FROM jsonb_populate_recordset(NULL::public.template_credentials,${literal}->'credentials');
      DELETE FROM public.audit_log WHERE table_name='template_credentials' AND id NOT IN
        (SELECT (a->>'id')::uuid FROM jsonb_array_elements(${literal}->'audit') a); COMMIT;`);
    expect(sql(snapshotQuery)).toBe(before);
  }
}, 30_000);
