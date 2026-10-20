/** Production storefront acceptance. See scripts/storefront-perf.md. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { generateKeyPairSync, createSign, randomBytes } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { cpus, loadavg, totalmem } from 'node:os';
import { createConnection } from 'node:net';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import { parse } from 'dotenv';
import { normalizeLicenseDomain } from '@/lib/license-keys/domain';
import { PRODUCT_PUBLIC_COLUMNS_CSV } from '@/lib/product-columns';
import { SHOP_CONFIG_PUBLIC_COLUMNS_CSV } from '@/lib/shop-config-columns';

const admin = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(admin, '..');
const stack = '/private/tmp/sellf-perf';
const container = 'supabase_db_sellf-perf';
const origin = 'http://sellf-perf.localhost:55325';
const out = resolve(process.argv[2] ?? '/private/tmp/storefront-perf-results');
const bun = process.env.PERF_BUN ?? 'bun';
const freeProbe = process.argv.includes('--probe-free');
const dProbe = process.argv.includes('--probe-d');
const cacheProbe = process.argv.includes('--probe-cache');
const emptyProbe = process.argv.includes('--probe-empty');
const cacheCases = process.argv.includes('--cache-cases') || cacheProbe || emptyProbe;
const probe = process.argv.includes('--probe-checkout') || freeProbe || dProbe || cacheProbe || emptyProbe;
const runs = 5;
const samples = [];
const checks = [];
const sleep = ms => delay(ms);
let app;
let browser;
let appOutput = () => '';
let cacheFaultInjected = false;
function standalonePath() {
  const base = resolve(admin, '.next/standalone');
  return existsSync(resolve(base, 'server.js')) ? base : resolve(base, 'admin-panel');
}
const command = (name, args, options = {}) => execFileSync(name, args, { cwd: admin, encoding: 'utf8', ...options });
const sql = text => command('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-XAt', '-v', 'ON_ERROR_STOP=1'], { input: text, maxBuffer: 32 * 1024 * 1024 });
const adminSql = text => command('docker', ['exec', '-e', 'PGPASSWORD=postgres', '-i', container, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-XAt', '-v', 'ON_ERROR_STOP=1'], { input: text });
async function run(name, args, env, log) {
  const child = spawn(name, args, { cwd: admin, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise(accept => child.on('close', accept));
  const output = stdout + '\n' + stderr;
  await writeFile(resolve(out, log), output);
  assert.equal(code, 0, `${name}: see ${log}`);
  return output;
}
async function idle(label) {
  while (loadavg()[0] >= 8) { console.log(`Waiting for idle: ${loadavg()[0].toFixed(2)} (${label})`); await sleep(10_000); }
  const entry = { label, at: new Date().toISOString(), load1: loadavg()[0] };
  checks.push(entry);
  await writeFile(resolve(out, 'load.json'), JSON.stringify(checks, null, 2));
}
function p75(values) { return [...values].sort((a, b) => a - b)[Math.ceil(values.length * .75) - 1]; }
async function stopApp() {
  if (!app) return;
  const child = app; app = undefined;
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(accept => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => { clearTimeout(timer); accept(); });
    child.kill('SIGTERM');
  });
}
async function startApp(env, failedCache = false) {
  await stopApp();
  const standalone = standalonePath();
  await rm(resolve(standalone, '.next/cache'), { recursive: true, force: true });
  if (failedCache) {
    await writeFile(resolve(standalone, '.next/cache'), 'Unavailable persistent cache');
    cacheFaultInjected = true;
  }
  app = spawn('node', ['server.js'], { cwd: standalone, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  appOutput = () => output;
  app.stdout.on('data', chunk => { output += chunk; }); app.stderr.on('data', chunk => { output += chunk; });
  const deadline = Date.now() + 30_000;
  while (true) {
    const ready = await new Promise(accept => {
      const socket = createConnection({ host: 'localhost', port: 55325 });
      const finish = value => { socket.destroy(); accept(value); };
      socket.once('connect', () => finish(true)); socket.once('error', () => finish(false));
      socket.setTimeout(1000, () => finish(false));
    });
    if (ready) break;
    if (app.exitCode !== null || Date.now() > deadline) throw new Error(output);
    await sleep(100);
  }
}
async function queryAcceptance(size, search = 'Performance course') {
  await idle(`queries-${size}`);
  const cases = [
    [{ pageSize: 24 }, null, null, null],
    ...['featured', 'free', 'paid'].map(group => [{ pageSize: 24, group }, null, null, null]),
    [{ pageSize: 24, search }, '2026-01-01 00:00:00.123455+00', `10000000-0000-4000-8000-${String(size * .9).padStart(12, '0')}`, null],
    [{ pageSize: 24, search, categoryIds: ['20000000-0000-4000-8000-000000000001'] }, '2026-01-01 00:00:00.123454+00', `10000000-0000-4000-8000-${String(size * .9).padStart(12, '0')}`, null],
    [{ pageSize: 24, search: 'RareNeedle' }, null, null, null],
    [{ pageSize: 24 }, null, null, ['10000000-0000-4000-8000-000000000001']],
  ];
  const literal = value => value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
  assert.equal(Number(sql(`SELECT count(*) FROM public.products WHERE normalize(name,NFC) ILIKE ${literal('%' + search + '%')};`)), size, 'Load the declared catalogue fixture before profiling');
  const queries = cases.map(([filters, timestamp, id, ids]) => `SELECT count(*) FROM public.storefront_catalogue_page(${literal(JSON.stringify(filters))},${literal(timestamp)},${literal(id)},${ids ? `ARRAY[${ids.map(literal).join(',')}]::uuid[]` : 'NULL'});`).join('\n');
  const hotReads = `SET LOCAL ROLE service_role;
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT published FROM public.storefront_config WHERE id=true;
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM public.storefront_catalogue_categories(ARRAY['20000000-0000-4000-8000-000000000001']::uuid[]);
    RESET ROLE; SET LOCAL ROLE anon;
    SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT ${SHOP_CONFIG_PUBLIC_COLUMNS_CSV} FROM public.shop_config LIMIT 1;
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT ${PRODUCT_PUBLIC_COLUMNS_CSV} FROM public.products WHERE slug='perf-course-1';
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT product_id,price,sale_price,effective_from FROM public.omnibus_price_history WHERE product_id='10000000-0000-4000-8000-000000000001' AND effective_from>=statement_timestamp()-interval '30 days';`;
  const output = await run('docker', ['exec', '-e', 'PGPASSWORD=postgres', '-i', container, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-c',
    `LOAD 'auto_explain'; SET client_min_messages=log; SET auto_explain.log_min_duration=0; SET auto_explain.log_analyze=on; SET auto_explain.log_buffers=on; SET auto_explain.log_nested_statements=on; SET auto_explain.log_format=json; BEGIN; ${queries} SELECT storefront_catalogue_boundary(); ${hotReads} ROLLBACK;`], process.env, `plans-${size}.log`);
  const plans = [...output.matchAll(/plan:\s*(\{[\s\S]*?\n\})/g)].map(match => JSON.parse(match[1]));
  assert.equal(plans.filter(plan => plan['Query Text'].includes('WITH eligible')).length, cases.length, 'Every nested catalogue plan must be captured');
  const scans = [];
  function visit(node) {
    if (node['Relation Name']) scans.push({ relation: node['Relation Name'], type: node['Node Type'], rows: (node['Actual Rows'] + (node['Rows Removed by Filter'] ?? 0) + (node['Rows Removed by Index Recheck'] ?? 0)) * node['Actual Loops'], index: node['Index Name'], condition: node['Index Cond'] });
    for (const child of node.Plans ?? []) visit(child);
  }
  for (const plan of plans) visit(plan.Plan);
  await writeFile(resolve(out, `scans-${size}.json`), JSON.stringify(scans, null, 2));
  // Scanning a tiny relation can be cheaper than 25 independent history seeks.
  assert(size < 100000 || scans.filter(scan => ['products', 'product_price_history', 'product_categories'].includes(scan.relation)).every(scan => scan.rows <= 250), '100k pages must seek bounded product/history/category rows');
}
await mkdir(out, { recursive: true });
try {
  const config = await readFile(resolve(stack, 'supabase/config.toml'), 'utf8');
  assert(config.includes('project_id = "sellf-perf"') && config.includes('port = 55321') && config.includes('port = 55322'));
  const status = JSON.parse(command('supabase', ['status', '--workdir', stack, '-o', 'json']));
  assert.equal(status.API_URL, 'http://127.0.0.1:55321');
  assert.equal(command('docker', ['ps', '--filter', 'publish=55321', '--format', '{{.Names}}']).trim(), 'supabase_kong_sellf-perf');
  if (process.argv.includes('--sql-only')) {
    await queryAcceptance(100000, process.argv.includes('--original-fixture') ? 'Catalogue fixture' : 'Performance course');
  } else {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const domain = normalizeLicenseDomain(origin); assert(domain, 'Profile origin must support a domain-bound license');
  const payload = Buffer.from(JSON.stringify({ v: 1, kid: 'perf', product: 'sellf-pro', email: 'perf@example.invalid', order: 'perf', tier: 'pro', domain, iat: Math.floor(Date.now() / 1000), exp: null })).toString('base64url');
  const token = `${payload}.${createSign('SHA256').update(payload).end().sign(privateKey).toString('base64url')}`;
  const local = parse(await readFile(resolve(admin, '.env.local')));
  assert(local.STRIPE_SECRET_KEY?.startsWith('sk_test_') && local.STRIPE_PUBLISHABLE_KEY?.startsWith('pk_test_'), 'Checkout entry requires Stripe test keys');
  const env = { ...process.env, PATH: `${dirname(bun)}:${process.env.PATH}`, NODE_ENV: 'production', HOSTNAME: 'localhost', PORT: '55325',
    SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_URL: status.API_URL, SUPABASE_ANON_KEY: status.ANON_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY, SITE_URL: origin, NEXT_PUBLIC_SITE_URL: origin, NEXT_PUBLIC_BASE_URL: origin,
    TRUSTED_PROXY: 'true', DEMO_MODE: 'false', E2E_MODE: 'false', SUPABASE_KEEP_ALIVE: 'false', SELLF_TELEMETRY_DISABLED: 'true',
    CHECKOUT_BINDING_SECRET: randomBytes(32).toString('hex'), APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    STRIPE_SECRET_KEY: local.STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY: local.STRIPE_PUBLISHABLE_KEY, SELLF_LICENSE_KEY: token,
    SELLF_JWKS_FALLBACK: JSON.stringify([{ kid: 'perf', alg: 'ES256', pem: publicKey.export({ type: 'spki', format: 'pem' }) }]),
    SELLF_PLATFORM_JWKS_URL: `${status.API_URL}/not-a-jwks`, UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '' };
  if (!process.argv.includes('--skip-build')) await run(bun, ['run', 'build'], env, 'build.log');
  const standalone = standalonePath();
  await cp(resolve(admin, '.next/static'), resolve(standalone, '.next/static'), { recursive: true });
  await cp(resolve(admin, 'public'), resolve(standalone, 'public'), { recursive: true });
  const profile = { origin, source: command('git', ['rev-parse', 'HEAD']).trim(), cpu: cpus()[0].model, cores: cpus().length, ramBytes: totalmem(), os: command('sw_vers', []),
    node: command('node', ['--version']).trim(), bun: command(bun, ['--version']).trim(), postgres: sql('select version();').trim(),
    next: JSON.parse(await readFile(resolve(admin, 'node_modules/next/package.json'), 'utf8')).version,
    runs, mobile: { viewport: { width: 390, height: 844 }, cpu: 4, rttMs: 165, targetRttMs: 60, downBytesPerSecond: 9_000_000 / 8 * .9, upBytesPerSecond: 1_500_000 / 8 * .9 },
    desktop: { viewport: { width: 1440, height: 1000 }, cpu: 1, rttMs: 0, downBytesPerSecond: -1, upBytesPerSecond: -1 } };
  browser = await chromium.launch(); profile.chromium = browser.version();
  await writeFile(resolve(out, 'profile.json'), JSON.stringify(profile, null, 2));
  // The installed Next distribution pins the reference web-vitals implementation.
  const vitals = command(bun, ['build', '--target=browser', '--format=iife', '--define', '__dirname=""', resolve(admin, 'scripts/storefront-perf-vitals.js')]);
  for (const size of (probe ? [1000] : [1000, 100000])) {
    await stopApp();
    await idle(`fixture-${size}`);
    await writeFile(resolve(out, `fixture-${size}.log`), sql((await readFile(resolve(root, 'supabase/tests/storefront-perf-fixture.sql'), 'utf8')).replaceAll(':size', String(size))));
    await queryAcceptance(size);
    await idle(`traversal-${size}`);
    await writeFile(resolve(out, `traversal-${size}.log`), sql(await readFile(resolve(root, 'supabase/tests/storefront-perf-traversal.sql'), 'utf8')));
    for (const template of (probe ? [dProbe ? 'd' : 'default'] : ['default', 'd'])) {
      const { DEFAULT_CONFIG, D_LOCALIZED_CONFIG } = await import('@/lib/storefront-templates/fixtures');
      const config = structuredClone(template === 'd' ? D_LOCALIZED_CONFIG : DEFAULT_CONFIG);
      if (template === 'd') config.settingsByTemplate.d = { ...config.settingsByTemplate.d,
        heroProduct: '10000000-0000-4000-8000-000000000001', closingProduct: '10000000-0000-4000-8000-000000000001',
        starterProducts: [2, 3, 4].map(n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`), taskCategories: ['20000000-0000-4000-8000-000000000001'] };
      sql(`UPDATE public.storefront_config SET published='${JSON.stringify(config).replaceAll("'", "''")}'::jsonb;`);
      const edgeCases = [{ path: '/store?search=NoMatchForThisFixture', scenario: 'empty' }, { path: '/store', scenario: 'failed-cache' }];
      const pageCases = probe ? [{ path: emptyProbe ? '/store?search=NoMatchForThisFixture' : cacheProbe ? '/store' : dProbe ? '/' : freeProbe ? '/p/perf-course-11' : '/p/perf-course-1', scenario: emptyProbe ? 'empty' : cacheProbe ? 'failed-cache' : 'normal' }]
        : cacheCases ? edgeCases : [...['/', '/store', '/pl', '/p/perf-course-1', '/checkout/perf-course-1', '/p/perf-course-11', '/checkout/perf-course-11'].map(path => ({ path, scenario: 'normal' })), ...edgeCases];
      for (const device of (probe ? ['mobile'] : ['mobile', 'desktop'])) for (const { path, scenario } of pageCases) {
        await idle(`${scenario}/${size}/${template}/${device}/${path}`);
        for (let repeat = 0; repeat < runs; repeat++) {
          const context = await browser.newContext({ viewport: profile[device].viewport, isMobile: device === 'mobile', hasTouch: device === 'mobile', deviceScaleFactor: device === 'mobile' ? 2 : 1 });
          try {
            await context.addInitScript({ content: vitals });
            const page = await context.newPage();
            const cdp = await context.newCDPSession(page);
            await cdp.send('Network.enable');
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile[device].cpu });
            await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile[device].rttMs, downloadThroughput: profile[device].downBytesPerSecond, uploadThroughput: profile[device].upBytesPerSecond });
            for (const temperature of ['cold', 'warm']) {
              await idle(`${scenario}/${size}/${template}/${device}/${path}/${repeat}/${temperature}`);
              if (temperature === 'cold') await startApp(env, scenario === 'failed-cache');
              adminSql('SELECT extensions.pg_stat_statements_reset();');
              let bytes = 0;
              const types = {};
              const resourceTypes = new Map();
              const responseListener = event => resourceTypes.set(event.requestId, event.type);
              const finishedListener = event => { bytes += event.encodedDataLength; const type = resourceTypes.get(event.requestId) ?? 'Other'; types[type] = (types[type] ?? 0) + event.encodedDataLength; };
              cdp.on('Network.responseReceived', responseListener); cdp.on('Network.loadingFinished', finishedListener);
              const storefront = ['/', '/store', '/pl'].includes(new URL(path, origin).pathname);
              const response = await page.goto(`${origin}${path}`, { waitUntil: storefront ? 'networkidle' : 'load' });
              assert.equal(response.status(), 200);
              await expect(page.locator('h1')).toBeVisible();
              await page.evaluate(() => document.fonts.ready);
              if (repeat === 0 && temperature === 'cold' && ['/', '/pl'].includes(path)) {
                const screenshot = `/private/tmp/t1-26-${template}-${device}-${path === '/pl' ? 'pl' : 'en'}.png`;
                await page.screenshot({ path: screenshot });
                await cp(screenshot, resolve(out, screenshot.split('/').at(-1)));
              }
              if (probe && repeat === 0 && temperature === 'cold') await page.screenshot({ path: resolve(out, 'entry-before.png') });
              if (!storefront) await expect(page.locator('input[type=email]')).toBeVisible({ timeout: 30_000 });
              if (temperature === 'cold') {
                const reject = page.getByRole('button', { name: /^(Reject all|Odrzuć wszystkie)$/ }).first();
                await expect(reject).toBeVisible(); await reject.click(); await expect(reject).not.toBeVisible();
              }
              if (storefront) {
                await expect(page.locator('[data-template]')).toHaveAttribute('data-template', template);
                if (scenario === 'empty') await expect(page.locator('#catalogue article')).toHaveCount(0);
                if (scenario === 'failed-cache') {
                  expect(await page.locator('#catalogue article').count()).toBeGreaterThan(0);
                  await expect.poll(() => appOutput().includes('ENOTDIR')).toBe(true);
                  assert((await stat(resolve(standalonePath(), '.next/cache'))).isFile(), 'Persistent cache fault must remain active');
                }
                const search = page.locator('#catalogue input[type=search]');
                await search.click(); await search.pressSequentially(scenario === 'empty' ? 'NoMatchForThisFixture' : 'Performance', { delay: 40 });
                const [catalogueResponse] = await Promise.all([page.waitForResponse(r => r.url().includes('/api/storefront/catalogue')), page.locator('#catalogue button[type=submit]').click()]);
                assert.equal(catalogueResponse.status(), 200);
                await expect(page.locator('#catalogue [role=status]')).not.toContainText(/Loading|Ładowanie/);
                if (scenario === 'empty') await expect(page.locator('#catalogue article')).toHaveCount(0);
              } else {
                const email = page.locator('input[type=email]');
                await expect(email).toBeVisible({ timeout: 30_000 });
                if (probe && repeat === 0 && temperature === 'cold') await page.screenshot({ path: resolve(out, 'entry-ready.png') });
                await email.click(); await email.pressSequentially('buyer@example.invalid', { delay: 40 });
              }
              await page.evaluate(() => new Promise(accept => requestAnimationFrame(() => requestAnimationFrame(accept))));
              await page.evaluate(() => document.fonts.ready);
              await page.evaluate(() => new Promise(accept => requestIdleCallback(accept, { timeout: 1000 })));
              const measured = await page.evaluate(() => ({ ...window.__perfValues, TTFB: performance.getEntriesByType('navigation')[0].responseStart }));
              await page.goto('about:blank');
              assert(measured?.LCP > 0 && measured?.INP >= 0 && measured?.CLS >= 0, 'All vitals must be observed');
              const queries = JSON.parse(sql(`SELECT coalesce(json_agg(s),'[]') FROM (SELECT query,calls,rows,total_exec_time,shared_blks_hit,shared_blks_read FROM extensions.pg_stat_statements WHERE query ~ '(storefront_catalogue|storefront_config|FROM "public"."products"|omnibus_price_history)' ORDER BY query) s;`));
              samples.push({ size, template, device, path, repeat, temperature, ...measured, bytes, types, queries,
                scenario, cacheFailureConfirmed: scenario === 'failed-cache' && appOutput().includes('ENOTDIR') });
              console.log(JSON.stringify({ ...samples.at(-1), queries: undefined, shifts: undefined }));
              await writeFile(resolve(out, 'samples.json'), JSON.stringify(samples, null, 2));
              cdp.off('Network.responseReceived', responseListener); cdp.off('Network.loadingFinished', finishedListener);
            }
          } catch (error) {
            for (const page of context.pages()) await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
            throw error;
          } finally { await context.close(); }
        }
      }
    }
  }
  const groups = Map.groupBy(samples, sample => JSON.stringify([sample.size, sample.template, sample.device, sample.path, sample.temperature, sample.scenario]));
  const summary = [...groups].map(([key, values]) => ({ case: JSON.parse(key), n: values.length, ...Object.fromEntries(['LCP', 'CLS', 'INP', 'TTFB', 'bytes'].map(metric => [metric, p75(values.map(v => v[metric]))])) }));
  await writeFile(resolve(out, 'summary.json'), JSON.stringify(summary, null, 2));
  assert(summary.every(row => row.n >= 5 && row.LCP <= 2500 && row.CLS <= .1 && row.INP <= 200), 'Performance acceptance FAILED: see summary.json');
  assert.equal(summary.length, probe ? 2 : cacheCases ? 32 : 144);
  if (probe) console.log('PASS: diagnostic cases; full acceptance remains pending');
  else console.log(`PASS: all ${summary.length} ${cacheCases ? 'cache' : 'complete'} performance cases`);
  }
} finally {
  await browser?.close(); await stopApp();
  if (cacheFaultInjected) await rm(resolve(standalonePath(), '.next/cache'), { recursive: true, force: true });
}
