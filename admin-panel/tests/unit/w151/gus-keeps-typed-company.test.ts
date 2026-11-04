// @vitest-environment happy-dom
/**
 * B9 (W146): a GUS lookup that fails (503 when GUS is not configured) or answers late must never
 * erase or block what the buyer typed in the company fields.
 * @see src/hooks/useInvoiceData.ts
 * @see src/components/checkout/InvoiceFields.tsx
 */
import { createElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { useInvoiceData } from '@/hooks/useInvoiceData';
import InvoiceFields from '@/components/checkout/InvoiceFields';
import type { GusLookupResult } from '@/lib/gus/lookup';

const h = vi.hoisted(() => ({ resolve: null as null | ((value: GusLookupResult) => void) }));
vi.mock('@/lib/gus/lookup', () => ({ lookupCompanyByNip: vi.fn(() => new Promise((resolve) => { h.resolve = resolve; })) }));
vi.mock('next-intl', () => { const translate = (key: string) => key; return { useTranslations: () => translate, useLocale: () => 'pl' }; });
afterEach(() => { cleanup(); h.resolve = null; });

const gus = { nazwa: 'GUS SP. Z O.O.', ulica: 'ul. Prosta', nrNieruchomosci: '1', nrLokalu: '', miejscowosc: 'Warszawa', kodPocztowy: '00-001', regon: '1', nip: '5260250274' };

async function typeDuringLookup(outcome: GusLookupResult) {
  const { result } = renderHook(() => useInvoiceData(undefined));
  act(() => { result.current.setCountry('PL'); result.current.setNip('5260250274'); });
  let pending!: Promise<void>;
  act(() => { pending = result.current.handleNIPBlur(); });
  act(() => { result.current.setCompanyName('Moja Firma'); result.current.setCity('Kraków'); });
  await act(async () => { h.resolve!(outcome); await pending; });
  return result.current;
}

it('keeps the typed company name when GUS fails', async () => {
  const state = await typeDuringLookup({ ok: false, code: 'not_configured' });
  expect(state.companyName).toBe('Moja Firma');
  expect(state.city).toBe('Kraków');
});

it('does not overwrite fields the buyer typed while GUS was answering, fills only the empty ones', async () => {
  const state = await typeDuringLookup({ ok: true, data: gus });
  expect(state.companyName).toBe('Moja Firma');
  expect(state.city).toBe('Kraków');
  expect(state.postalCode).toBe('00-001');
});

it('leaves the company fields editable while the lookup runs', () => {
  const { result } = renderHook(() => useInvoiceData(undefined));
  act(() => { result.current.setCountry('PL'); result.current.setNip('5260250274'); result.current.setCompanyName('X'); });
  const view = render(createElement(InvoiceFields, { invoice: { ...result.current, isLoadingGUS: true } }));
  for (const id of ['companyName', 'address', 'postalCode', 'city']) {
    const input = view.container.querySelector(`#${id}`) as HTMLInputElement | null;
    expect(input, id).not.toBeNull();
    expect(input!.disabled, id).toBe(false);
  }
});
