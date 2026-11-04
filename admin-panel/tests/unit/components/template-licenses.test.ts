// @vitest-environment happy-dom
/** Premium template key entry: format check and replacement confirmation (W148-6). @see TemplateLicenses.tsx */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TemplateLicenses from '@/components/storefront-editor/TemplateLicenses';
import { templateKeyFormatError } from '@/lib/storefront-templates/template-license-policy';
import { templateCredentialInputSchema } from '@/lib/storefront-templates/template-credentials';
import pl from '@/messages/pl.json';

vi.mock('@/lib/storefront-templates/template-license-snapshot', () => ({ getTemplateLicenseStatus: vi.fn(), invalidateTemplateLicense: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createPlatformClient: vi.fn() }));
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const keyFor = (templateId: string) => `${b64({ v: 1, kid: 'k', product: 'p', email: 'e@example.test', order: 'o', tier: 'standard', iat: 1, exp: null, templateId, domain: 'shop.example.test', edition: 'standard' })}.c2lnbmF0dXJl`;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
    ? new Response('{}', { status: 200 })
    : new Response(JSON.stringify({ statuses: [{ templateId: 'storefront-a', state: 'valid', verifiedAt: null }, { templateId: 'storefront-b', state: 'missing', verifiedAt: null }] })));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
function setup() {
  render(React.createElement(NextIntlClientProvider, { locale: 'pl', messages: pl }, React.createElement(TemplateLicenses)));
  return { key: screen.getByLabelText(pl.templateLicenses.key), template: screen.getByLabelText(pl.templateLicenses.template) };
}

it('classifies key formats before anything is stored', () => {
  expect(templateKeyFormatError('abc', 'storefront-a')).toBe('format');
  expect(templateKeyFormatError(keyFor('storefront-b'), 'storefront-a')).toBe('template');
  expect(templateKeyFormatError(`  ${keyFor('storefront-a')}\n`, 'storefront-a')).toBeNull();
  expect(templateCredentialInputSchema.safeParse({ templateId: 'storefront-a', token: 'abc' }).success).toBe(false);
  expect(templateCredentialInputSchema.safeParse({ templateId: 'storefront-a', token: keyFor('storefront-c') }).success).toBe(false);
  expect(templateCredentialInputSchema.safeParse({ templateId: 'storefront-a', token: keyFor('storefront-a') }).success).toBe(true);
});

it('refuses a malformed key without overwriting the stored one', async () => {
  const { key } = setup();
  await waitFor(() => expect(screen.getByText(pl.templateLicenses.states.valid)).toBeTruthy());
  fireEvent.change(key, { target: { value: 'abc' } });
  fireEvent.submit(key.closest('form')!);
  expect(await screen.findByText(pl.templateLicenses.badFormat)).toBeTruthy();
  expect(key.getAttribute('aria-invalid')).toBe('true');
  expect(posts()).toHaveLength(0);
});

it('asks before replacing a key that is already stored', async () => {
  const { key } = setup();
  await waitFor(() => expect(screen.getByText(pl.templateLicenses.states.valid)).toBeTruthy());
  fireEvent.change(key, { target: { value: keyFor('storefront-a') } });
  fireEvent.submit(key.closest('form')!);
  expect(await screen.findByText(pl.templateLicenses.confirmReplace)).toBeTruthy();
  expect(posts()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: pl.templateLicenses.replace }));
  await waitFor(() => expect(posts()).toHaveLength(1));
});

it('saves a first key for a template without a confirmation step', async () => {
  const { key, template } = setup();
  await waitFor(() => expect(screen.getByText(pl.templateLicenses.states.valid)).toBeTruthy());
  fireEvent.change(template, { target: { value: 'storefront-b' } });
  fireEvent.change(key, { target: { value: keyFor('storefront-b') } });
  fireEvent.submit(key.closest('form')!);
  await waitFor(() => expect(posts()).toHaveLength(1));
});
