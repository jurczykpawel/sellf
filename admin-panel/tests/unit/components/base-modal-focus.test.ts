// @vitest-environment happy-dom
import { createElement, StrictMode } from 'react';
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


it('does not move focus when the initial selector changes in an open dialog', () => {
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
  const props = { isOpen: true, onClose: vi.fn(), showCloseButton: false };
  const contents = [createElement('input', { key: 'a', id: 'first', 'aria-label': 'First' }), createElement('button', { key: 'b', id: 'second' }, 'Second')];
  const view = render(createElement(BaseModal, { ...props, initialFocusSelector: '#first' }, contents));
  screen.getByRole('button', { name: 'Second' }).focus();
  view.rerender(createElement(BaseModal, { ...props, initialFocusSelector: 'input' }, contents));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Second' }));
  trigger.focus();
  view.rerender(createElement(BaseModal, { ...props, initialFocusSelector: '#first' }, contents));
  expect(document.activeElement).toBe(trigger);
  view.rerender(createElement(BaseModal, { ...props, isOpen: false, initialFocusSelector: '#first' }, contents));
  view.rerender(createElement(BaseModal, { ...props, initialFocusSelector: '#second' }, contents));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Second' }));
  view.unmount(); expect(document.activeElement).toBe(trigger); trigger.remove();
});

it.each([false, true])('restores the opener even with autoFocus content (initially closed: %s)', initiallyClosed => {
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
  const content = (isOpen: boolean) => createElement(StrictMode, null,
    createElement(BaseModal, { isOpen, onClose: vi.fn() }, createElement('input', { autoFocus: true, 'aria-label': 'Automatic focus' })));
  const view = render(content(!initiallyClosed));
  if (initiallyClosed) view.rerender(content(true));
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Automatic focus' }));
  view.rerender(content(false));
  expect(document.activeElement).toBe(trigger);
  const secondTrigger = document.createElement('button'); document.body.append(secondTrigger); secondTrigger.focus();
  view.rerender(content(true));
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Automatic focus' }));
  view.unmount(); expect(document.activeElement).toBe(secondTrigger); trigger.remove(); secondTrigger.remove();
});
