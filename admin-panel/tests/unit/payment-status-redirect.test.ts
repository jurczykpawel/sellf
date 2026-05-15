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
    // Seller-aware redirect: uses productUrl() helper instead of hardcoded /p/
    expect(countdownSource).toMatch(/router\.push\(productUrl\(productSlug/);
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
  // After the funnel-downsell-and-attribution migration, the OTO interstitial
  // was cut: page.tsx redirects server-side to /checkout/<upsell_slug>, so the
  // view no longer renders an OtoOfferSection. These assertions guard against
  // the interstitial being re-introduced.
  it('renders success branch when paymentStatus=completed AND accessGranted (server is authoritative)', () => {
    expect(viewSource).toMatch(
      /paymentStatus\s*===\s*'completed'\s*&&\s*accessGranted\)/,
    );
    expect(viewSource).not.toMatch(
      /paymentStatus\s*===\s*'completed'\s*&&\s*accessGranted\s*&&\s*auth\.isAuthenticated/,
    );
    expect(viewSource).toContain('<SuccessStatus');
    expect(viewSource).toContain('countdown={countdown}');
  });

  it('handles guest magic_link_sent status with MagicLinkStatus (no OTO gate)', () => {
    expect(viewSource).toMatch(/paymentStatus\s*===\s*'magic_link_sent'/);
    expect(viewSource).toContain('<MagicLinkStatus');
    expect(viewSource).toContain('redirectUrl={redirectUrl}');
  });

  it('no longer renders an OTO interstitial section', () => {
    // Regression guard: these symbols belonged to the deleted interstitial UI.
    expect(viewSource).not.toContain('OtoOfferSection');
    expect(viewSource).not.toContain('hasOtoOffer');
    expect(viewSource).not.toContain('handleOtoSkip');
    expect(viewSource).not.toContain('showOtoForGuest');
  });
});

// =============================================================================
// page.tsx (server) — OTO offer calculation and redirect logic
// =============================================================================

describe('Payment status page.tsx — source verification', () => {
  it('checks customer already-owns-upsell short-circuit before redirecting', () => {
    expect(pageSource).toContain('customerHasOtoAccess');
    expect(pageSource).toContain("from('user_product_access')");
    expect(pageSource).toContain('oto_product_id');
    expect(pageSource).toContain('buildOtoRedirectUrl');
  });

  it('redirects server-side to OTO checkout instead of rendering an interstitial', () => {
    // Regression guard: the funnel-downsell migration deleted the interstitial
    // (OtoOfferInfo + OtoOfferSection). page.tsx must use Next's redirect()
    // helper so the buyer never sees a separate offer page.
    expect(pageSource).toContain("import { redirect } from 'next/navigation'");
    expect(pageSource).toMatch(/redirect\(otoRedirect\.url\)/);
    expect(pageSource).not.toContain('otoOfferInfo');
    expect(pageSource).not.toContain('OtoOfferInfo');
  });

  it('forwards downsell branch params to buildOtoRedirectUrl when set', () => {
    expect(pageSource).toContain('downsellCouponCode: otoInfo.downsell_code');
    expect(pageSource).toContain('downsellProductSlug: otoInfo.downsell_product_slug');
  });

  it('calculates isSuccessfulPayment and uses success_redirect_url for non-OTO paths', () => {
    expect(pageSource).toMatch(
      /isSuccessfulPayment\s*=\s*\(accessGranted\s*&&\s*paymentStatus\s*===\s*'completed'\)\s*\|\|\s*paymentStatus\s*===\s*'magic_link_sent'/,
    );
    expect(pageSource).toContain('product.success_redirect_url');
    expect(pageSource).toContain('buildSuccessRedirectUrl');
  });

  it('uses success_redirect_url with open redirect protection', () => {
    expect(pageSource).toContain("decoded.startsWith('/')");
    expect(pageSource).toContain("decoded.startsWith('//')");
    expect(pageSource).toContain("decoded.toLowerCase().includes('javascript:')");
    expect(pageSource).toContain("decoded.includes('://')");
  });

  it('passes finalRedirectUrl to PaymentStatusView (no otoOffer prop)', () => {
    expect(pageSource).toContain('redirectUrl={finalRedirectUrl}');
    expect(pageSource).not.toContain('otoOffer=');
  });
});
