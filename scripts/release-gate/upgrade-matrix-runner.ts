/** Isolated deployment upgrade checks. @see tests/upgrade-matrix/README.md */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { chromium } from '@playwright/test';

const adminDir = process.env.RC_GATE_ROOT + '/admin-panel';
const root = resolve(adminDir, '..');
const scratch = await mkdtemp(resolve(tmpdir(), 'sellf-upgrade-matrix-'));
const suppliedStack = process.argv.find(arg => arg.startsWith('--stack='))?.slice(8);
const stack = suppliedStack ?? resolve(scratch, 'stack');
const project = 'sellf-rcgate';
const oldImage = 'sellf-rcgate-matrix:current';
const newImage = 'sellf-rcgate-matrix:next';
const container = 'sellf-rcgate-matrix-app';
const pm2Container = 'sellf-rcgate-matrix-pm2';
const nextVersion = '2099.1.0';
let assertions = 0;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const fixture = createServer((_request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ tag_name: `v${nextVersion}`, body: 'Local upgrade matrix fixture', html_url: `https://github.com/jurczykpawel/sellf/releases/tag/v${nextVersion}` }));
});

function check(value: unknown, message: string): void {
  assert(value, message); assertions++; console.log(`PASS ${message}`);
}
async function run(command: string, args: string[], cwd = root, extraEnv: Record<string, string> = {}): Promise<string> {
  const log = resolve(scratch, `command-${randomUUID()}.log`);
  console.log(`STEP ${command} ${args[0] ?? ''}`);
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', async code => {
      const safeOutput = output.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted]').replace(/sb_(?:secret|publishable)_[\w-]+/g, '[redacted]');
      await writeFile(log, safeOutput, { mode: 0o600 });
      if (code !== 0) reject(new Error(`${command} failed (${code}); private log: ${log}`));
      else accept(stdout);
    });
  });
}
async function waitForApp(port: number): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) return; } catch { /* booting */ }
    await new Promise(accept => setTimeout(accept, 500));
  }
  throw new Error(`App did not start on ${port}`);
}

try {
  if (!suppliedStack) {
    await mkdir(stack);
    await cp(resolve(root, 'supabase'), resolve(stack, 'supabase'), { recursive: true, filter: source => !source.includes('/.temp') });
    const config = resolve(stack, 'supabase/config.toml');
    let text = (await readFile(config, 'utf8')).replace('project_id = "sellf"', `project_id = "${project}"`);
    text = text.replace(/5432[0-9]/g, port => String(Number(port) + 1000));
    await writeFile(config, text);
    console.log('Starting isolated Supabase on 55321/55322');
    await run('supabase', ['start', '--workdir', stack]);
  }
  const config = await readFile(resolve(stack, 'supabase/config.toml'), 'utf8');
  assert(config.includes(`project_id = "${project}"`) && config.includes('port = 55321') && config.includes('port = 55322'), 'Refusing a non-matrix stack');
  const status = JSON.parse(await run('supabase', ['status', '--workdir', stack, '-o', 'json']));
  assert(status.API_URL === 'http://127.0.0.1:55321', 'Refusing a non-matrix API');
  const db = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  let identityUserId = '';
  const password = process.env.RC_GATE_MATRIX_ADMIN_PASSWORD!;
  const email = `matrix-${randomUUID()}@example.com`;
  const apiKey = process.env.RC_GATE_MATRIX_API_KEY!;
  async function createIdentity(): Promise<void> {
    const deadline = Date.now() + 90_000;
    while (true) {
      const authHealth = await fetch(`${status.API_URL}/auth/v1/health`, { headers: { apikey: status.ANON_KEY }, signal: AbortSignal.timeout(1500) }).catch(() => null);
      const { error } = await db.from('admin_users').select('id').limit(1).abortSignal(AbortSignal.timeout(1500));
      if (authHealth?.ok && !error) break;
      assert(Date.now() < deadline, 'Supabase Auth and REST must be ready before creating fixtures');
      await new Promise(accept => setTimeout(accept, 500));
    }
    const userResult = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (userResult.error || !userResult.data.user) throw new Error(`Could not create matrix admin (${userResult.error?.status ?? 'unknown'})`);
    identityUserId = userResult.data.user.id;
    const adminResult = await db.from('admin_users').upsert({ user_id: userResult.data.user.id }, { onConflict: 'user_id' }).select('id').single();
    if (adminResult.error) throw new Error('Could not assign matrix admin');
    const keyResult = await db.from('api_keys').insert({ name: 'upgrade matrix', key_prefix: apiKey.slice(0, 12), key_hash: createHash('sha256').update(apiKey).digest('hex'), admin_user_id: adminResult.data.id, scopes: ['system:read', 'system:write', 'templates:read', 'templates:write', 'templates:activate'] });
    if (keyResult.error) throw new Error('Could not create matrix API key');
  }
  await createIdentity();
  const headers = { Authorization: `Bearer ${apiKey}` };
  const fixtureConfig = { format: 1, templateId: 'default', settingsByTemplate: { default: {}, d: { density: 'compact' } }, overridesByTemplate: { default: { sections: { catalogue: { variant: 'default-groups' } } } }, content: { 'home.hero': { sourceLocale: 'en', en: { kind: 'hero', eyebrow: 'Release acceptance', heading: 'Retained release content', body: 'Seller copy survives replacement', steps: [] }, pl: { kind: 'hero', eyebrow: 'Release acceptance', heading: 'Zachowana treść wydania', body: 'Treść sprzedawcy pozostaje', steps: [] } } }, tokens: null };
  const current = await db.from('storefront_config').select('revision').single(); assert(!current.error);
  const saved = await db.rpc('mutate_storefront_config', { expected_revision: current.data!.revision, operation: 'draft', validated_config: fixtureConfig, actor_user_id: identityUserId, actor_method: 'session' });
  assert(!saved.error && saved.data.success, 'Create retained draft');
  const published = await db.rpc('mutate_storefront_config', { expected_revision: saved.data.revision, operation: 'publish', validated_config: null, actor_user_id: identityUserId, actor_method: 'session' });
  assert(!published.error && published.data.success, 'Create retained publication');
  const draft = await db.rpc('mutate_storefront_config', { expected_revision: published.data.revision, operation: 'draft', validated_config: { ...fixtureConfig, settingsByTemplate: { ...fixtureConfig.settingsByTemplate, d: { density: 'comfortable' } } }, actor_user_id: identityUserId, actor_method: 'session' });
  assert(!draft.error && draft.data.success, 'Create separate retained draft');
  const product = await db.from('products').insert({ name: 'Release persistence fixture', slug: `release-persistence-${randomUUID()}`, price: 10, currency: 'PLN', is_active: true, is_listed: true, vat_exempt: true, content_delivery_type: 'content', content_config: { content_items: [{ id: 'lesson', title: 'Retained lesson', type: 'download_link', config: { download_url: 'https://example.supabase.co/storage/v1/object/public/files/private-release.pdf', file_name: 'release.pdf' }, order: 0, is_active: true }] }, marketing_fields: { format: 'workshop', sourceLocale: 'en', en: { result: 'Retained product result', tools: ['Bun'], requirements: ['Browser'] } } }).select('id').single();
  assert(!product.error, 'Create retained product content');
  async function templateSnapshot() {
    const config = await db.from('storefront_config').select('*').single();
    const history = await db.from('storefront_config_history').select('*').order('revision');
    const content = await db.from('products').select('*').eq('id', product.data!.id).single();
    assert(!config.error && !history.error && !content.error);
    return { config: config.data, history: history.data, content: content.data };
  }
  const retainedSnapshot = await templateSnapshot();
  await writeFile(resolve(scratch, 'templates-before.json'), JSON.stringify(retainedSnapshot, null, 2));

  await new Promise<void>((accept, reject) => { fixture.once('error', reject); fixture.listen(55330, '0.0.0.0', accept); });
  const env: Record<string, string> = {
    NODE_ENV: 'production', SITE_URL: 'http://localhost:55331',
    SUPABASE_URL: 'http://host.docker.internal:55321', PUBLIC_SUPABASE_URL: status.API_URL,
    SUPABASE_ANON_KEY: status.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    CHECKOUT_BINDING_SECRET: process.env.CHECKOUT_BINDING_SECRET!, APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY!, LOGINWALL_SECRET: process.env.LOGINWALL_SECRET!,
    SELLF_TELEMETRY_ENABLED: 'false', SELLF_UPDATE_CHECK_URL: 'http://host.docker.internal:55330/latest',
    TRUSTED_PROXY: 'true', SELLF_PORT: '55331', SELLF_BIND: '127.0.0.1',
  };
  const envFile = resolve(scratch, '.env');
  await writeFile(envFile, Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
  console.log('Running runtime, route, UI and script unit checks');
  const vitestReport = process.env.RC_GATE_VITEST_REPORT;
  const reporterArgs = vitestReport ? ['--reporter=json', `--outputFile=${vitestReport}`] : [];
  await run('bun', ['x', 'vitest', 'run', ...reporterArgs, 'tests/unit/lib/system', 'tests/unit/routes/upgrade.test.ts', 'tests/unit/routes/update-check-started-at.test.ts', 'tests/unit/hooks/use-update-check.test.ts', 'tests/unit/scripts/upgrade-migration-reporting.test.ts', 'tests/unit/scripts/upgrade-pm2.test.ts', 'tests/unit/scripts/upgrade-working-directory.test.ts'], adminDir);
  Object.assign(process.env, env);
  delete process.env.SELLF_DEPLOYMENT_RUNTIME;
  console.log('Building the current production Dockerfile');
  await run('docker', ['build', '-t', oldImage, '.']);
  await run('docker', ['run', '-d', '--name', container, '--add-host=host.docker.internal:host-gateway', '-p', '127.0.0.1:55331:3000', '--env-file', envFile, oldImage]);
  await waitForApp(55331);
  async function readApi(path: string) {
    const response = await fetch(`http://localhost:55331/api/v1/system/${path}`, { headers });
    assert.equal(response.status, 200, `authenticated ${path}`);
    return (await response.json()).data;
  }
  async function verifyRuntime(runtime: string) {
    const system = await readApi('status');
    check(system.upgrade.runtime === runtime && system.upgrade.mode === 'manual', `${runtime}: status uses manual deployment mode`);
    const update = await readApi('update-check?force=true');
    check(update.upgrade.runtime === runtime && update.update_available && update.latest_version === nextVersion, `${runtime}: new release remains visible`);
    const declined = await fetch('http://localhost:55331/api/v1/system/upgrade', { method: 'POST', headers });
    check(declined.status === 409 && (await declined.json()).error.code === 'MANUAL_UPGRADE_REQUIRED', `${runtime}: upgrade POST declines before launch`);
    return update;
  }
  const initial = await verifyRuntime('docker');
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const cookies: { name: string; value: string }[] = [];
  const sessionClient = createServerClient(status.API_URL, status.ANON_KEY, {
    auth: { storageKey: 'sb-host-auth-token' },
    cookies: { getAll: () => [], setAll: values => { cookies.push(...values); } },
  });
  const login = await sessionClient.auth.signInWithPassword({ email, password });
  assert(!login.error, 'Matrix login');
  await context.addCookies([...cookies, ...cookies.map(cookie => ({ ...cookie, name: cookie.name.replace('sb-host-', 'sb-127-') }))].map(cookie => ({ name: cookie.name, value: cookie.value, domain: 'localhost', path: '/', httpOnly: false, secure: false, sameSite: 'Lax' })));
  const page = await context.newPage();
  await page.goto('http://localhost:55331/en/dashboard');
  try { await page.getByTestId('upgrade-instructions').waitFor(); } catch (error) {
    await page.screenshot({ path: resolve(scratch, 'docker-ui-failure.png') });
    console.log(`Dashboard state: ${page.url()}; screenshot: ${scratch}/docker-ui-failure.png`);
    throw error;
  }
  await page.getByText(/Containers and managed hosting do not apply migrations on startup/).waitFor();
  check(await page.getByTestId('upgrade-instructions').count() > 0, 'Docker: real dashboard renders deployment instructions');
  check(await page.getByRole('button', { name: /Upgrade now|Aktualizuj teraz/i }).count() === 0, 'Docker: dashboard has no in-place action');
  await page.screenshot({ path: resolve(scratch, 'docker-ui.png') });
  await browser.close();
  browser = undefined;

  const replacement = resolve(scratch, 'replacement'); await mkdir(replacement);
  await run('docker', ['cp', `${container}:/app/.`, replacement]);
  await run('docker', ['stop', container]);
  await run('docker', ['cp', `${replacement}/.`, `${container}:/app`]);
  await run('docker', ['start', container]);
  await run('docker', ['exec', '--user', '0', container, 'chown', '-R', '1001:1001', '/app']);
  await waitForApp(55331);
  assert.deepEqual(await templateSnapshot(), retainedSnapshot);
  check(true, 'Templates: complete installed-file replacement preserves config, separate draft, history and product content');
  await rm(replacement, { recursive: true });
  await run('docker', ['restart', container]);
  await waitForApp(55331);
  assert.deepEqual(await templateSnapshot(), retainedSnapshot);
  check(true, 'Templates: image restart preserves exact config, history and content');
  check((await readApi('update-check?force=true')).current_version === initial.current_version, 'Docker: restart preserves image version');
  await run('docker', ['rm', '-f', container]);

  const composeFile = resolve(scratch, 'docker-compose.yml');
  await cp(resolve(root, 'docker-compose.yml'), composeFile);
  const override = resolve(scratch, 'matrix-compose.yml');
  await writeFile(override, `services:\n  sellf:\n    extra_hosts: ["host.docker.internal:host-gateway"]\n    image: \${MATRIX_IMAGE}\nnetworks:\n  default:\n    name: sellf-rcgate-matrix-network\n`);
  const compose = ['compose', '--project-name', project, '--env-file', envFile, '-f', composeFile, '-f', override];
  process.env.MATRIX_IMAGE = oldImage;
  await run('docker', [...compose, 'up', '-d']);
  await waitForApp(55331);
  await verifyRuntime('compose');
  await run('docker', [...compose, 'down']);
  process.env.SELLF_DEPLOYMENT_RUNTIME = 'coolify';
  await writeFile(envFile, Object.entries({ ...env, SELLF_DEPLOYMENT_RUNTIME: 'coolify' }).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
  await run('docker', [...compose, 'up', '-d']);
  await waitForApp(55331);
  await verifyRuntime('coolify');
  await run('docker', [...compose, 'down']);
  delete process.env.SELLF_DEPLOYMENT_RUNTIME;
  await writeFile(envFile, Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });

  console.log('Building a local next-version image from a disposable source copy');
  const sourceCopy = resolve(scratch, 'source');
  await cp(root, sourceCopy, { recursive: true, filter: source => !/(?:^|\/)(?:node_modules|\.next|\.git|priv|brag-output|test-results|test-runs|playwright-report)(?:\/|$)/.test(source) && !/\/\.env[^/]*$/.test(source) });
  const packagePath = resolve(sourceCopy, 'admin-panel/package.json');
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  pkg.version = nextVersion;
  await writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n');

  const registryFile = resolve(sourceCopy, 'admin-panel/src/lib/storefront-templates/registry.ts');
  const registryBefore = await readFile(registryFile, 'utf8');
  assert(registryBefore.includes("variant: 'default-groups', source: 'listed-products'"));
  await writeFile(registryFile, registryBefore.replace("variant: 'default-groups', source: 'listed-products'", "variant: 'detail-cards', source: 'listed-products'"));
  const migrationName = '20990101000000_upgrade_matrix_probe.sql';
  await writeFile(resolve(sourceCopy, 'supabase/migrations', migrationName), 'CREATE TABLE public.upgrade_matrix_probe (id integer PRIMARY KEY, label text NOT NULL);\nALTER TABLE public.upgrade_matrix_probe ENABLE ROW LEVEL SECURITY;\nCREATE POLICY probe_service ON public.upgrade_matrix_probe TO service_role USING (true) WITH CHECK (true);\nREVOKE ALL ON public.upgrade_matrix_probe FROM anon, authenticated;\nGRANT ALL ON public.upgrade_matrix_probe TO service_role;\nINSERT INTO public.upgrade_matrix_probe VALUES (1, \'retained\');\n');
  await run('docker', ['build', '-t', newImage, sourceCopy]);
  const imageMigration = await run('docker', ['run', '--rm', '--entrypoint', 'cat', newImage, `/app/supabase/migrations/${migrationName}`]);
  check(imageMigration.includes('upgrade_matrix_probe'), 'Compose: new image includes the release migration');
  await cp(resolve(sourceCopy, 'supabase/migrations', migrationName), resolve(stack, 'supabase/migrations', migrationName));
  await run('supabase', ['db', 'push', '--local', '--yes', '--workdir', stack]);
  const sql = async (query: string) => (await run('docker', ['exec', `supabase_db_${project}`, 'psql', '-U', 'postgres', '-Atc', query])).trim();
  check(await sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20990101000000'") === '1', 'Compose: external CLI records the new migration');
  process.env.MATRIX_IMAGE = newImage;
  await run('docker', [...compose, 'up', '-d', '--force-recreate']);
  await waitForApp(55331);
  check((await readApi('update-check?force=true')).current_version === nextVersion, 'Compose: recreate installs the new version');
  await run('docker', [...compose, 'restart', 'sellf']);
  await waitForApp(55331);
  check((await readApi('update-check?force=true')).current_version === nextVersion, 'Compose: new version survives restart');
  check(await sql('SELECT label FROM public.upgrade_matrix_probe WHERE id=1') === 'retained', 'Compose: migration data survives container recreation and restart');
  await run('docker', [...compose, 'down']);


  // The next image has a compatible changed default, while seller overrides remain in DB.
  process.env.MATRIX_IMAGE = newImage;
  await run('docker', [...compose, 'up', '-d']); await waitForApp(55331);
  assert.deepEqual(await templateSnapshot(), retainedSnapshot);
  check(true, 'Templates: replacement image preserves config, history, seller overrides and product content');
  const templateBrowser = await chromium.launch({ headless: true });
  try {
    const templatePage = await templateBrowser.newPage();
    await templatePage.goto('http://localhost:55331/store');
    assert.match(await templatePage.locator('#catalogue').getAttribute('class') ?? '', /defaultGroups/);
    assert.equal(await templatePage.locator('#catalogue').getAttribute('data-density'), 'comfortable');
    check(true, 'Templates: compatible new default keeps seller variant override');
    const resetResponse = await fetch('http://localhost:55331/api/v1/templates/reset', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: draft.data.revision, templateId: 'default', field: 'overrides.sections.catalogue.variant' }) });
    assert.equal(resetResponse.status, 200); const reset = await resetResponse.json();
    const publishResponse = await fetch('http://localhost:55331/api/v1/templates/publish', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: reset.revision }) });
    assert.equal(publishResponse.status, 200);
    await templatePage.reload();
    assert.doesNotMatch(await templatePage.locator('#catalogue').getAttribute('class') ?? '', /defaultGroups/);
    const after = await templateSnapshot();
    assert.deepEqual(after.config.published.content, retainedSnapshot.config.published.content);
    assert.deepEqual(after.content, retainedSnapshot.content);
    assert.deepEqual(after.history.slice(0, retainedSnapshot.history.length), retainedSnapshot.history);
    check(true, 'Templates: live reset follows new image default and retains content and prior history');
    await writeFile(resolve(scratch, 'templates-after.json'), JSON.stringify(after, null, 2));
  } finally { await templateBrowser.close(); await run('docker', [...compose, 'down']); }
  console.log('Running complete installed upgrade script with real PM2');
  const assetsDir = resolve(scratch, 'assets');
  await mkdir(assetsDir);
  const lookupToken = process.env.RC_GATE_GITHUB_TOKEN;
  const releaseResponse = await fetch('https://api.github.com/repos/jurczykpawel/sellf/releases/tags/v2026.11.0', { headers: lookupToken ? { Authorization: `Bearer ${lookupToken}` } : {}, signal: AbortSignal.timeout(15_000) });
  assert(releaseResponse.ok, `Published release metadata (HTTP ${releaseResponse.status})`);
  const release = await releaseResponse.json() as { tag_name: string; assets: { name: string; browser_download_url: string }[] };
  await writeFile(resolve(assetsDir, 'release.json'), JSON.stringify(release));
  for (const name of ['sellf-build.tar.gz', 'sellf-build.v2.manifest', 'sellf-build.v2.manifest.sig']) {
    const asset = release.assets.find(item => item.name === name);
    assert(asset, `Missing ${name}`);
    await run('curl', ['-fSL', '--max-time', '180', '-o', resolve(assetsDir, name), asset.browser_download_url]);
  }
  await run('bash', ['admin-panel/scripts/ci/sign-manifest.sh', 'verify', resolve(assetsDir, 'sellf-build.v2.manifest'), resolve(assetsDir, 'sellf-build.v2.manifest.sig')]);
  const manifest = await readFile(resolve(assetsDir, 'sellf-build.v2.manifest'), 'utf8');
  assert(manifest.includes(`version=${release.tag_name.replace(/^v/, '')}\n`), 'Published manifest version');
  assert(manifest.includes(`sha256=${createHash('sha256').update(await readFile(resolve(assetsDir, 'sellf-build.tar.gz'))).digest('hex')}\n`), 'Published archive checksum');
  const archivedFiles = (await run('tar', ['-tzf', resolve(assetsDir, 'sellf-build.tar.gz')])).split('\n');
  const releaseMigrations = archivedFiles.filter(file => /^(?:\.\/)?supabase\/migrations\/[0-9]{14}_[a-z0-9_]+\.sql$/.test(file)).sort();
  const releaseMigration = releaseMigrations.at(-1);
  assert(releaseMigration, 'Signed release migration fixture');
  const migrationTimestamp = releaseMigration.split('/').at(-1)!.slice(0, 14);
  // Build the actual pre-release schema; a deleted history row does not undo DDL.
  const migrationsDir = resolve(stack, 'supabase/migrations');
  const savedMigrations = resolve(scratch, 'migrations-after-compose');
  const configPath = resolve(stack, 'supabase/config.toml');
  const baselineDir = resolve(assetsDir, 'baseline');
  await mkdir(baselineDir);
  await run('tar', ['-xzf', resolve(assetsDir, 'sellf-build.tar.gz'), '-C', baselineDir, ...releaseMigrations.slice(0, -1)]);
  await cp(migrationsDir, savedMigrations, { recursive: true });
  try {
    await rm(migrationsDir, { recursive: true });
    await cp(resolve(baselineDir, 'supabase/migrations'), migrationsDir, { recursive: true });
    await writeFile(configPath, `${config}\n[db.seed]\nenabled = false\n`);
    await run('python3', ['-B', resolve(root, 'supabase/tests/local_stack.py'), 'reset', stack], root, { SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_URL: status.API_URL });
    await run('python3', ['-B', resolve(root, 'supabase/tests/local_stack.py'), 'ready', stack], root, { SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_URL: status.API_URL });
  } finally {
    await writeFile(configPath, config);
    await rm(migrationsDir, { recursive: true, force: true });
    await cp(savedMigrations, migrationsDir, { recursive: true });
    await rm(savedMigrations, { recursive: true, force: true });
  }
  check(await sql(`SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '${migrationTimestamp}'`) === '0', 'PM2: baseline precedes the signed release migration');
  await createIdentity();
  await cp(resolve(adminDir, 'scripts/upgrade.sh'), resolve(assetsDir, 'upgrade.sh'));
  await writeFile(resolve(assetsDir, '.env.local'), Object.entries({ ...env, MATRIX_API_KEY: apiKey, PORT: '3000', HOSTNAME: '0.0.0.0' }).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
  await cp(resolve(adminDir, 'tests/upgrade-matrix/pm2-run.sh'), resolve(assetsDir, 'pm2-run.sh'));
  await run('docker', ['build', '-f', 'admin-panel/tests/upgrade-matrix/pm2.Dockerfile', '-t', 'sellf-rcgate-matrix:pm2', '.']);
  const pm2Result = await run('docker', ['run', '--name', pm2Container, '--add-host=host.docker.internal:host-gateway', '-v', `${assetsDir}:/fixtures:ro`, '-p', '127.0.0.1:55332:3000', 'sellf-rcgate-matrix:pm2', 'bash', '/fixtures/pm2-run.sh']);
  check(await sql(`SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '${migrationTimestamp}'`) === '1', 'PM2: release migration is applied through the real RPC');
  check(pm2Result.includes('MATRIX_PM2_DONE'), 'PM2: signed archive, migration check, process restart, live version and saved configuration');
  console.log(`Upgrade matrix: ${assertions} checks passed. Evidence: ${scratch}`);
} finally {
  await browser?.close();
  fixture.close();
  await run('docker', ['rm', '-f', container, pm2Container]).catch(() => {});
  await run('docker', ['compose', '--project-name', project, '-f', resolve(scratch, 'docker-compose.yml'), '-f', resolve(scratch, 'matrix-compose.yml'), '--env-file', resolve(scratch, '.env'), 'down']).catch(() => {});
  if (!suppliedStack) await run('supabase', ['stop', '--workdir', stack, '--no-backup']).catch(() => {});
  // Keep only review evidence, remove credentials and source copies.
  await rm(resolve(scratch, '.env'), { force: true });
  await rm(resolve(scratch, 'assets'), { force: true, recursive: true });
  await rm(resolve(scratch, 'source'), { force: true, recursive: true });
}
