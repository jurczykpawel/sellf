/** Disposable premium authoring and actual test-mode purchase acceptance. @see playwright.premium.config.ts */
import { createHash, createSign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import type { Page } from '@playwright/test';
import { extractMagicLink } from './helpers/mailpit';
import { acceptAllCookies } from './helpers/consent';

const trial = process.env.PREMIUM_TRIAL === 'c' ? 'c' : process.env.PREMIUM_TRIAL === 'b' ? 'b' : 'a';
const task = trial === 'c' ? 't218' : trial === 'b' ? 't213' : 't208';
const templateId = `storefront-${trial}`;
const root = `/private/tmp/sellf-${task}/`;
const env = JSON.parse(readFileSync(`${root}env.json`, 'utf8'));
const handoff = JSON.parse(readFileSync(`${root}handoff.json`, 'utf8'));
const credentials = JSON.parse(readFileSync(`${root}credentials.json`, 'utf8'));
if (env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:55441' || handoff.origin !== `http://sellf-${task}.localhost:55446` || !env.STRIPE_SECRET_KEY.startsWith('sk_test_')) throw new Error('Disposable premium stack and Stripe test keys required');
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const origin = handoff.origin;
const api = '/api/v1/templates/';
const evidence: object[] = [];
function record(step: string, details: object = {}) { evidence.push({ step, at: new Date().toISOString(), ...details }); writeFileSync(`/tmp/${task}-acceptance.json`, JSON.stringify(evidence, null, 2)); }
async function call(path: string, data?: unknown, method = 'POST', key = handoff.keys.author) {
  const response = await fetch(origin + api + path, { method: data === undefined ? 'GET' : method, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const body = await response.json();
  if (response.status === 429) record('rate-limited', { path });
  return { status: response.status, body };
}
async function storePlatform(token: string | null) { const r = await db.from('integrations_config').update({ sellf_license: token }).eq('id', 1); expect(r.error).toBeNull(); }
async function status() { return (await call('licenses')).body.statuses.find((s: { templateId: string }) => s.templateId === templateId)?.state; }
async function saveCredential(token: string) { expect((await call('licenses', { templateId, token })).status).toBe(200); }
async function waitPremium() { await expect.poll(async () => (await call('config')).body.rights?.availableTemplateIds.includes(templateId) ?? false, { timeout: 65000, intervals: [3000] }).toBe(true); }
async function rendered() { const response = await fetch(origin); expect(response.status).toBe(200); return (await response.text()).match(/data-template="([^"]+)"/)?.[1]; }
async function fallback(reason: string) {
  const started = Date.now(); await expect.poll(rendered, { timeout: 61000, intervals: [3000] }).toBe('default');
  record(reason, { fallbackMs: Date.now() - started });
}
async function magicLink(email: string) {
  let link: string | null = null;
  await expect.poll(async () => {
    const result = await fetch(`http://127.0.0.1:55444/api/v1/search?query=to:${encodeURIComponent(email)}`).then(r => r.json());
    if (!result.messages?.length) return false;
    const message = await fetch(`http://127.0.0.1:55444/api/v1/message/${result.messages[0].ID}`).then(r => r.json());
    link = extractMagicLink(message.HTML || message.Text || ''); return !!link;
  }, { timeout: 60000, intervals: [3000] }).toBe(true); return link!;
}
async function verifyAccess(page: Page, email: string, product: { id: string; slug: string }) {
  await page.goto(await magicLink(email));
  await expect(page).toHaveURL(new RegExp(`/p/${product.slug}(?:[/?]|$)`));
  const user = await db.rpc('find_user_id_by_email', { p_email: email }); expect(user.error).toBeNull();
  await expect.poll(async () => (await db.from('user_product_access').select('id').eq('user_id', user.data!).eq('product_id', product.id)).data?.length, { timeout: 15000 }).toBe(1);
  await page.goto('/my-products'); await expect(page.getByText(product.slug === 't208-paid' ? 'T208 paid workshop' : 'T208 free guide', { exact: true }).first()).toBeVisible();
}

test('premium author lifecycle and cached rights loss', async ({ browser, request }) => {
  writeFileSync(`${root}issuer-state.json`, JSON.stringify({ offline: false, revoked: [] }));
  await storePlatform(credentials.platform);
  expect(new URL(env.NEXT_PUBLIC_SUPABASE_URL).port).toBe('55441'); expect(env.STRIPE_SECRET_KEY.startsWith('sk_test_')).toBe(true);
  const author = await browser.newContext({ reducedMotion: 'reduce' }); const page = await author.newPage();
  const outbound: string[] = [];
  await author.route('**/*', route => {
    const req = route.request(); if (new URL(req.url()).origin !== origin) { outbound.push(new URL(req.url()).origin); return route.abort(); }
    return route.continue({ headers: { ...req.headers(), ...(req.isNavigationRequest() ? { authorization: `Bearer ${handoff.keys.author}` } : {}) } });
  });
  expect(await author.cookies()).toEqual([]);
  expect((await request.get(`${api}config`)).status()).toBe(401);
  for (const key of [handoff.keys.write, handoff.keys.activate, handoff.keys.product]) expect((await call('config', undefined, 'GET', key)).status).toBe(403);
  expect((await call('capabilities')).status).toBe(200);
  const initial = (await call('config')).body; let revision = initial.revision;
  const candidate = structuredClone(initial.published);
  candidate.templateId = templateId;
  candidate.overridesByTemplate[templateId] = { order: ['hero', 'tasks', 'comparison', 'start', 'catalogue', 'faq', 'closing'], sections: { tasks: { visibility: 'visible' }, start: { variant: 'detail-cards' } } };
  const products = handoff.products.slice(0, trial === 'b' ? 6 : trial === 'c' ? 4 : 3);
  candidate.settingsByTemplate[templateId] = { heroProduct: products[0].id, comparisonProducts: products.slice(0, 2).map((p: { id: string }) => p.id), starterProducts: products.map((p: { id: string }) => p.id), taskCategories: handoff.categories.slice(0, 1).map((c: { id: string }) => c.id), density: 'comfortable' };
  candidate.content = { ...candidate.content,
    'home.hero': { sourceLocale: 'en', en: { kind: 'hero', eyebrow: 'Example studio', heading: 'Build a useful workflow', body: 'Explore the available workshops and guides.', steps: ['Choose a task', 'Read the guide', 'Try the process'] } },
    'home.tasks': { sourceLocale: 'en', en: { kind: 'heading', heading: 'Choose a category', body: 'Browse by task.' } },
    'home.starts': { sourceLocale: 'en', en: { kind: 'heading', heading: 'Three starting points', body: 'Choose an existing product.' } },
    'home.comparison': { sourceLocale: 'en', en: { kind: 'comparison', heading: 'Two separate offers', body: 'Choose the task you need.', items: products.slice(0, 2).map((p: { id: string }, i: number) => ({ productId: p.id, eyebrow: 'A separate offer', heading: `Task ${i + 1}`, body: 'Read the product requirements.', bullets: ['Review the details'] })) } },
    'home.faq': { sourceLocale: 'en', en: { kind: 'faq', items: [{ id: 'requirements', question: 'Where are the requirements?', answer: 'Read the canonical product details.' }] } },
    'home.closing': { sourceLocale: 'en', en: { kind: 'cta', heading: 'Explore the catalogue', body: 'Find your next task.' } },
  };
  if (trial === 'b') {
    candidate.overridesByTemplate[templateId] = { order: ['hero', 'featured', 'catalogue', 'starter', 'faq', 'closing'], sections: { featured: { visibility: 'visible' } } };
    candidate.settingsByTemplate[templateId] = { featuredProducts: products.map((p: { id: string }) => p.id), closingProduct: handoff.starter.id, taskCategories: handoff.categories.map((c: { id: string }) => c.id), density: 'comfortable' };
    candidate.content['home.search'] = { sourceLocale: 'en', en: { kind: 'search', eyebrow: 'Example studio', heading: 'Find your next task', body: 'Search guides and workshops.', items: handoff.categories.map((c: { id: string }, i: number) => ({ id: `task-${i}`, categoryId: c.id, description: 'Explore this topic.' })) } };
    candidate.content['home.featured'] = { sourceLocale: 'en', en: { kind: 'heading', heading: 'Six starting points', body: 'Choose a guide.' } };
    candidate.content['home.starter'] = { sourceLocale: 'en', en: { kind: 'cta', heading: 'Start with one task', body: 'Read the guide.' } };
  }
  if (trial === 'c') {
    candidate.overridesByTemplate[templateId] = { order: ['hero', 'story', 'paths', 'projects', 'start', 'catalogue', 'faq', 'closing'], sections: { story: { visibility: 'visible' } } };
    candidate.settingsByTemplate[templateId] = { starterProducts: products.slice(0, 3).map((p: { id: string }) => p.id), density: 'comfortable' };
    candidate.content['home.author'] = { sourceLocale: 'en', en: { kind: 'author', name: 'Alex Example', eyebrow: 'Independent maker', heading: 'Useful work, shared openly', intro: 'Explore practical projects and guides.', portraitMediaId: null } };
    candidate.content['home.story'] = { sourceLocale: 'en', en: { kind: 'biography', heading: 'The work behind the guides', paragraphs: ['A synthetic biography retained across template changes.', 'Start with an existing product and build a useful workflow.'] } };
    candidate.content['home.paths'] = { sourceLocale: 'en', en: { kind: 'paths', heading: 'Choose a starting path', body: 'Choose the task you need.', items: products.map((p: { id: string }, i: number) => ({ id: `path-${i}`, productId: p.id, situation: `Starting point ${i + 1}`, body: 'Explore the canonical product details.' })) } };
    candidate.content['home.projects'] = { sourceLocale: 'en', en: { kind: 'projects', heading: 'Selected projects', items: [{ id: 'project-one', name: 'Example project', body: 'A synthetic project description.', url: 'https://example.test/project-one', mediaId: null }] } };
  }
  expect((await call('draft', { expectedRevision: revision, config: candidate }, 'PUT', handoff.keys.read)).status).toBe(403);
  expect((await call('publish', { expectedRevision: revision }, 'POST', handoff.keys.write)).status).toBe(403);
  const drafted = await call('draft', { expectedRevision: revision, config: candidate }, 'PUT'); expect(drafted.status).toBe(200); revision++;
  const validation = await call('validate', { config: candidate, mode: 'draft' }); expect(validation.body.valid).toBe(true);
  for (const letter of (['a', 'b', 'c'].filter(letter => letter !== trial))) {
    await saveCredential(credentials[letter]); await expect.poll(status, { timeout: 65000, intervals: [3000] }).toBe('invalid');
    const before = await db.from('storefront_config_history').select('revision');
    expect((await call('publish', { expectedRevision: revision })).status).toBe(403);
    expect((await db.from('storefront_config_history').select('revision')).data).toEqual(before.data);
    record(`wrong-${letter}-denied`);
  }
  await saveCredential(credentials[trial]); await waitPremium();
  const valid = await call('validate', { config: candidate, mode: 'publish' }); expect(valid.body.valid).toBe(true);
  expect(valid.body.warnings.some((w: { code: string }) => w.code === 'TRANSLATION_FALLBACK')).toBe(true);
  let oldPath = '';
  for (const locale of ['en', 'pl']) for (const fixture of ['standard', 'empty', 'long', 'unavailable', 'published-products']) {
    const preview = await call('preview', { revision, locale, fixture }); expect(preview.status).toBe(200); oldPath = preview.body.previewPath;
    if (locale === 'en' && fixture === 'standard') {
      expect((await request.get(oldPath)).status()).toBe(404);
      expect((await request.get(oldPath, { headers: { authorization: `Bearer ${handoff.keys.write}` } })).status()).toBe(404);
      expect((await call('preview', { revision, locale, fixture }, 'POST', handoff.keys.product)).status).toBe(403);
      const aged = new URL(oldPath, origin); aged.searchParams.set('issuedAt', String(Date.now() - 600001));
      const expiredHtml = await (await request.get(aged.toString(), { headers: { authorization: `Bearer ${handoff.keys.read}` } })).text();
      expect(expiredHtml).toContain('CONFLICT'); expect(expiredHtml).not.toContain('data-preview-inert');
      record('preview-auth-and-aged-lease-denied');
    }
    const response = await page.goto(oldPath);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme }); expect(response!.status()).toBe(200);
      expect(response!.headers()['cache-control']).toContain('no-store'); expect(response!.headers()['x-robots-tag']).toBe('noindex, nofollow');
      expect(response!.headers()['content-security-policy']).toContain("default-src 'none'"); for (const secret of [...Object.values(handoff.keys), credentials.a, credentials.b, credentials.c, credentials.platform]) expect((await response!.text()).includes(String(secret))).toBe(false);
      await expect(page.locator('[data-preview-inert]')).toHaveAttribute('inert', ''); await expect(page.locator('h1')).toHaveCount(1); await expect(page.locator('html')).toHaveAttribute('lang', locale);
      expect(await page.evaluate(() => '__next_f' in window)).toBe(false);
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (width === 390 || width === 1440) await page.screenshot({ path: `/tmp/${task}-${fixture}-${locale}-${scheme}-${width}.png`, fullPage: true });
      }
      await page.evaluate(() => { document.body.style.zoom = '2'; }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.evaluate(() => { document.body.style.zoom = ''; });
    }
    record('preview', { locale, fixture });
  }
  expect(outbound).toEqual([]); expect(await author.cookies()).toEqual([]); expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  const saved = (await call('config')).body; expect(saved.draft).toEqual(candidate);
  expect(saved.draft.content['home.catalogue']).toEqual(initial.published.content['home.catalogue']);
  expect(saved.draft.settingsByTemplate.d).toEqual(initial.published.settingsByTemplate.d);
  expect((await call('diff', { fromRevision: initial.revision, toRevision: revision })).body.changes.length).toBeGreaterThan(0);
  expect((await call('publish', { expectedRevision: revision })).status).toBe(200); revision++;
  expect((await call('config')).body.published).toEqual(candidate); await expect.poll(rendered).toBe(templateId);
  if (trial === 'c') {
    const publicHtml = await fetch(origin).then(response => response.text());
    for (const family of ['author-hero/1', 'author-story/1', 'product-paths/1', 'project-showcase/1']) expect(publicHtml).toContain(`data-section="${family}"`);
    expect(publicHtml).toContain('id="paths"');
  }
  const premiumRevision = revision;
  expect((await call('rollback', { expectedRevision: revision, targetRevision: initial.revision })).status).toBe(200); revision++;
  expect((await call('config')).body.published).toEqual(initial.published);
  await expect.poll(async () => (await call('preview', { revision: revision - 2, locale: 'en', fixture: 'standard' })).status, { timeout: 65000, intervals: [2000] }).toBe(409);
  await page.goto(oldPath); await expect(page.locator('[data-preview-inert]')).toHaveCount(0);
  record('lifecycle', { initial: initial.revision, draft: initial.revision + 1, published: premiumRevision, rollback: revision });
  await author.close();
  expect((await call('rollback', { expectedRevision: revision, targetRevision: premiumRevision })).status).toBe(200); revision++;
  await expect.poll(rendered).toBe(templateId);
  const until = Math.floor(Date.now() / 1000) + 45;
  const c = { ...credentials.common, product: credentials.policies[['a', 'b', 'c'].indexOf(trial)].saleProductId, templateId, edition: 'standard', tier: 'standard', order: 't208-expiring', exp: until };
  const payload = Buffer.from(JSON.stringify(c)).toString('base64url');
  await saveCredential(payload + '.' + createSign('SHA256').update(payload).end().sign(credentials.privateKey).toString('base64url'));
  await waitPremium(); expect(await rendered()).toBe(templateId); await fallback('expiry');
  const history = (await db.from('storefront_config_history').select('revision')).data;
  expect((await call('rollback', { expectedRevision: revision, targetRevision: premiumRevision })).status).toBe(403);
  expect((await db.from('storefront_config_history').select('revision')).data).toEqual(history);
  await saveCredential(credentials[trial]); await waitPremium(); expect(await rendered()).toBe(templateId);
  writeFileSync(`${root}issuer-state.json`, JSON.stringify({ offline: false, revoked: [createHash('sha256').update(`${task}-${trial}`).digest('hex')] }));
  await fallback('refund'); expect((await call('config')).body.published).toEqual(candidate);
  writeFileSync(`${root}issuer-state.json`, JSON.stringify({ offline: false, revoked: [] })); await saveCredential(credentials[trial]); await waitPremium();
  await storePlatform(null); await fallback('downgrade');
  expect((await call('rollback', { expectedRevision: revision, targetRevision: premiumRevision })).status).toBe(403);
  expect((await db.from('storefront_config_history').select('revision')).data).toEqual(history);
  await storePlatform(credentials.platform); await waitPremium();
  const snapshots = JSON.stringify((await db.from('storefront_config_history').select('draft,published')).data);
  const audits = JSON.stringify((await db.from('audit_log').select('new_values').eq('table_name', 'storefront_config')).data);
  for (const secret of [...Object.values(handoff.keys), credentials.a, credentials.b, credentials.c, credentials.platform]) {
    expect(snapshots.includes(String(secret))).toBe(false); expect(audits.includes(String(secret))).toBe(false);
  }
  record('rights-complete');
});

test('purchase started on premium storefront and free access finish after downgrade during issuer outage', async ({ browser }) => {
  await storePlatform(credentials.platform);
  writeFileSync(`${root}issuer-state.json`, JSON.stringify({ offline: false, revoked: [] }));
  await saveCredential(credentials[trial]); await waitPremium();
  const paid = await db.from('products').upsert({ slug: 't208-paid', name: 'T208 paid workshop', price: 10, currency: 'USD', is_active: true, is_listed: true, vat_exempt: true }, { onConflict: 'slug' }).select('id,slug').single();
  const free = await db.from('products').upsert({ slug: 't208-free', name: 'T208 free guide', price: 0, currency: 'USD', is_active: true, is_listed: true, vat_exempt: true }, { onConflict: 'slug' }).select('id,slug').single();
  expect(paid.error).toBeNull(); expect(free.error).toBeNull();
  const current = (await call('config')).body; const config = structuredClone(current.published);
  config.templateId = templateId;
  if (trial === 'a') config.settingsByTemplate[templateId].heroProduct = paid.data!.id;
  else if (trial === 'c') config.settingsByTemplate[templateId].starterProducts = [paid.data!.id];
  else config.settingsByTemplate[templateId].featuredProducts = [paid.data!.id, ...config.settingsByTemplate[templateId].featuredProducts.slice(0, 5)];
  expect((await call('draft', { expectedRevision: current.revision, config }, 'PUT')).status).toBe(200);
  expect((await call('publish', { expectedRevision: current.revision + 1 })).status).toBe(200);
  const buyer = await browser.newContext(); const page = await buyer.newPage();
  await acceptAllCookies(page);
  const consent = await buyer.cookies('http://localhost');
  await buyer.addCookies(consent.map(({ name, value }) => ({ name, value, url: origin })));
  await page.goto('/'); await expect(page.locator('[data-template]')).toHaveAttribute('data-template', templateId);
  await page.locator(`[data-variant="${trial === 'a' ? 'offer-focus' : trial === 'b' ? 'featured-grid' : 'detail-cards'}"] a[href$="/p/${paid.data!.slug}"]`).first().click();
  await expect(page).toHaveURL(/\/p\/t208-paid/);
  const email = `t208-paid-${Date.now()}@example.com`;
  await expect(page.locator('#checkoutEmail')).toBeVisible({ timeout: 90000 });
  await page.locator('#checkoutEmail').fill(email); await page.locator('#fullName').fill('Example Buyer');
  for (const box of await page.locator('input[type="checkbox"]').all()) if (await box.isVisible()) await box.check();
  const frame = page.frameLocator('iframe[title="Secure payment input frame"][src*="elements-inner-payment"]');
  await expect(frame.locator('input[name="number"]')).toBeVisible({ timeout: 60000 });
  await frame.locator('input[name="number"]').fill('4242424242424242'); await frame.locator('input[name="expiry"]').fill('1234'); await frame.locator('input[name="cvc"]').fill('123');
  const revision = (await call('config')).body.revision;
  record('real-stripe-form-ready');
  writeFileSync(`${root}issuer-state.json`, JSON.stringify({ offline: true, revoked: [] })); await storePlatform(null);
  await fallback('purchase-in-flight-downgrade');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/payment-status.*session_id=/, { timeout: 120000 });
  await expect(page.getByText(/Payment received|Access granted|You now have access|Payment successful|Your payment has been processed successfully/i).first()).toBeVisible({ timeout: 90000 });
  await expect.poll(async () => (await db.from('payment_transactions').select('status').eq('product_id', paid.data!.id).eq('customer_email', email).eq('status', 'completed')).data?.length, { timeout: 90000 }).toBe(1);
  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  const sessionId = new URL(page.url()).searchParams.get('session_id')!;
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  expect(session.livemode).toBe(false); expect(session.payment_status).toBe('paid'); expect(session.amount_total).toBe(1000);
  await expect.poll(async () => {
    const events = await stripe.events.list({ type: 'checkout.session.completed', limit: 100 });
    const event = events.data.find(e => e.data.object.id === sessionId);
    return !!event && readFileSync(`${root}stripe.log`, 'utf8').split('\n').some(line => line.includes('[200] POST') && line.includes(event.id));
  }, { timeout: 90000, intervals: [3000] }).toBe(true);
  await verifyAccess(page, email, paid.data!); record('purchase-and-buyer-access-complete'); await buyer.close();
  const { solveChallenge } = await import('altcha-lib/v1');
  const challenge = await fetch(origin + '/api/captcha/challenge').then(r => r.json());
  const solution = await solveChallenge(challenge.challenge, challenge.salt, challenge.algorithm, challenge.maxnumber).promise; expect(solution).toBeTruthy();
  const captchaToken = Buffer.from(JSON.stringify({ ...challenge, number: solution!.number })).toString('base64');
  const freeEmail = `t208-free-${Date.now()}@example.com`;
  const granted = await fetch(origin + '/api/auth/magic-link', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ email: freeEmail, flow: 'free_product', productSlug: free.data!.slug, captchaToken }) });
  expect(granted.status).toBe(200);
  const freeBuyer = await browser.newContext(); await verifyAccess(await freeBuyer.newPage(), freeEmail, free.data!); await freeBuyer.close();
  expect(await rendered()).toBe('default'); expect((await call('config')).body.revision).toBe(revision);
  record('free-and-access-complete-during-outage');
  await storePlatform(credentials.platform); writeFileSync(`${root}issuer-state.json`, JSON.stringify({ offline: false, revoked: [] }));
});

if (trial === 'b') test('B uses bounded search, category and cursor controls at 100k, with both details routes', async ({ browser }) => {
  await storePlatform(credentials.platform); await saveCredential(credentials.b); await waitPremium();
  const { execFileSync } = await import('node:child_process');
  expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:55441');
  expect(execFileSync('docker', ['port', 'supabase_kong_sellf-t213', '8000/tcp'], { encoding: 'utf8' })).toContain(':55441');
  execFileSync('docker', ['exec', '-i', 'supabase_db_sellf-t213', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: `
    BEGIN;
    ALTER TABLE public.product_price_history DISABLE TRIGGER cleanup_price_history_trigger;
    INSERT INTO public.products(id,name,slug,price,currency,is_active,is_listed,created_at)
    SELECT ('21300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'B acceptance '||lpad(n::text,6,'0'),'t213-catalogue-'||n,10,'USD',true,true,'2026-10-01'::timestamptz FROM generate_series(1,100000) n WHERE NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id=('21300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid) ON CONFLICT DO NOTHING;
    ALTER TABLE public.product_price_history ENABLE TRIGGER cleanup_price_history_trigger;
    INSERT INTO public.product_categories(product_id,category_id)
    SELECT ('21300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,(SELECT id FROM public.categories ORDER BY id LIMIT 1) FROM generate_series(2,100000,2) n ON CONFLICT DO NOTHING;
    COMMIT;
  `, stdio: ['pipe', 'pipe', 'pipe'] });
  const category = await db.from('categories').select('id').order('id').limit(1).single(); expect(category.error).toBeNull();
  const current = (await call('config')).body;
  const config = structuredClone(current.published); config.settingsByTemplate[templateId].taskCategories = [category.data!.id];
  expect((await call('draft', { expectedRevision: current.revision, config }, 'PUT')).status).toBe(200);
  expect((await call('publish', { expectedRevision: current.revision + 1 })).status).toBe(200);
  const context = await browser.newContext(); const page = await context.newPage();
  const batches: { search: string; categoryIds: string[]; cursor: string | null; pageSize: number }[] = [];
  page.on('response', async response => {
    if (new URL(response.url()).pathname !== '/api/storefront/catalogue') return;
    expect(response.status()).toBe(200); const body = await response.json();
    for (const result of Array.isArray(body) ? body : [body]) expect(result.products.length).toBeLessThanOrEqual(24);
    const input = JSON.parse(new URL(response.url()).searchParams.get('input')!); batches.push(...(Array.isArray(input) ? input : [input]));
  });
  await acceptAllCookies(page); const consent = await context.cookies('http://localhost'); await context.addCookies(consent.map(({ name, value }) => ({ name, value, url: origin })));
  await page.goto('/'); await expect(page.locator('[data-template]')).toHaveAttribute('data-template', templateId);
  const search = page.locator('[data-variant="search-hero"] input[type="search"]');
  await search.fill('B acceptance'); await search.press('Enter');
  await expect.poll(() => batches.at(-1)?.search).toBe('B acceptance'); await expect(search).toBeFocused();
  await page.locator('[data-variant="search-hero"] nav a').first().click();
  await expect.poll(() => batches.at(-1)?.categoryIds).toEqual([category.data!.id]);
  await expect(page.locator('#catalogue article')).toHaveCount(24);
  await page.locator('#catalogue button').filter({ hasText: 'More products' }).click();
  await expect(page.locator('#catalogue article')).toHaveCount(48);
  expect(batches.at(-1)?.cursor).toBeTruthy(); expect(batches.every(batch => batch.pageSize <= 24)).toBe(true);
  await search.fill('B acceptance 100000'); await search.press('Enter');
  await expect(page.locator('#catalogue article')).toHaveCount(1); await expect(page.locator('#catalogue')).toContainText('B acceptance 100000');
  const product = handoff.products[0];
  const offerCall = async (operation: string, data?: unknown) => {
    const response = await fetch(`${origin}/api/v1/products/${product.id}/offer/${operation}`, { method: operation === 'config' ? 'GET' : operation === 'draft' ? 'PUT' : 'POST', headers: { authorization: `Bearer ${handoff.keys.author}`, 'content-type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) });
    expect(response.status).toBe(200); return response.json();
  };
  const offer = { format: 1, enabled: true, templateId: 'offer-default', settings: { density: 'comfortable' }, content: {}, tokens: null };
  const initial = await offerCall('config');
  await offerCall('draft', { expectedRevision: initial.revision, config: offer }); await offerCall('publish', { expectedRevision: initial.revision + 1 });
  for (const locale of ['en', 'pl']) {
    await page.goto(locale === 'en' ? '/' : '/pl');
    const link = page.locator(`[data-variant="featured-grid"] a[href$="/offer/${product.slug}"]`).first(); await expect(link).toBeVisible(); await link.click();
    await expect(page).toHaveURL(new RegExp(`/offer/${product.slug}$`));
    await expect(page.locator(`a[href$="/checkout/${product.slug}"]`).first()).toBeVisible();
  }
  await offerCall('draft', { expectedRevision: initial.revision + 2, config: { ...offer, enabled: false } }); await offerCall('publish', { expectedRevision: initial.revision + 3 });
  await page.goto('/'); await expect(page.locator(`[data-variant="featured-grid"] a[href$="/p/${product.slug}"]`).first()).toBeVisible();
  record('100k-controls-and-offer-details', { batches: batches.length, maxPageSize: Math.max(...batches.map(batch => batch.pageSize)) });
  await context.close();
});

if (trial === 'c') test('C retains author content through template switches and routes enabled and disabled offer details', async ({ browser }) => {
  await storePlatform(credentials.platform); await saveCredential(credentials.c); await waitPremium();
  const current = (await call('config')).body;
  const candidate = structuredClone(current.published);
  let revision = current.revision;
  const retained = JSON.stringify({ content: candidate.content, settings: candidate.settingsByTemplate, overrides: candidate.overridesByTemplate });
  for (const id of ['storefront-a', 'storefront-b', 'd', 'storefront-c']) {
    candidate.templateId = id;
    expect((await call('draft', { expectedRevision: revision, config: candidate }, 'PUT')).status).toBe(200); revision++;
    const saved = (await call('config')).body.draft;
    expect(JSON.stringify({ content: saved.content, settings: saved.settingsByTemplate, overrides: saved.overridesByTemplate })).toBe(retained);
  }
  expect((await call('publish', { expectedRevision: revision })).status).toBe(200);
  const product = handoff.products[0];
  const offerCall = async (operation: string, data?: unknown) => {
    const response = await fetch(`${origin}/api/v1/products/${product.id}/offer/${operation}`, { method: operation === 'config' ? 'GET' : operation === 'draft' ? 'PUT' : 'POST', headers: { authorization: `Bearer ${handoff.keys.author}`, 'content-type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) });
    expect(response.status).toBe(200); return response.json();
  };
  const offer = { format: 1, enabled: true, templateId: 'offer-default', settings: { density: 'comfortable' }, content: {}, tokens: null };
  const initial = await offerCall('config');
  await offerCall('draft', { expectedRevision: initial.revision, config: offer }); await offerCall('publish', { expectedRevision: initial.revision + 1 });
  const context = await browser.newContext(); const page = await context.newPage();
  await acceptAllCookies(page); const consent = await context.cookies('http://localhost'); await context.addCookies(consent.map(({ name, value }) => ({ name, value, url: origin })));
  for (const locale of ['en', 'pl']) {
    await page.goto(locale === 'en' ? '/' : '/pl');
    await expect(page.locator('[data-template]')).toHaveAttribute('data-template', templateId);
    const link = page.locator(`#paths a[href$="/offer/${product.slug}"]`).first(); await expect(link).toBeVisible(); await link.click();
    await expect(page).toHaveURL(new RegExp(`/offer/${product.slug}$`));
    await expect(page.locator(`a[href$="/checkout/${product.slug}"]`).first()).toBeVisible();
  }
  await offerCall('draft', { expectedRevision: initial.revision + 2, config: { ...offer, enabled: false } }); await offerCall('publish', { expectedRevision: initial.revision + 3 });
  await page.goto('/'); await expect(page.locator(`#paths a[href$="/p/${product.slug}"]`).first()).toBeVisible();
  await expect(page.locator('h1')).toHaveCount(1);
  expect(await page.locator('a[href*="about-store"]').count()).toBe(0);
  record('c-switch-retention-and-offer-details', { switches: ['C', 'A', 'B', 'D', 'C'], locales: ['en', 'pl'] });
  await context.close();
});
