// @vitest-environment happy-dom
/** Restore dialog layout, sticky save bar backdrop, cancelled transfer notice, public 404 for transfer pages. */
import { createElement } from 'react';
import { readFileSync, existsSync } from 'node:fs';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import TransferInstructions from '@/components/checkout/TransferInstructions';
import pl from '@/messages/pl.json';
afterEach(cleanup);

describe('cancelled bank transfer page', () => {
  it('shows a prominent notice and hides payment details and print', () => {
    render(createElement(NextIntlClientProvider, { locale: 'pl', messages: pl }, createElement(TransferInstructions, { transfer: { account: 'PL61109010140000071219812874' }, amount: 12300, currency: 'PLN', cancelled: true, print: true })));
    expect(screen.getByRole('alert').textContent).toContain('Anulowane — nie wysyłaj przelewu');
    expect(screen.queryByText('Dane do przelewu')).toBeNull();
    expect(screen.queryByText('PL61 1090 1014 0000 0712 1981 2874')).toBeNull();
    expect(screen.queryByText('Drukuj / zapisz PDF')).toBeNull();
  });
  it('does not repeat the status as a plain line on the page', () => {
    const source = readFileSync('src/app/[locale]/order/[orderId]/transfer/page.tsx', 'utf8');
    expect(source).toContain("cancelled={tx.status === 'cancelled'}");
  });
});

describe('transfer page 404', () => {
  it('uses a public not-found boundary independent of the admin session', () => {
    const path = 'src/app/[locale]/order/not-found.tsx';
    expect(existsSync(path)).toBe(true);
    const source = readFileSync(path, 'utf8');
    expect(source).toContain('guestTitle');
    expect(source).not.toContain('useAuth');
    expect(source).not.toContain('adminTitle');
  });
});

describe('storefront editor layout', () => {
  it('keeps the save bar sticky on an opaque band so content never peeks under it', () => {
    const source = readFileSync('src/components/storefront-editor/StorefrontEditor.tsx', 'utf8');
    expect(source).toMatch(/sticky top-14 z-30 bg-sf-deep pb-3[^"]*"[^>]*>\s*<div data-editor-savebar/);
  });
  it('pads the restore dialog and keeps text clear of the close button', () => {
    const source = readFileSync('src/components/storefront/TemplateHistory.tsx', 'utf8');
    const css = readFileSync('src/components/storefront/TemplateHistory.module.css', 'utf8');
    expect(source).toContain('className={styles.dialog}');
    expect(css).toMatch(/\.dialog \{[^}]*padding: 24px 56px 24px 24px/);
  });
});
