// @vitest-environment happy-dom
/**
 * REG-rc4-C a11y regressions (W344):
 * - C-B1: login error alert must use theme status tokens (AA in light AND dark) and role="alert".
 * - U4: payment-status "To access your product" heading must not pulse its opacity (3.29:1 measured).
 * - U3: icon-only FilterBar buttons (labels hidden on phones) need an aria-label.
 * @see src/components/LoginPage.tsx
 * @see src/app/[locale]/p/[slug]/payment-status/components/MagicLinkStatus.tsx
 * @see src/components/FilterBar.tsx
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, createRef } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '@/components/LoginPage';
import MagicLinkStatus from '@/app/[locale]/p/[slug]/payment-status/components/MagicLinkStatus';
import FilterBar from '@/components/FilterBar';
import { compositeOver, contrastRatio, parseColor } from '@/lib/themes/contrast';

let search = 'error=magic_link_expired';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock('next-intl', () => ({ useLocale: () => 'pl', useTranslations: () => (key: string) => key }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('@/components/providers/config-provider', () => ({ useConfig: () => ({ demoMode: false, passwordLoginEnabled: false, oauthProviders: [] }) }));
vi.mock('@/components/SiteMenu', () => ({ default: () => null }));
vi.mock('@/components/LoginForm', () => ({ default: () => null }));
vi.mock('@/components/captcha/CaptchaWidget', () => ({ default: () => null }));

afterEach(() => cleanup());

const css = readFileSync(join(__dirname, '../../src/app/globals.css'), 'utf8');
const darkBlock = css.slice(css.indexOf(':root {'), css.indexOf(':root:not(.dark)'));
const lightBlock = css.slice(css.indexOf(':root:not(.dark)'));
const themeBlock = css.slice(css.indexOf('@theme {'));
function token(block: string, name: string): string {
  const m = block.match(new RegExp(`${name}:\\s*([^;]+);`));
  return m ? m[1].trim() : '';
}
/** Resolve a --color-sf-* token for a mode: explicit override first, else the @theme var() alias. */
function resolve(mode: 'dark' | 'light', name: string): string {
  const block = mode === 'dark' ? darkBlock : lightBlock;
  const direct = token(block, `--color-${name}`);
  if (direct && !direct.startsWith('var(')) return direct;
  const alias = token(themeBlock, `--color-${name}`).match(/var\((--[^)]+)\)/)?.[1];
  return alias ? token(block, alias) : '';
}

describe('C-B1 login error/success alert', () => {
  it('error alert has role=alert and uses only theme status tokens', () => {
    search = 'error=magic_link_expired';
    render(createElement(LoginPage));
    const alert = screen.getByRole('alert');
    expect(alert.outerHTML).not.toMatch(/text-red-\d|text-green-\d/);
    expect(alert.className).toContain('text-sf-danger');
    expect(alert.className).toContain('bg-sf-danger-soft');
  });

  it('success alert uses theme status tokens', () => {
    search = 'message=payment_completed_login_required';
    const { container } = render(createElement(LoginPage));
    expect(container.innerHTML).not.toMatch(/text-red-\d|text-green-\d/);
    expect(container.innerHTML).toContain('text-sf-success');
  });

  it.each(['dark', 'light'] as const)('danger/success text on its soft background is >= 4.5:1 (%s)', (mode) => {
    const base = parseColor(token(mode === 'dark' ? darkBlock : lightBlock, '--sf-bg-deep'));
    for (const status of ['danger', 'success']) {
      const soft = compositeOver(parseColor(resolve(mode, `sf-${status}-soft`)), base);
      expect(contrastRatio(resolve(mode, `sf-${status}`), soft), `${status} ${mode}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('U4 payment-status access heading', () => {
  it('does not animate opacity on the heading text', () => {
    render(createElement(MagicLinkStatus, {
      product: { id: 'p', name: 'Product', slug: 'product', description: '', icon: '', price: 10, currency: 'PLN' },
      customerEmail: 'buyer@example.com', magicLinkSent: true, termsAccepted: true,
      captchaToken: 'ok', captchaError: null, captchaTimeout: false, showInteractiveWarning: false,
      magicLinkError: null, retryCountdown: 0, sending: false,
      onTermsAccept: vi.fn(), onCaptchaSuccess: vi.fn(), onCaptchaError: vi.fn(), onCaptchaTimeout: vi.fn(),
      onBeforeInteractive: vi.fn(), onAfterInteractive: vi.fn(), sendMagicLink: vi.fn(async () => {}),
    }));
    const heading = screen.getByRole('heading', { name: /toAccessYourProduct/ });
    expect(heading.className).not.toMatch(/animate-pulse|opacity-/);
  });
});

describe('U3 FilterBar icon buttons', () => {
  it('every action button has an aria-label matching its translation', () => {
    render(createElement(FilterBar, {
      searchTerm: '', onSearchChange: vi.fn(), statusFilter: 'all', onStatusFilterChange: vi.fn(),
      onAddProduct: vi.fn(), onAddBundle: vi.fn(), onExport: vi.fn(), onRefresh: vi.fn(),
      addButtonRef: createRef<HTMLButtonElement>(),
    }));
    for (const key of ['refresh', 'export', 'addBundle', 'add']) {
      expect(screen.getByRole('button', { name: key }).getAttribute('aria-label')).toBe(key);
    }
  });
});
