// @vitest-environment happy-dom
/** Free checkout keeps the page language in its auth request. */
import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { useFreeAccess } from '@/hooks/useFreeAccess';
import type { Product } from '@/types';
const submit = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('next-intl', () => ({ useLocale: () => 'pl', useTranslations: () => (key: string) => key }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/hooks/useCaptcha', () => ({ useCaptcha: () => ({ token: 'ready', reset: vi.fn() }) }));
vi.mock('@/hooks/useTracking', () => ({ useTracking: () => ({ track: vi.fn() }) }));
vi.mock('@/lib/auth/magic-link/submit', () => ({ submitMagicLink: submit }));
afterEach(cleanup);
it('passes the page locale for a PWYW free request', async () => {
  const { result } = renderHook(() => useFreeAccess({ user: null, product: { slug: 'course' } as Product, onAccessGranted: vi.fn(), onError: vi.fn() }));
  act(() => { result.current.setPwywFreeEmail('buyer@example.com'); result.current.setPwywFreeTermsAccepted(true); });
  await act(async () => { await result.current.handlePwywFreeMagicLink(); });
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ locale: 'pl', flow: 'free_product' }));
});
it('passes the page locale from the free product form', () => {
  const source = readFileSync('src/app/[locale]/checkout/[slug]/components/FreeProductForm.tsx', 'utf8');
  expect(source.match(/submitMagicLink\(\{([^}]+)\}/)?.[1]).toMatch(/\blocale\b/);
});
