import { afterEach, expect, it, vi } from 'vitest';
const createBrowserClient = vi.hoisted(() => vi.fn(() => ({ authenticatedClient: true })));
vi.mock('@supabase/ssr', () => ({ createBrowserClient }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); vi.clearAllMocks(); });
it('fails explicitly when runtime-config is unavailable and can retry', async () => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://placeholder.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'placeholder-anon-key');
  vi.stubGlobal('window', {});
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  const fetchConfig = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({
    ok: true, json: async () => ({ supabaseUrl: 'https://real.example.org', supabaseAnonKey: 'real-runtime-key' }),
  });
  vi.stubGlobal('fetch', fetchConfig);
  const { createClient } = await import('@/lib/supabase/client');
  await expect(createClient()).rejects.toThrow(/Runtime configuration unavailable/);
  expect(createBrowserClient).not.toHaveBeenCalled();
  await createClient();
  expect(createBrowserClient).toHaveBeenCalledWith('https://real.example.org', 'real-runtime-key');
});
