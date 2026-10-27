// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AltchaWidget from '@/components/captcha/AltchaWidget';

vi.mock('altcha', () => ({}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
afterEach(cleanup);
it('announces pending verification, completion, errors and a new attempt', () => {
  const onVerify = vi.fn(), onError = vi.fn();
  const view = render(createElement(AltchaWidget, { onVerify, onError, resetTrigger: 0 }));
  const widget = view.container.querySelector('altcha-widget')!;
  expect(screen.getByRole('status').textContent).toBe('verifying');
  expect(widget.getAttribute('form')).toBeTruthy();
  expect(document.getElementById(widget.getAttribute('form')!)).toBeNull();
  fireEvent(widget, new CustomEvent('statechange', { detail: { state: 'verified', payload: 'solved' } }));
  expect(onVerify).toHaveBeenCalledWith('solved');
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent(widget, new CustomEvent('statechange', { detail: { state: 'error' } }));
  expect(onError).toHaveBeenCalledOnce();
  expect(screen.getByRole('alert').textContent).toBe('securityVerificationFailed');
  view.rerender(createElement(AltchaWidget, { onVerify, onError, resetTrigger: 1 }));
  expect(screen.getByRole('status').textContent).toBe('verifying');
});
