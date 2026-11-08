// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BaseModal from '@/components/ui/BaseModal';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
afterEach(cleanup);
it('names the dialog, focuses inside, traps Tab, closes with Escape and restores focus', () => {
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
  const close = vi.fn();
  const props = { isOpen: true, onClose: close, labelledBy: 'title', showCloseButton: false };
  const view = render(createElement(BaseModal, props, createElement('h2', { id: 'title' }, 'Details'), createElement('button', {}, 'First'), createElement('button', {}, 'Last')));
  expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBe('title');
  expect(document.activeElement).toBe(screen.getByText('First'));
  screen.getByText('Last').focus(); fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
  expect(document.activeElement).toBe(screen.getByText('First'));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' }); expect(close).toHaveBeenCalledOnce();
  view.unmount(); expect(document.activeElement).toBe(trigger); trigger.remove();
});
