/**
 * U77-6: without a configured document URL, /terms and /privacy showed "Wymagana konfiguracja"
 * twice (subtitle and section heading). It must appear once.
 * @see src/components/LegalDocumentPage.tsx
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import pl from '@/messages/pl.json';

vi.mock('next/cache', () => ({ unstable_noStore: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createPublicClient: () => ({ from: () => ({ select: () => ({ single: async () => ({ data: null }) }) }) }) }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => (key: string) => ns.split('.').concat(key).reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], pl) as string,
}));

describe.each([['terms', () => import('@/app/[locale]/terms/page')], ['privacy', () => import('@/app/[locale]/privacy/page')]] as const)('%s page without a URL', (name, load) => {
  it('says "configuration required" once, in sentence case', async () => {
    delete process.env.TERMS_OF_SERVICE_URL; delete process.env.PRIVACY_POLICY_URL;
    const Page = (await load()).default;
    const html = renderToStaticMarkup(await Page());
    const label = pl.legalPages[name].configRequired;
    expect(label).toBe('Wymagana konfiguracja');
    expect(html.split(label).length - 1).toBe(1);
  });
});
