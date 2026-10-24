// @vitest-environment happy-dom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MagicLinkStatus from '@/app/[locale]/p/[slug]/payment-status/components/MagicLinkStatus';
import { useMagicLink } from '@/app/[locale]/p/[slug]/payment-status/hooks/useMagicLink';

vi.mock('@/components/captcha/CaptchaWidget', () => ({ default: () => null }));
vi.mock('next-intl', () => ({ useLocale: () => 'pl', useTranslations: () => (key: string) => key }));

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('payment status magic link retry', () => {
  it.each([[500, 'send_failed'], [429, 'rate_limited']] as const)('recovers after %i with a fresh captcha', async (status, code) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status, json: async () => ({ code }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const reset = vi.fn();
    const { result, rerender } = renderHook(({ token }) => useMagicLink({
      paymentStatus: 'magic_link_sent', customerEmail: 'buyer@example.com', sessionId: 'cs_test',
      product: { id: 'p', name: 'Product', slug: 'product', description: '', icon: '', price: 10, currency: 'PLN' },
      termsAccepted: true, captchaToken: token, captchaReset: reset, showInteractiveWarning: false,
    }), { initialProps: { token: 'first' as string | null } });
    await act(async () => {});
    expect(result.current.error).toBe(code === 'rate_limited' ? 'paidLinkRateLimitError' : 'paidLinkSendError');
    expect(reset).toHaveBeenCalledOnce();
    rerender({ token: null });
    await act(async () => { await result.current.sendMagicLink(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    rerender({ token: 'fresh' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (status === 429) {
      expect(result.current.retryCountdown).toBe(60);
      await act(async () => { await result.current.sendMagicLink(); });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      for (let second = 0; second < 60; second++) {
        await act(async () => { vi.advanceTimersByTime(1000); });
      }
    }
    await act(async () => { await result.current.sendMagicLink(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.sent).toBe(true);
    expect(result.current.error).toBeNull();
  });
});

it('offers retry with a countdown and disables sending until ready', () => {
  const send = vi.fn(async () => {});
  const props = {
    product: { id: 'p', name: 'Product', slug: 'product', description: '', icon: '', price: 10, currency: 'PLN' },
    customerEmail: 'buyer@example.com', magicLinkSent: false, termsAccepted: true,
    captchaToken: 'fresh', captchaError: null, captchaTimeout: false, showInteractiveWarning: false,
    magicLinkError: 'Zakup jest opłacony; nie udało się wysłać linku logowania.', retryCountdown: 60, sending: false,
    onTermsAccept: vi.fn(), onCaptchaSuccess: vi.fn(), onCaptchaError: vi.fn(), onCaptchaTimeout: vi.fn(),
    onBeforeInteractive: vi.fn(), onAfterInteractive: vi.fn(), sendMagicLink: send,
  };
  const { rerender } = render(createElement(MagicLinkStatus, props));
  expect(screen.getByText(/Zakup jest opłacony/)).toBeTruthy();
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('button').textContent).toBe('resendLinkCountdown');
  rerender(createElement(MagicLinkStatus, { ...props, retryCountdown: 0 }));
  fireEvent.click(screen.getByRole('button', { name: 'resendLoginLink' }));
  expect(send).toHaveBeenCalledOnce();
  rerender(createElement(MagicLinkStatus, { ...props, retryCountdown: 0, captchaToken: '' }));
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
});
