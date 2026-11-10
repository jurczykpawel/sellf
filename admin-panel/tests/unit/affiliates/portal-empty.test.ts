import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en', getTranslations: async () => (key: string) => key }));
vi.mock('@/components/DashboardLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) } }) }));
vi.mock('@/lib/affiliates/portal/service', () => ({ portalMetadata: {}, readPartnerPortal: async () => ({ success: false, error: 'not_found' }) }));
vi.mock('@/lib/affiliates/admin/actions', () => ({ getApplicationProgram: async () => ({ success: true, data: { enabled: true } }) }));
import Page from '@/app/[locale]/my-affiliate/page';
it('presents a missing partner account as an empty screen with a heading and next step', async () => {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('<h1');
  expect(html).toContain('/en/affiliates/apply');
  expect(html).not.toContain('role="alert"');
});
