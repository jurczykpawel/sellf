// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/components/providers/config-provider', () => ({ useConfig: () => ({ captcha: { provider: 'none' } }) }));
vi.mock('@/components/TurnstileWidget', () => ({ default: () => null }));
vi.mock('@/components/captcha/AltchaWidget', () => ({ default: () => null }));
import CaptchaWidget from '@/components/captcha/CaptchaWidget';
afterEach(cleanup);
it('makes a form ready again after a request resets verification with no provider configured', () => {
  const onVerify = vi.fn();
  const view = render(createElement(CaptchaWidget, { onVerify, resetTrigger: 0 }));
  expect(onVerify).toHaveBeenCalledTimes(1);
  view.rerender(createElement(CaptchaWidget, { onVerify, resetTrigger: 1 }));
  expect(onVerify).toHaveBeenCalledTimes(2);
  expect(onVerify).toHaveBeenLastCalledWith('captcha-disabled');
});
