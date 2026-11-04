// @vitest-environment happy-dom
/** B2 (W146): an invisible ALTCHA widget reset after a failed attempt must verify again, otherwise the submit button stays on "Verifying…" forever. */
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('altcha', () => ({}));
import AltchaWidget from '@/components/captcha/AltchaWidget';
afterEach(cleanup);

it('re-runs verification right after an external reset', () => {
  const reset = vi.fn();
  const verify = vi.fn(async () => null);
  const proto = (globalThis.HTMLElement.prototype as unknown) as Record<string, unknown>;
  proto.reset = reset; proto.verify = verify;
  try {
    const view = render(createElement(AltchaWidget, { onVerify: vi.fn(), resetTrigger: 0 }));
    expect(verify).not.toHaveBeenCalled();
    view.rerender(createElement(AltchaWidget, { onVerify: vi.fn(), resetTrigger: 1 }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledTimes(1);
  } finally { delete proto.reset; delete proto.verify; }
});
