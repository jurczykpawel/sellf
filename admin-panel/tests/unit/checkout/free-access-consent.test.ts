// @vitest-environment happy-dom
/** Full-discount invitation follows the consent setting shown to its buyer. */
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useFreeAccess } from '@/hooks/useFreeAccess';
import { submitMagicLink } from '@/lib/auth/magic-link/submit';
import type { Product } from '@/types';

vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/hooks/useCaptcha', () => ({ useCaptcha: () => ({ token: 'solved-local-captcha', reset: vi.fn() }) }));
vi.mock('@/hooks/useTracking', () => ({ useTracking: () => ({ track: async () => {} }) }));
vi.mock('@/lib/auth/magic-link/submit', () => ({ submitMagicLink: vi.fn(async () => ({ ok: true })) }));
afterEach(() => vi.clearAllMocks());
it.each([[false, false, true], [true, false, false], [true, true, true]])('sends the first invite only when configured consent is satisfied: setting=%s accepted=%s', async (collectTermsOfService, accepted, sends) => {
  const product = { id: crypto.randomUUID(), slug: 'full-discount', name: 'Full discount course', currency: 'PLN' } as Product;
  const { result, unmount } = renderHook(() => useFreeAccess({ user: null, product, collectTermsOfService, couponCode: 'FULL100', onAccessGranted: vi.fn(), onError: vi.fn() }));
  act(() => { result.current.setPwywFreeEmail('buyer@example.com'); result.current.setPwywFreeTermsAccepted(accepted); });
  await act(async () => result.current.handlePwywFreeMagicLink());
  if (sends) expect(submitMagicLink).toHaveBeenCalledWith(expect.objectContaining({ email: 'buyer@example.com', flow: 'free_product', productSlug: 'full-discount', couponCode: 'FULL100' }));
  else { expect(submitMagicLink).not.toHaveBeenCalled(); expect(result.current.pwywFreeMessage).toEqual({ type: 'error', text: 'pleaseAcceptTerms' }); }
  unmount();
});
