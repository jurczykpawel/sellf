/** Disposable template replacement/restore acceptance. @see scripts/storefront-perf.md */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { encryptSecret, decryptSecret } from '@/lib/services/secret-encryption';
import { D_LOCALIZED_CONFIG } from '@/lib/storefront-templates/fixtures';
import { configSchema } from '@/lib/storefront-templates/schemas';
import { referenceConfig } from '../tests/fixtures/storefront-sections/phase2/contracts';

const stack = process.env.TEMPLATE_TEST_STACK;
assert(stack, 'TEMPLATE_TEST_STACK must name an owned disposable stack');
const config = await readFile(resolve(stack, 'supabase/config.toml'), 'utf8');
const project = /^project_id = "([a-zA-Z0-9_-]+)"/m.exec(config)?.[1];
assert(project && project !== 'sellf' && project.startsWith('sellf-t'), 'Disposable template project required');
const container = `supabase_db_${project}`;
const command = (name, args, options = {}) => execFileSync(name, args, { encoding: 'utf8', ...options });
const status = JSON.parse(command('supabase', ['status', '--workdir', stack, '-o', 'json'], { stdio: ['ignore', 'pipe', 'ignore'] }));
assert.equal(command('docker', ['ps', '--filter', `publish=${new URL(status.API_URL).port}`, '--format', '{{.Names}}']).trim(), `supabase_kong_${project}`);
const db = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sql = input => command('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-XAt', '-v', 'ON_ERROR_STOP=1'], { input });
const scratch = resolve(stack, 'persistence');
const actor = 'dddddddd-0000-4000-a000-000000000000';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function checked(result) { const { data, error } = await result; assert(!error, error?.message); return data; }
async function snapshot() {
  const tables = ['api_keys', 'template_credentials', 'storefront_config', 'storefront_config_history', 'product_offer_config', 'product_offer_history', 'products'];
  return Object.fromEntries(tables.map(table => {
    const rows = JSON.parse(sql(`SELECT coalesce(jsonb_agg(r ORDER BY r::text),'[]') FROM (SELECT to_jsonb(t) r FROM public.${table} t) s;`));
    return [table, { count: rows.length, sha256: hash(rows) }];
  }));
}
const phase = process.argv[2];
if (phase === 'prepare') {
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  const products = await checked(db.from('products').select('id,slug').eq('is_active', true).eq('is_listed', true).order('id').limit(20));
  assert(products.length >= 6);
  const ids = products.map(p => p.id);
  const remapped = JSON.stringify(referenceConfig()).replace(/00000000-0000-4000-8000-(\d{12})/g, (_, n) => ids[(Number(n) - 1) % ids.length]);
  const config = configSchema.parse({ ...JSON.parse(remapped), templateId: 'storefront-c' });
  const mutate = async (operation, validated, revision) => {
    const result = await checked(db.rpc('mutate_storefront_config', { expected_revision: revision, operation, validated_config: validated, actor_user_id: actor, actor_method: 'session' }));
    assert(result.success, 'Storefront fixture mutation'); return result.revision;
  };
  let { revision } = await checked(db.from('storefront_config').select('revision').single());
  for (const templateId of ['storefront-a', 'storefront-b', 'storefront-c']) {
    revision = await mutate('draft', { ...config, templateId }, revision);
    revision = await mutate('publish', null, revision);
    const encrypted = await encryptSecret(`retained-${templateId}-${randomBytes(24).toString('hex')}`);
    const saved = await checked(db.rpc('save_template_credential', { template_id: templateId, encrypted_key: encrypted.encryptedKey, encryption_iv: encrypted.iv, encryption_tag: encrypted.tag, actor_user_id: actor, actor_method: 'session' }));
    assert(saved.success, 'Credential fixture mutation');
  }
  await mutate('draft', { ...config, templateId: 'storefront-a' }, revision);
  const offer = { format: 1, enabled: true, templateId: 'offer-default', settings: { density: 'comfortable' }, content: { 'offer.hero': D_LOCALIZED_CONFIG.content['home.hero'] }, tokens: null };
  const row = await checked(db.from('product_offer_config').select('revision').eq('product_id', ids[0]).maybeSingle());
  let offerRevision = row?.revision ?? 0;
  for (const [index, operation] of ['draft', 'publish', 'draft'].entries()) {
    if (index === 2) offer.content['offer.hero'] = { ...offer.content['offer.hero'], en: { ...offer.content['offer.hero'].en, heading: 'Unpublished restore copy' } };
    const result = await checked(db.rpc('mutate_product_offer', { offer_product_id: ids[0], expected_revision: offerRevision, operation, validated_config: operation === 'draft' ? offer : null, actor_user_id: actor, actor_method: 'session' }));
    assert(result.success, 'Offer fixture mutation'); offerRevision = result.revision;
  }
  const admin = await checked(db.from('admin_users').select('id').eq('user_id', actor).single());
  const apiKey = `sf_test_${randomBytes(32).toString('hex')}`;
  await writeFile(resolve(scratch, 'api.key'), apiKey, { mode: 0o600 });
  await checked(db.from('api_keys').insert({ admin_user_id: admin.id, name: 'Template restore acceptance', key_prefix: 'sf_test_rest', key_hash: createHash('sha256').update(apiKey).digest('hex'), scopes: ['templates:read', 'templates:write', 'templates:activate'] }));
  const credentials = await checked(db.from('template_credentials').select('*'));
  const plaintext = Object.fromEntries(await Promise.all(credentials.filter(r => r.encrypted_key).map(async r => [r.template_id, hash(await decryptSecret(r))])));
  await writeFile(resolve(scratch, 'before.json'), JSON.stringify({ tables: await snapshot(), plaintext, offerSlug: products[0].slug }));
  command('docker', ['exec', container, 'pg_dump', '-U', 'postgres', '-Fc', '--data-only', '--schema=public', '-f', '/tmp/template-persistence.dump']);
  command('docker', ['cp', `${container}:/tmp/template-persistence.dump`, resolve(scratch, 'database.dump')]);
  await chmod(resolve(scratch, 'database.dump'), 0o600);
  console.log('PASS: A/B/C snapshots, distinct draft/publication, offers, credentials and scoped API key prepared');
} else if (phase === 'verify' || phase === 'restore') {
  const before = JSON.parse(await readFile(resolve(scratch, 'before.json'), 'utf8'));
  if (phase === 'restore') {
    sql(`DO $$ DECLARE t text; BEGIN SELECT string_agg(format('public.%I',tablename),',') INTO t FROM pg_tables WHERE schemaname='public'; EXECUTE 'TRUNCATE '||t||' RESTART IDENTITY CASCADE'; END $$;`);
    command('docker', ['cp', resolve(scratch, 'database.dump'), `${container}:/tmp/template-persistence.dump`]);
    command('docker', ['exec', '-e', 'PGPASSWORD=postgres', container, 'pg_restore', '-U', 'supabase_admin', '-d', 'postgres', '--data-only', '--disable-triggers', '--exit-on-error', '/tmp/template-persistence.dump']);
  }
  assert.deepEqual(await snapshot(), before.tables);
  const credentials = await checked(db.from('template_credentials').select('*'));
  for (const row of credentials.filter(r => r.encrypted_key)) assert.equal(hash(await decryptSecret(row)), before.plaintext[row.template_id]);
  console.log(JSON.stringify({ phase, retained: before.tables, decryptedCredentials: Object.keys(before.plaintext) }, null, 2));
} else if (phase === 'rights') {
  const origin = new URL(process.env.TEMPLATE_TEST_ORIGIN ?? '');
  assert(['localhost', '127.0.0.1'].includes(origin.hostname), 'Local replacement app required');
  const apiKey = await readFile(resolve(scratch, 'api.key'), 'utf8');
  const current = await checked(db.from('storefront_config').select('revision').single());
  const history = await checked(db.from('storefront_config_history').select('revision,published').order('revision'));
  const before = await snapshot();
  for (const templateId of ['storefront-a', 'storefront-b', 'storefront-c']) {
    const target = history.find(row => row.published?.templateId === templateId);
    assert(target, 'Historical premium publication required');
    const response = await fetch(new URL('/api/v1/templates/rollback', origin), { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: current.revision, targetRevision: target.revision }) });
    assert.equal(response.status, 403, `${templateId}: current rights required after restore`);
  }
  const after = await snapshot();
  for (const table of ['storefront_config', 'storefront_config_history', 'product_offer_config', 'product_offer_history', 'products']) assert.deepEqual(after[table], before[table]);
  console.log('PASS: restored API key authenticates; current rights deny all three premium rollbacks without changing presentation or product data');
} else if (phase === 'cleanup') {
  await rm(scratch, { recursive: true, force: true });
  command('docker', ['exec', container, 'rm', '-f', '/tmp/template-persistence.dump']);
} else throw Error('Use prepare, verify, restore, rights or cleanup');
