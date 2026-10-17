/** Isolated deployment upgrade checks. @see tests/upgrade-matrix/README.md */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { chromium } from '@playwright/test';

const adminDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(adminDir, '..');
const scratch = await mkdtemp(resolve(tmpdir(), 'sellf-upgrade-matrix-'));
const sshTarget = process.argv.find(arg => arg.startsWith('--ssh='))?.slice(6);
if (sshTarget) assert(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(sshTarget), 'Invalid test host alias');
const suppliedStack = process.argv.find(arg => arg.startsWith('--stack='))?.slice(8);
const stack = suppliedStack ?? resolve(scratch, 'stack');
const project = 'sellf-upgrade-matrix';
const oldImage = 'sellf-upgrade-matrix:current';
const newImage = 'sellf-upgrade-matrix:next';
const container = 'sellf-upgrade-matrix-app';
const pm2Container = 'sellf-upgrade-matrix-pm2';
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
async function run(command: string, args: string[], cwd = root): Promise<string> {
  const log = resolve(scratch, `command-${randomUUID()}.log`);
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const password = randomBytes(24).toString('hex');
  const email = `matrix-${randomUUID()}@example.com`;
  const apiKey = `sf_live_${randomBytes(32).toString('hex')}`;
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
    const adminResult = await db.from('admin_users').upsert({ user_id: userResult.data.user.id }, { onConflict: 'user_id' }).select('id').single();
    if (adminResult.error) throw new Error('Could not assign matrix admin');
    const keyResult = await db.from('api_keys').insert({ name: 'upgrade matrix', key_prefix: apiKey.slice(0, 12), key_hash: createHash('sha256').update(apiKey).digest('hex'), admin_user_id: adminResult.data.id, scopes: ['system:read', 'system:write'] });
    if (keyResult.error) throw new Error('Could not create matrix API key');
  }
  await createIdentity();
  const headers = { Authorization: `Bearer ${apiKey}` };
  await new Promise<void>(accept => fixture.listen(55330, '0.0.0.0', accept));
  const env: Record<string, string> = {
    NODE_ENV: 'production', SITE_URL: 'http://localhost:55331',
    SUPABASE_URL: 'http://host.docker.internal:55321', PUBLIC_SUPABASE_URL: status.API_URL,
    SUPABASE_ANON_KEY: status.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    CHECKOUT_BINDING_SECRET: randomBytes(32).toString('hex'), APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'), LOGINWALL_SECRET: randomBytes(32).toString('hex'),
    SELLF_TELEMETRY_ENABLED: 'false', SELLF_UPDATE_CHECK_URL: 'http://host.docker.internal:55330/latest',
    TRUSTED_PROXY: 'true', SELLF_PORT: '55331', SELLF_BIND: '127.0.0.1',
  };
  const envFile = resolve(scratch, '.env');
  await writeFile(envFile, Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
  console.log('Running runtime, route, UI and script unit checks');
  await run('bun', ['x', 'vitest', 'run', 'tests/unit/lib/system', 'tests/unit/routes/upgrade.test.ts', 'tests/unit/routes/update-check-started-at.test.ts', 'tests/unit/hooks/use-update-check.test.ts', 'tests/unit/scripts/upgrade-migration-reporting.test.ts', 'tests/unit/scripts/upgrade-pm2.test.ts', 'tests/unit/scripts/upgrade-working-directory.test.ts'], adminDir);
  Object.assign(process.env, env);
  delete process.env.SELLF_DEPLOYMENT_RUNTIME;
  console.log('Building the current production Dockerfile');
  await run('docker', ['build', '-t', oldImage, '.']);
  await run('docker', ['run', '-d', '--name', container, '-p', '127.0.0.1:55331:3000', '--env-file', envFile, oldImage]);
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
  await run('docker', ['restart', container]);
  await waitForApp(55331);
  check((await readApi('update-check?force=true')).current_version === initial.current_version, 'Docker: restart preserves image version');
  await run('docker', ['rm', '-f', container]);

  const composeFile = resolve(scratch, 'docker-compose.yml');
  await cp(resolve(root, 'docker-compose.yml'), composeFile);
  const override = resolve(scratch, 'matrix-compose.yml');
  await writeFile(override, `services:\n  sellf:\n    image: \${MATRIX_IMAGE}\nnetworks:\n  default:\n    name: sellf-upgrade-matrix-network\n`);
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
  await cp(root, sourceCopy, { recursive: true, filter: source => !/(?:^|\/)(?:node_modules|\.next|\.git|priv|brag-output|test-results|playwright-report)(?:\/|$)/.test(source) && !/\/\.env[^/]*$/.test(source) });
  const packagePath = resolve(sourceCopy, 'admin-panel/package.json');
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  pkg.version = nextVersion;
  await writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n');
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

  console.log('Running complete installed upgrade script with real PM2');
  const assetsDir = resolve(scratch, 'assets');
  await mkdir(assetsDir);
  const releaseResponse = await fetch('https://api.github.com/repos/jurczykpawel/sellf/releases/latest', { signal: AbortSignal.timeout(15_000) });
  assert(releaseResponse.ok, 'Published release metadata');
  const release = await releaseResponse.json() as { tag_name: string; assets: { name: string; browser_download_url: string }[] };
  await writeFile(resolve(assetsDir, 'release.json'), JSON.stringify(release));
  for (const name of ['sellf-build.tar.gz', 'sellf-build.manifest', 'sellf-build.manifest.sig']) {
    const asset = release.assets.find(item => item.name === name);
    assert(asset, `Missing ${name}`);
    await run('curl', ['-fSL', '--max-time', '180', '-o', resolve(assetsDir, name), asset.browser_download_url]);
  }
  await run('bash', ['admin-panel/scripts/ci/sign-manifest.sh', 'verify', resolve(assetsDir, 'sellf-build.manifest'), resolve(assetsDir, 'sellf-build.manifest.sig')]);
  const manifest = await readFile(resolve(assetsDir, 'sellf-build.manifest'), 'utf8');
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
    await run('supabase', ['db', 'reset', '--workdir', stack]);
    await run('docker', ['restart', `supabase_kong_${project}`]);
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
  await run('docker', ['build', '-f', 'admin-panel/tests/upgrade-matrix/pm2.Dockerfile', '-t', 'sellf-upgrade-matrix:pm2', '.']);
  const pm2Result = await run('docker', ['run', '--name', pm2Container, '--add-host=host.docker.internal:host-gateway', '-v', `${assetsDir}:/fixtures:ro`, '-p', '127.0.0.1:55332:3000', 'sellf-upgrade-matrix:pm2', 'bash', '/fixtures/pm2-run.sh']);
  check(await sql(`SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '${migrationTimestamp}'`) === '1', 'PM2: release migration is applied through the real RPC');
  check(pm2Result.includes('MATRIX_PM2_DONE'), 'PM2: signed archive, migration check, process restart, live version and saved configuration');
  if (sshTarget) {
    console.log('Checking the native PM2/systemd launcher on the designated test host');
    const probe = resolve(scratch, 'sellf-upgrade-capability.mjs');
    await run('bun', ['build', 'src/lib/system/upgrade-runtime-server.ts', '--target=node', '--format=esm', `--outfile=${probe}`], adminDir);
    await run('ssh', ['-o', 'BatchMode=yes', sshTarget, 'test ! -e /tmp/sellf-ui-upgrade-matrix && test ! -e /tmp/sellf-upgrade-capability.mjs && test ! -e /tmp/native-launcher.sh']);
    try {
      await run('scp', ['-q', probe, resolve(adminDir, 'tests/upgrade-matrix/native-launcher.sh'), `${sshTarget}:/tmp/`]);
      const nativeResult = await run('ssh', ['-o', 'BatchMode=yes', sshTarget, 'bash /tmp/native-launcher.sh']);
      check(nativeResult.includes('PASS native PM2'), 'Native host: actual PM2 preflight and systemd transient restart');
    } finally {
      await run('ssh', ['-o', 'BatchMode=yes', sshTarget, 'rm -f /tmp/native-launcher.sh /tmp/sellf-upgrade-capability.mjs']);
    }
  }
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
