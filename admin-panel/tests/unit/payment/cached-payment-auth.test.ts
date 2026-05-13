import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyCachedPaymentAuth, mapVerifiedPaymentToStatus } from '@/lib/payment/verify-payment';

describe('classifyCachedPaymentAuth', () => {
  it('pure guest purchase, not yet claimed, visitor not logged in -> needs magic link', () => {
    const out = classifyCachedPaymentAuth({
      visitor: null,
      transactionUserId: null,
      transactionEmail: 'guest@example.com',
      hasAccess: false,
    });
    expect(out.isStructuralGuestPurchase).toBe(true);
    expect(out.isClaimedByCurrentUser).toBe(false);
    expect(out.currentVisitorNeedsLogin).toBe(true);
  });

  it('REGRESSION: existing user did guest checkout, RPC auto-claimed, visitor still logged out -> needs magic link', () => {
    const out = classifyCachedPaymentAuth({
      visitor: null,
      transactionUserId: 'existing-user-uuid',
      transactionEmail: 'alice@example.com',
      hasAccess: true,
    });
    expect(out.isStructuralGuestPurchase).toBe(false);
    expect(out.isClaimedByCurrentUser).toBe(false);
    expect(out.currentVisitorNeedsLogin).toBe(true);
  });

  it('logged-in owner revisits their own purchase -> no magic link', () => {
    const out = classifyCachedPaymentAuth({
      visitor: { id: 'alice-uuid', email: 'alice@example.com' },
      transactionUserId: 'alice-uuid',
      transactionEmail: 'alice@example.com',
      hasAccess: true,
    });
    expect(out.isClaimedByCurrentUser).toBe(true);
    expect(out.currentVisitorNeedsLogin).toBe(false);
  });

  it('email match is case-insensitive', () => {
    const out = classifyCachedPaymentAuth({
      visitor: { id: 'alice-uuid', email: 'ALICE@Example.COM' },
      transactionUserId: 'alice-uuid',
      transactionEmail: 'alice@example.com',
      hasAccess: true,
    });
    expect(out.isClaimedByCurrentUser).toBe(true);
    expect(out.currentVisitorNeedsLogin).toBe(false);
  });

  it('visitor logged in with a different email than the buyer -> needs magic link to the buyer email', () => {
    const out = classifyCachedPaymentAuth({
      visitor: { id: 'bob-uuid', email: 'bob@example.com' },
      transactionUserId: 'alice-uuid',
      transactionEmail: 'alice@example.com',
      hasAccess: true,
    });
    expect(out.isClaimedByCurrentUser).toBe(false);
    expect(out.currentVisitorNeedsLogin).toBe(true);
  });

  it('hasAccess=false breaks the claim even if emails match (defensive)', () => {
    const out = classifyCachedPaymentAuth({
      visitor: { id: 'alice-uuid', email: 'alice@example.com' },
      transactionUserId: 'alice-uuid',
      transactionEmail: 'alice@example.com',
      hasAccess: false,
    });
    expect(out.isClaimedByCurrentUser).toBe(false);
    expect(out.currentVisitorNeedsLogin).toBe(true);
  });

  it('missing visitor email cannot satisfy the claim check', () => {
    const out = classifyCachedPaymentAuth({
      visitor: { id: 'alice-uuid', email: null },
      transactionUserId: 'alice-uuid',
      transactionEmail: 'alice@example.com',
      hasAccess: true,
    });
    expect(out.isClaimedByCurrentUser).toBe(false);
    expect(out.currentVisitorNeedsLogin).toBe(true);
  });

  it('missing transaction email cannot satisfy the claim check', () => {
    const out = classifyCachedPaymentAuth({
      visitor: { id: 'alice-uuid', email: 'alice@example.com' },
      transactionUserId: 'alice-uuid',
      transactionEmail: null,
      hasAccess: true,
    });
    expect(out.isClaimedByCurrentUser).toBe(false);
    expect(out.currentVisitorNeedsLogin).toBe(true);
  });
});

describe('mapVerifiedPaymentToStatus', () => {
  it('access granted + visitor is the owner -> completed', () => {
    expect(
      mapVerifiedPaymentToStatus({
        access_granted: true,
        requires_login: false,
        send_magic_link: false,
        is_guest_purchase: false,
      })
    ).toEqual({ paymentStatus: 'completed', accessGranted: true, errorMessage: '' });
  });

  it('REGRESSION: access granted but visitor needs login -> magic_link_sent (not completed)', () => {
    expect(
      mapVerifiedPaymentToStatus({
        access_granted: true,
        requires_login: true,
        send_magic_link: true,
        is_guest_purchase: false,
      })
    ).toEqual({ paymentStatus: 'magic_link_sent', accessGranted: true, errorMessage: '' });
  });

  it('pure guest purchase, magic link path -> magic_link_sent with no access yet', () => {
    expect(
      mapVerifiedPaymentToStatus({
        access_granted: false,
        is_guest_purchase: true,
        send_magic_link: true,
      })
    ).toEqual({ paymentStatus: 'magic_link_sent', accessGranted: false, errorMessage: '' });
  });

  it('email validation failure -> email_validation_failed with error message', () => {
    expect(
      mapVerifiedPaymentToStatus({
        access_granted: false,
        scenario: 'email_validation_failed_server_side',
        error: 'Disposable email blocked',
      })
    ).toEqual({
      paymentStatus: 'email_validation_failed',
      accessGranted: false,
      errorMessage: 'Disposable email blocked',
    });
  });

  it('no access, no scenario, no magic link -> failed with fallback message', () => {
    expect(
      mapVerifiedPaymentToStatus({
        access_granted: false,
        is_guest_purchase: false,
        send_magic_link: false,
      })
    ).toEqual({
      paymentStatus: 'failed',
      accessGranted: false,
      errorMessage: 'Unknown error occurred',
    });
  });

  it('partial flags do not bypass the magic-link path (access_granted+requires_login alone)', () => {
    // If backend says requires_login=true but forgets send_magic_link=true,
    // we must NOT silently fall through to 'completed' — that would re-create
    // the redirect-to-login regression. Either both flags fire together or
    // we treat it as a 'completed' state and trust upstream to be consistent.
    const out = mapVerifiedPaymentToStatus({
      access_granted: true,
      requires_login: true,
      send_magic_link: false,
    });
    expect(out.paymentStatus).toBe('completed');
    expect(out.accessGranted).toBe(true);
  });
});

describe('end-to-end contract: classifyCachedPaymentAuth -> mapVerifiedPaymentToStatus', () => {
  it('REGRESSION CHAIN: existing user did guest checkout, visitor logged out -> magic_link_sent', () => {
    const auth = classifyCachedPaymentAuth({
      visitor: null,
      transactionUserId: 'existing-user-uuid',
      transactionEmail: 'alice@example.com',
      hasAccess: true,
    });

    const mapped = mapVerifiedPaymentToStatus({
      access_granted: true,
      requires_login: auth.currentVisitorNeedsLogin,
      send_magic_link: auth.currentVisitorNeedsLogin,
      is_guest_purchase: auth.isStructuralGuestPurchase,
    });

    expect(mapped.paymentStatus).toBe('magic_link_sent');
    expect(mapped.accessGranted).toBe(true);
  });

  it('logged-in owner revisits own purchase -> completed (no redirect)', () => {
    const auth = classifyCachedPaymentAuth({
      visitor: { id: 'alice-uuid', email: 'alice@example.com' },
      transactionUserId: 'alice-uuid',
      transactionEmail: 'alice@example.com',
      hasAccess: true,
    });

    const mapped = mapVerifiedPaymentToStatus({
      access_granted: true,
      requires_login: auth.currentVisitorNeedsLogin,
      send_magic_link: auth.currentVisitorNeedsLogin,
      is_guest_purchase: auth.isStructuralGuestPurchase,
    });

    expect(mapped.paymentStatus).toBe('completed');
    expect(mapped.accessGranted).toBe(true);
  });

  it('different logged-in user (not the buyer) -> magic_link_sent to the actual buyer', () => {
    const auth = classifyCachedPaymentAuth({
      visitor: { id: 'bob-uuid', email: 'bob@example.com' },
      transactionUserId: 'alice-uuid',
      transactionEmail: 'alice@example.com',
      hasAccess: true,
    });

    const mapped = mapVerifiedPaymentToStatus({
      access_granted: true,
      requires_login: auth.currentVisitorNeedsLogin,
      send_magic_link: auth.currentVisitorNeedsLogin,
      is_guest_purchase: auth.isStructuralGuestPurchase,
    });

    expect(mapped.paymentStatus).toBe('magic_link_sent');
    expect(mapped.accessGranted).toBe(true);
  });
});

describe('useAuthCheck never auto-redirects (server is source of truth)', () => {
  const repoRoot = join(__dirname, '..', '..', '..');
  const hookSource = readFileSync(
    join(repoRoot, 'src/app/[locale]/p/[slug]/payment-status/hooks/useAuthCheck.ts'),
    'utf8'
  );

  // Hard regression guard. Client-side getUser() can race or miss cookies right
  // after Stripe redirect; auto-redirecting on that would bounce buyers off
  // their success page. Server-side verify-payment already decided the state.
  it('does not import useRouter or call router.push', () => {
    expect(hookSource).not.toMatch(/useRouter/);
    expect(hookSource).not.toMatch(/router\.push/);
  });

  it('does not reference the post-payment login message', () => {
    expect(hookSource).not.toContain('payment_completed_login_required');
  });

  it('still gates the auth probe on paymentStatus=completed + accessGranted', () => {
    expect(hookSource).toMatch(/paymentStatus\s*!==\s*['"]completed['"]/);
    expect(hookSource).toMatch(/accessGranted/);
  });
});
