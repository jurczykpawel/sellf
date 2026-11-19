// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TutorialMenu from '@/components/tutorials/TutorialMenu';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/components/tutorials/TutorialProvider', () => ({ useTutorials: () => ({ available: [], start: vi.fn() }) }));
vi.mock('next/link', () => ({ default: 'a' }));
afterEach(cleanup);
it('keeps a live help opener when its product-form link disappears', () => {
  render(createElement(TutorialMenu));
  const trigger = screen.getByTestId('tutorial-menu-button');
  fireEvent.click(trigger);
  const link = screen.getByTestId('tutorial-link-product-form');
  link.focus();
  fireEvent.click(link);
  expect(link.isConnected).toBe(false);
  expect(document.activeElement).toBe(trigger);
});
