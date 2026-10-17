import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getSecurityAudit, runSecurityAudit } from '@/lib/actions/security-audit';

const { withAdminClient } = vi.hoisted(() => ({ withAdminClient: vi.fn(async (run: () => Promise<unknown>) => run()) }));
vi.mock('@/lib/actions/admin-auth', () => ({ withAdminClient }));
beforeEach(() => { withAdminClient.mockImplementation(async run => run()); });
vi.mock('@/lib/config/runtime-env', () => ({ getRuntimeSupabaseUrl: () => 'https://db.example.test', getRuntimeSupabaseAnonKey: () => 'anon' }));
vi.mock('@/lib/utils/canonical-url', () => ({ getCanonicalOriginOrNull: () => 'https://shop.example.test' }));
vi.mock('@/lib/stripe/internal-config', () => ({ getStripeWebhookSecretStatus: async () => ({ envConfigured: true }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('localizes check titles, dynamic details and steps without mixing cached locales', async () => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify({}), {
    status: url.endsWith('/mcp') ? 404 : 200,
    headers: url.includes('/products?') ? { 'content-range': '0-12/13' } : {},
  })));
  const polish = await runSecurityAudit('pl');
  const check = polish.checks.find(row => row.id === 'count-header-leak');
  expect(check?.name).toBe('Liczba wierszy w nagłówku Prefer');
  expect(check?.message).toContain('0-12/13');
  expect(check?.message).toContain('Anonimowi użytkownicy');
  expect(check?.steps?.join(' ')).toContain('nagłówek');
  const probeCount = vi.mocked(fetch).mock.calls.length;
  const english = await getSecurityAudit('en');
  expect(fetch).toHaveBeenCalledTimes(probeCount);
  expect(english.checks.find(row => row.id === 'count-header-leak')?.name).toBe('Row count via Prefer header');
  const cachedPolish = await getSecurityAudit('pl');
  expect(cachedPolish).toEqual(polish);
});
it('formats every diagnostic message in both languages, including command examples', async () => {
  const { createTranslator } = await import('next-intl');
  const en = (await import('@/messages/en.json')).default;
  const pl = (await import('@/messages/pl.json')).default;
  for (const [locale, messages] of [['en', en], ['pl', pl]] as const) {
    const t = createTranslator({ locale, messages: messages.securityAudit.checks as Record<string, string>, onError: error => { throw error; } });
    for (const key of Object.keys(messages.securityAudit.checks)) {
      expect(t(key, { value0: 2, value1: 3, value2: 'example.test', count: 2 })).toBeTruthy();
    }
    expect(t('graphQLIntrospectionSteps4')).toContain('{ deny all; }');
    expect(t('emailAutoconfirmSteps6')).toContain('<project-ref>');
  }
});

it.each([['en', 'pl'], ['pl', 'en']])('refreshes %s observations through %s without running probes on reads', async (initialLocale, refreshLocale) => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy');
  let rowCount = '0-12/13';
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify({}), {
    status: url.endsWith('/mcp') ? 404 : 200,
    headers: url.includes('/products?') ? { 'content-range': rowCount } : {},
  })));
  const original = await runSecurityAudit(initialLocale);
  expect(original.checks.find(row => row.id === 'count-header-leak')?.message).toContain('0-12/13');
  rowCount = '0-1/2';
  const refreshed = await runSecurityAudit(refreshLocale);
  vi.mocked(fetch).mockClear();
  const english = await getSecurityAudit('en');
  const check = english.checks.find(row => row.id === 'count-header-leak');
  expect(check?.message).toContain('0-1/2');
  expect(check?.name).toBe('Row count via Prefer header');
  expect(english.timestamp).toBe(refreshed.timestamp);
  expect(await getSecurityAudit(refreshLocale)).toEqual(refreshed);
  expect(fetch).not.toHaveBeenCalled();
});
it('translates nested values from the same observations on every read', async () => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy');
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('NEXT_PUBLIC_SELLF_ALLOWED_DOWNLOAD_DOMAINS', 'one.test,two.test');
  vi.stubEnv('SELLF_EMBED_ALLOWED_ORIGINS', 'https://one.test,https://two.test');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  const polish = await runSecurityAudit('pl');
  vi.mocked(fetch).mockClear();
  const english = await getSecurityAudit('en');
  expect(english.checks.find(row => row.id === 'trusted-download-domains')?.message).toContain('hosts');
  expect(polish.checks.find(row => row.id === 'trusted-download-domains')?.message).toContain('2 domeny');
  expect(english.checks.find(row => row.id === 'allowed-embed-origins')?.message).toContain('origins');
  expect(english.checks.find(row => row.id === 'stripe-mode')?.message).toContain('STRIPE_SECRET_KEY env');
  expect(polish.checks.find(row => row.id === 'stripe-mode')?.message).toContain('zmienna');
  expect(fetch).not.toHaveBeenCalled();
});
it('checks the current caller before serving the shared snapshot', async () => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  const original = await runSecurityAudit('en');
  vi.mocked(fetch).mockClear();
  withAdminClient.mockResolvedValueOnce({ success: false, errorCode: 'UNAUTHORIZED' });
  const rejected = await getSecurityAudit('pl');
  expect(rejected.success).toBe(false);
  expect(rejected.checks).toEqual([]);
  expect(rejected.error).toBe('Zaloguj się ponownie, aby wykonać sprawdzenie.');
  expect(await getSecurityAudit('en')).toEqual(original);
  expect(fetch).not.toHaveBeenCalled();
});
