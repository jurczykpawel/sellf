/**
 * Payment Status Redirect Logic Tests — Source Verification (Regression Guards)
 *
 * ============================================================================
 * WHY SOURCE VERIFICATION?
 * ============================================================================
 * The functions tested here (shouldStartCountdown, getRedirectDestination,
 * determineViewState) are inline in React hooks/components and cannot be
 * imported directly. Instead of re-implementing them (which would silently
 * diverge from production), we verify the actual source code contains the
 * expected logic patterns via readFileSync + toContain/toMatch assertions.
 *
 * These tests act as REGRESSION GUARDS: they break if someone removes or
 * renames critical security/business logic during refactors.
 * ============================================================================
 *
 * Decision table documented below for reference:
 *
 * LOGGED-IN USER (paymentStatus='completed', accessGranted=true, isAuthenticated=true):
 * | Configuration    | Owns OTO product | Expected behavior                    |
 * |------------------|------------------|--------------------------------------|
 * | OTO enabled      | No               | Show OTO offer, no redirect          |
 * | OTO enabled      | Yes              | Success page, no OTO, no redirect    |
 * | Redirect URL set | -                | Countdown → redirect to URL          |
 * | Nothing          | -                | Countdown → redirect to product page |
 *
 * GUEST USER (paymentStatus='magic_link_sent', accessGranted=false, isAuthenticated=false):
 * | Configuration    | Owns OTO product | Expected behavior                    |
 * |------------------|------------------|--------------------------------------|
 * | OTO enabled      | No               | OTO offer first, then magic link     |
 * | OTO enabled      | Yes              | Magic link only, stays on page       |
 * | Redirect URL set | -                | Magic link → countdown → redirect    |
 * | Nothing          | -                | Magic link only, stays on page       |
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PAYMENT_STATUS_DIR = resolve(
  __dirname,
  '../../src/app/[locale]/p/[slug]/payment-status',
);

const countdownSource = readFileSync(
  resolve(PAYMENT_STATUS_DIR, 'hooks/useCountdown.ts'),
  'utf-8',
);

const viewSource = readFileSync(
  resolve(PAYMENT_STATUS_DIR, 'components/PaymentStatusView.tsx'),
  'utf-8',
);

const pageSource = readFileSync(
  resolve(PAYMENT_STATUS_DIR, 'page.tsx'),
  'utf-8',
);

// =============================================================================
// useCountdown hook — countdown trigger conditions
// =============================================================================

describe('useCountdown — source verification', () => {
  it('disableAutoRedirect short-circuits the countdown (returns early)', () => {
    expect(countdownSource).toContain('if (disableAutoRedirect)');
    const earlyReturnMatch = countdownSource.match(
      /if \(disableAutoRedirect\)\s*\{[\s\S]*?return/,
    );
    expect(earlyReturnMatch).not.toBeNull();
  });

  it('authenticated success requires completed + accessGranted + isUserAuthenticated (conjunctive)', () => {
    expect(countdownSource).toMatch(
      /isAuthenticatedSuccess\s*=\s*paymentStatus\s*===\s*'completed'\s*&&\s*accessGranted\s*&&\s*isUserAuthenticated/,
    );
  });

  it('guest success requires magic_link_sent + redirectUrl + magicLinkSent (conjunctive)', () => {
    expect(countdownSource).toMatch(
      /isGuestSuccessWithRedirect\s*=\s*paymentStatus\s*===\s*'magic_link_sent'\s*&&\s*redirectUrl\s*&&\s*magicLinkSent/,
    );
  });

  it('countdown triggers on either auth success OR guest success, redirects accordingly', () => {
    expect(countdownSource).toMatch(
      /isAuthenticatedSuccess\s*\|\|\s*isGuestSuccessWithRedirect/,
    );
    expect(countdownSource).toContain('window.location.href = redirectUrl');
    expect(countdownSource).toMatch(/router\.push\(`\/p\/\$\{productSlug\}`\)/);
  });

  it('defaults disableAutoRedirect and magicLinkSent to false', () => {
    expect(countdownSource).toContain('disableAutoRedirect = false');
    expect(countdownSource).toContain('magicLinkSent = false');
  });
});

// =============================================================================
// PaymentStatusView — view state determination
// =============================================================================

describe('PaymentStatusView — source verification', () => {
  it('shows OTO offer for authenticated user when hasOtoOffer is true', () => {
    expect(viewSource).toMatch(
      /paymentStatus\s*===\s*'completed'\s*&&\s*accessGranted\s*&&\s*auth\.isAuthenticated/,
    );
    expect(viewSource).toContain('{hasOtoOffer ? (');
    expect(viewSource).toContain('<SuccessStatus');
    expect(viewSource).toContain('countdown={countdown}');
  });

  it('handles guest magic_link_sent status with OTO gate and MagicLinkStatus', () => {
    expect(viewSource).toMatch(
      /paymentStatus\s*===\s*'magic_link_sent'/,
    );
    expect(viewSource).toContain(
      'const showOtoForGuest = hasOtoOffer && !magicLink.sent',
    );
    expect(viewSource).toContain('<MagicLinkStatus');
    expect(viewSource).toContain('redirectUrl={redirectUrl}');
  });

  it('OTO skip: redirects authenticated user, sends magic link for guest', () => {
    expect(viewSource).toMatch(
      /handleOtoSkip[\s\S]*?auth\.isAuthenticated[\s\S]*?router\.push\(`\/p\/\$\{product\.slug\}`\)/,
    );
    expect(viewSource).toMatch(
      /handleOtoSkip[\s\S]*?magicLink\.sendMagicLink\(\)/,
    );
  });

  it('hasOtoOffer derives from otoOffer prop and controls disableAutoRedirect', () => {
    expect(viewSource).toMatch(
      /hasOtoOffer\s*=\s*otoOffer\?\.hasOto\s*\?\?\s*false/,
    );
    expect(viewSource).toContain('disableAutoRedirect: hasOtoOffer');
  });
});

// =============================================================================
// page.tsx (server) — OTO offer calculation and redirect logic
// =============================================================================

describe('Payment status page.tsx — source verification', () => {
  it('checks if customer already has OTO access and skips OTO accordingly', () => {
    expect(pageSource).toContain('customerHasOtoAccess');
    expect(pageSource).toContain("from('user_product_access')");
    expect(pageSource).toContain('oto_product_id');
    expect(pageSource).toMatch(
      /customerHasOtoAccess[\s\S]*?skipping OTO/,
    );
    expect(pageSource).toContain('buildOtoRedirectUrl');
  });

  it('calculates isSuccessfulPayment and determines redirect conditions', () => {
    expect(pageSource).toMatch(
      /isSuccessfulPayment\s*=\s*\(accessGranted\s*&&\s*paymentStatus\s*===\s*'completed'\)\s*\|\|\s*paymentStatus\s*===\s*'magic_link_sent'/,
    );
    expect(pageSource).toContain('!otoOfferInfo');
    expect(pageSource).toContain("otoInfo?.reason === 'already_owns_oto_product'");
    expect(pageSource).toMatch(/otoWasSkipped[\s\S]*?no redirect/);
  });

  it('uses success_redirect_url with open redirect protection', () => {
    expect(pageSource).toContain('product.success_redirect_url');
    expect(pageSource).toContain('buildSuccessRedirectUrl');
    expect(pageSource).toContain("decoded.startsWith('/')");
    expect(pageSource).toContain("decoded.startsWith('//')");
    expect(pageSource).toContain("decoded.toLowerCase().includes('javascript:')");
    expect(pageSource).toContain("decoded.includes('://')");
  });

  it('passes finalRedirectUrl and otoOfferInfo to PaymentStatusView', () => {
    expect(pageSource).toContain('redirectUrl={finalRedirectUrl}');
    expect(pageSource).toContain('otoOffer={otoOfferInfo}');
  });
});
