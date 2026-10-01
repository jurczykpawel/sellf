/**
 * Unit tests for /legal/[type] — the page that renders a generated legal
 * document. Storage, the public Supabase client, and i18n are all mocked so
 * these run without a real Next.js request context.
 *
 * Run: cd admin-panel && bunx vitest run tests/unit/routes/legal-document-page.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

class NotFoundError extends Error {}

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new NotFoundError('NEXT_NOT_FOUND');
  },
}));

vi.mock('next/cache', () => ({
  unstable_noStore: vi.fn(),
}));

vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

const shopConfig: { id: string | null } = { id: 'shop-123' };

vi.mock('@/lib/supabase/server', () => ({
  createPublicClient: () => ({
    from: () => ({
      select: () => ({
        single: async () => ({ data: shopConfig, error: null }),
      }),
    }),
  }),
}));

let downloadResult: { data: { text: () => Promise<string> } | null; error: unknown } = {
  data: { text: async () => '<h1>Regulamin</h1>' },
  error: null,
};
const downloadSpy = vi.fn(async (path: string) => ({ ...downloadResult, path }));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    storage: {
      from: (bucket: string) => ({
        download: (path: string) => downloadSpy(`${bucket}/${path}`),
      }),
    },
  }),
}));

// Import AFTER mocks are declared.
const LegalDocumentPage = (await import('@/app/[locale]/legal/[type]/page')).default;

beforeEach(() => {
  vi.clearAllMocks();
  shopConfig.id = 'shop-123';
  downloadResult = { data: { text: async () => '<h1>Regulamin</h1>' }, error: null };
});

describe('/legal/[type] page', () => {
  it('calls notFound() for an unknown type', async () => {
    await expect(
      LegalDocumentPage({ params: Promise.resolve({ type: 'refund-policy' }) }),
    ).rejects.toThrow(NotFoundError);
  });

  it('calls notFound() when shop_config has no id', async () => {
    shopConfig.id = null;
    await expect(
      LegalDocumentPage({ params: Promise.resolve({ type: 'terms' }) }),
    ).rejects.toThrow(NotFoundError);
  });

  it('calls notFound() when the stored object does not exist', async () => {
    downloadResult = { data: null, error: { message: 'not found' } };
    await expect(
      LegalDocumentPage({ params: Promise.resolve({ type: 'terms' }) }),
    ).rejects.toThrow(NotFoundError);
  });

  it('downloads {shopId}/{type}.html from the legal bucket', async () => {
    await LegalDocumentPage({ params: Promise.resolve({ type: 'privacy' }) });
    expect(downloadSpy).toHaveBeenCalledWith('legal/shop-123/privacy.html');
  });

  it('renders a stored document with hostile markup stripped out', async () => {
    downloadResult = {
      data: { text: async () => '<h1>Regulamin</h1><script>alert(1)</script><img src=x onerror=alert(1)>' },
      error: null,
    };
    const element = await LegalDocumentPage({ params: Promise.resolve({ type: 'terms' }) });
    const { renderToStaticMarkup } = await import('react-dom/server');
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Regulamin');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
  });
});
