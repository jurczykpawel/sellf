// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import PlayerstackEmbed from '@/components/player/PlayerstackEmbed';
afterEach(() => { cleanup(); vi.restoreAllMocks(); document.querySelectorAll('script[data-sellf-playerstack]').forEach(node => node.remove()); });
it.each(['pl', 'en'] as const)('shows localized loading and provider error in %s', async locale => {
  let script: HTMLScriptElement | undefined;
  vi.spyOn(document.head, 'appendChild').mockImplementation(node => { script = node as HTMLScriptElement; return node; });
  render(createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en }, createElement(PlayerstackEmbed, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Video' })));
  expect(screen.getByTestId('playerstack-loading').textContent).toBe(locale === 'pl' ? 'Ładowanie filmu…' : 'Loading video…');
  expect(script).toBeTruthy();
  script!.dispatchEvent(new Event('error'));
  await waitFor(() => expect(screen.getByText(locale === 'pl' ? 'Film jest niedostępny' : 'Video unavailable')).toBeTruthy());
});
