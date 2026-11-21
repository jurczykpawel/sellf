// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePaymentStatus } from '@/app/[locale]/p/[slug]/payment-status/hooks/usePaymentStatus';
vi.mock('@/lib/supabase/client', () => ({ createClient: () => new Promise(() => {}) }));
vi.mock('@/app/[locale]/p/[slug]/payment-status/hooks/useMagicLink', () => ({ useMagicLink: () => ({ sent: false }) }));
vi.mock('@/app/[locale]/p/[slug]/payment-status/hooks/useTerms', () => ({ useTerms: () => ({}) }));
vi.mock('@/app/[locale]/p/[slug]/payment-status/hooks/useTurnstile', () => ({ useTurnstile: () => ({}) }));

vi.mock('next-intl', () => ({ useLocale: () => 'en' }));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
afterEach(() => { cleanup(); vi.useRealTimers(); });
it.each([true, false])('uses server access (%s) without waiting for a client session read', async accessGranted => {
  vi.useFakeTimers();
  const { result } = renderHook(() => usePaymentStatus({ paymentStatus: 'completed', accessGranted,
    product: { id: 'product', slug: 'free-product', name: 'Free product', description: '', icon: '', price: 0, currency: 'PLN' },
    redirectUrl: 'https://shop.example.com/offer' }));
  const initial = result.current.countdown;
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(result.current.countdown).toBe(initial - (accessGranted ? 1 : 0));
});
