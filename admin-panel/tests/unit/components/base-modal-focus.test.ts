// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BaseModal from '@/components/ui/BaseModal';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
afterEach(cleanup);
it('opens on the requested control and restores focus to the opener', () => {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  const props = { isOpen: true, onClose: vi.fn(), initialFocusSelector: '#initial-control' };
  const view = render(createElement(BaseModal, props,
    createElement('button', {}, 'First'),
    createElement('input', { id: 'initial-control', 'aria-label': 'Initial control' }),
  ));
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Initial control' }));
  view.unmount();
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});

it('preserves the initial focus placed by dialog content', () => {
  render(createElement(BaseModal, { isOpen: true, onClose: vi.fn() },
    createElement('button', {}, 'First'),
    createElement('input', { 'aria-label': 'Details', autoFocus: true }),
  ));
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Details' }));
});

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
