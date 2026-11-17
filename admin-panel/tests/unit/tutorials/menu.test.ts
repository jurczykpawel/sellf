// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TutorialMenu from '@/components/tutorials/TutorialMenu';
import { TUTORIALS, TUTORIAL_IDS } from '@/lib/tutorials/registry';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/components/tutorials/TutorialProvider', () => ({ useTutorials: () => ({ available: [], start: vi.fn() }) }));
vi.mock('next/link', () => ({ default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => React.createElement('a', props) }));
afterEach(cleanup);
it('carries every menu request to the destination, including form tutorials', () => {
  render(React.createElement(TutorialMenu));
  fireEvent.click(screen.getByTestId('tutorial-menu-button'));
  for (const id of TUTORIAL_IDS) {
    const url = new URL(screen.getByTestId(`tutorial-link-${id}`).getAttribute('href')!, 'https://example.com');
    expect(url.searchParams.get('tutorial'), id).toBe(id);
    expect(url.searchParams.get('open'), id).toBe('opensNewForm' in TUTORIALS[id] ? 'new' : null);
  }
  // Form tutorials need an open product form: the menu link opens a new one.
  for (const id of ['events', 'b2b-checkout-profile', 'product-form'] as const) expect('opensNewForm' in TUTORIALS[id], id).toBe(true);
});
