// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { TutorialId } from '@/lib/tutorials/registry';
import BaseModal from '@/components/ui/BaseModal';
import TutorialProvider, { useTutorials } from '@/components/tutorials/TutorialProvider';
const mock = vi.hoisted(() => ({ config: null as any, moveNext: vi.fn(), destroy: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/actions/tutorial-progress', () => ({ markTutorialSeen: vi.fn() }));
vi.mock('driver.js', () => ({ driver: (config: any) => { mock.config = config; return { drive: vi.fn(), destroy: mock.destroy, moveNext: mock.moveNext, isLastStep: () => true, getActiveElement: () => undefined }; } }));
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
afterEach(() => { mock.config?.onDestroyed(); cleanup(); mock.config = null; vi.clearAllMocks(); document.body.removeAttribute('tabindex'); });
function Start({ id }: { id: TutorialId }) {
  const tutorials = useTutorials();
  return React.createElement('button', { onClick: () => { document.body.tabIndex = -1; document.body.focus(); tutorials!.start(id); } }, 'start after navigation');
}
async function setup(id: TutorialId = 'payments-orders') {
  render(React.createElement(TutorialProvider, { initialSeen: [], autoStart: false, children: [React.createElement('button', { key: 'menu', 'data-testid': 'tutorial-menu-button' }, 'help'), React.createElement(Start, { key: 'start', id })] }));
  fireEvent.click(screen.getByText('start after navigation'));
  await waitFor(() => expect(mock.config).toBeTruthy());
}
it('finishes when Done is shown even if the final reveal target is absent', async () => {
  await setup();
  await mock.config.onNextClick(undefined, undefined, { driver: { isLastStep: () => true, moveNext: mock.moveNext, destroy: mock.destroy }, state: { activeIndex: 5 } });
  expect(mock.destroy).toHaveBeenCalledOnce();
  expect(mock.moveNext).not.toHaveBeenCalled();
});
it('returns focus to the persistent help button after a tutorial started by navigation closes', async () => {
  await setup();
  mock.config.onDestroyed();
  // driver.js restores the element it captured after invoking onDestroyed.
  document.body.focus();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('tutorial-menu-button')));
});

it('keeps a required setup action open when driver skips all hidden following steps', async () => {
  await setup('b2b-checkout-profile');
  const description = document.createElement('div');
  await mock.config.onNextClick(undefined, undefined, { driver: { isLastStep: () => true, moveNext: mock.moveNext, destroy: mock.destroy }, state: { activeIndex: 1, popover: { description } } });
  await waitFor(() => expect(description.textContent).toBe('mustAct'));
  expect(mock.destroy).not.toHaveBeenCalled();
  expect(mock.moveNext).not.toHaveBeenCalled();
});

it.each([true, false])('Escape closes only the tutorial above an open modal and then permits the modal to close (destroy callback: %s)', async (notifiesDestroyed) => {
  const close = vi.fn();
  mock.destroy.mockImplementation(() => { if (notifiesDestroyed) mock.config.onDestroyed(); });
  render(React.createElement(TutorialProvider, { initialSeen: [], autoStart: false,
    children: React.createElement(BaseModal, { isOpen: true, onClose: close,
      children: React.createElement(Start, { id: 'b2b-checkout-profile' }) }) }));
  fireEvent.click(screen.getByText('start after navigation'));
  await waitFor(() => expect(mock.config).toBeTruthy());
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyUp(document, { key: 'Escape' });
  expect(mock.destroy).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
});

it('centres the highlighted target before positioning its stage, including targets under a sticky bar', async () => {
  await setup('storefront-templates');
  const target = document.createElement('button');
  const scroll = vi.fn();
  target.scrollIntoView = scroll;
  mock.config.onHighlightStarted?.(target);
  expect(scroll).toHaveBeenCalledWith({ block: 'center', inline: 'nearest', behavior: 'instant' });
});
