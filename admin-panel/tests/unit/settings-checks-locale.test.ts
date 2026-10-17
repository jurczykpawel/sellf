import { afterEach, expect, it, vi } from 'vitest';
import { getSecurityAudit, runSecurityAudit } from '@/lib/actions/security-audit';

vi.mock('@/lib/actions/admin-auth', () => ({ withAdminClient: async (run: () => Promise<unknown>) => run() }));
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
  const english = await getSecurityAudit('en');
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
