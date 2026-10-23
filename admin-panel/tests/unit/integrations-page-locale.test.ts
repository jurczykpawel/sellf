/** Integration headings use the same locale as the form. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator } from 'next-intl';
import { expect, it, vi } from 'vitest';
import IntegrationsPage from '@/app/[locale]/dashboard/integrations/page';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
const state = vi.hoisted(() => ({ locale: 'pl' }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => createTranslator({ locale: state.locale, messages: state.locale === 'pl' ? pl : en, namespace: 'integrations' }) }));
vi.mock('@/lib/auth-server', () => ({ verifyAdminAccess: vi.fn() }));
vi.mock('@/lib/actions/integrations', () => ({ getIntegrationsConfig: async () => ({ success: true, data: null }) }));
vi.mock('@/components/IntegrationsForm', () => ({ default: () => null }));
it.each(['pl', 'en'])('renders the integrations heading in %s', async locale => {
  state.locale = locale;
  const html = renderToStaticMarkup(await IntegrationsPage());
  const messages = locale === 'pl' ? pl : en;
  expect(html).toContain(renderToStaticMarkup(React.createElement('h1', { className: 'text-2xl font-bold text-sf-heading' }, messages.integrations.title)));
  expect(html).toContain(messages.integrations.subtitle);
});
