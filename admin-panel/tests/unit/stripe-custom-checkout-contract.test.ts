/**
 * Stripe Custom Checkout (`ui_mode: 'custom'`) Contract Invariants
 *
 * Background
 * ----------
 * Sellf moved from the legacy PaymentIntent-only flow to Stripe Checkout
 * Sessions with `ui_mode: 'custom'` (Embedded Elements). That ui_mode has a
 * strict client-side contract that, when violated, surfaces as runtime errors
 * mid-checkout:
 *
 *   1. "You cannot provide `returnUrl` to confirm() when `return_url` was
 *       already provided when creating the Checkout Session."
 *   2. "You cannot provide `billingAddress` in confirm() when using automatic
 *       tax. Please use updateBillingAddress() instead."
 *   3. "You previously passed billingAddress.address.country to
 *       updateBillingAddress(), but Payment Element may also be collecting
 *       this field. To avoid double collecting billing details, pass
 *       fields.billingDetails.address.country=never when creating the Payment
 *       Element."
 *   4. "Unrecognized payment.update() parameter: layout.defaultCollapsed".
 *
 * Each of those was a real production warning. This file pins the corresponding
 * source-level invariants so a future refactor cannot silently regress them.
 *
 * Why source-level / regex
 * ------------------------
 * The component is a React client component that talks to a live Stripe SDK; we
 * cannot meaningfully unit-test runtime behavior without a heavy harness. The
 * Stripe contract is small and stable, so grepping the file is a cheap, exact
 * regression guard.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const customPaymentFormSource = readFileSync(
  resolve(
    __dirname,
    '../../src/app/[locale]/checkout/[slug]/components/CustomPaymentForm.tsx',
  ),
  'utf-8',
);

// Helper: extract the `fields:` object literal from paymentElementOptions.
function extractFieldsBlock(): string {
  const match = customPaymentFormSource.match(
    /fields:\s*\{[\s\S]+?\n\s{4,6}\},\n\s{2}\};/,
  );
  if (!match) throw new Error('Could not locate fields block in CustomPaymentForm');
  return match[0];
}

describe('Stripe Custom Checkout contract — confirm() shape', () => {
  it('calls checkout.confirm() with NO argument (return_url lives on the session)', () => {
    // checkout.confirm({...}) anywhere in source is forbidden.
    expect(customPaymentFormSource).not.toContain('checkout.confirm({');
    // Sanity: the no-arg form exists.
    expect(customPaymentFormSource).toMatch(/checkout\.confirm\(\)/);
  });

  it('never passes returnUrl from the client', () => {
    expect(customPaymentFormSource).not.toContain('returnUrl:');
    expect(customPaymentFormSource).not.toContain('return_url:');
  });

  it('never passes billingAddress as an argument to confirm()', () => {
    // checkout.confirm({ billingAddress: ... }) — would clash with automatic_tax.
    expect(customPaymentFormSource).not.toMatch(/checkout\.confirm\([^)]*billingAddress/);
  });

  it('never passes email as an argument to confirm()', () => {
    expect(customPaymentFormSource).not.toMatch(/checkout\.confirm\([^)]*email/);
  });
});

describe('Stripe Custom Checkout contract — update*() calls happen before confirm()', () => {
  it('calls updateEmail() before confirm()', () => {
    const emailIdx = customPaymentFormSource.indexOf('checkout.updateEmail');
    const confirmIdx = customPaymentFormSource.indexOf('checkout.confirm()');
    expect(emailIdx).toBeGreaterThan(-1);
    expect(confirmIdx).toBeGreaterThan(-1);
    expect(emailIdx).toBeLessThan(confirmIdx);
  });

  it('calls updateBillingAddress() before confirm()', () => {
    const updateIdx = customPaymentFormSource.indexOf('checkout.updateBillingAddress');
    const confirmIdx = customPaymentFormSource.indexOf('checkout.confirm()');
    expect(updateIdx).toBeGreaterThan(-1);
    expect(confirmIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeLessThan(confirmIdx);
  });

  it('handles update* errors before reaching confirm() (no silent fall-through)', () => {
    // After each await checkout.update*(...) there must be a `.type === 'error'`
    // branch. Otherwise an error gets dropped and confirm() proceeds with stale data.
    const updateCalls = customPaymentFormSource.match(
      /const \w+ = await checkout\.update\w+\([\s\S]+?\);[\s\S]+?\.type === 'error'/g,
    );
    // We have two updates (email, billingAddress) — both must be guarded.
    expect(updateCalls?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Stripe Custom Checkout contract — fields ↔ update* parity', () => {
  it('every field marked "never" has an equivalent update*() call', () => {
    const fieldsBlock = extractFieldsBlock();

    if (/email:\s*'never'/.test(fieldsBlock)) {
      expect(customPaymentFormSource).toContain('checkout.updateEmail');
    }

    if (/name:\s*'never'/.test(fieldsBlock)) {
      // updateBillingAddress is the only update*() call that carries name in
      // Custom Checkout, so it must exist and reference invoice.fullName.
      expect(customPaymentFormSource).toMatch(
        /checkout\.updateBillingAddress\(\s*\{[\s\S]*?name:\s*invoice\.fullName/,
      );
    }
  });

  it('does not mark individual address subfields as never (paired collection rule)', () => {
    // Stripe enforces address as a paired group: marking only country (or only
    // postalCode) as 'never' triggers "You cannot pass both [...] without also
    // passing fields.billingDetails.address.<paired-field>=never". Allowed
    // modes are:
    //   - all-auto (default — collected inside PaymentElement)
    //   - all-never (with full address pushed via updateBillingAddress)
    //   - address: 'if_required' (Stripe picks the minimum subset)
    // This invariant blocks the easy-to-write but wrong middle ground.
    const fieldsBlock = extractFieldsBlock();
    const partialAddressMarkings = [
      /country:\s*'never'/,
      /postalCode:\s*'never'/,
      /line1:\s*'never'/,
      /line2:\s*'never'/,
      /city:\s*'never'/,
      /state:\s*'never'/,
    ];
    const matched = partialAddressMarkings.filter((p) => p.test(fieldsBlock));
    // Either we mark NONE (paired auto) or we mark ALL six (paired never). Any
    // strict subset is forbidden.
    expect(
      matched.length === 0 || matched.length === partialAddressMarkings.length,
      `PaymentElement billing address fields must be all-auto or all-never. Currently ${matched.length}/6 marked: ${matched.map((p) => p.source).join(', ')}`,
    ).toBe(true);
  });

  it('updateBillingAddress does not pass any address subkey unless every address field is marked never', () => {
    const fieldsBlock = extractFieldsBlock();
    const allAddressNever = [
      /country:\s*'never'/,
      /postalCode:\s*'never'/,
      /line1:\s*'never'/,
      /city:\s*'never'/,
    ].every((p) => p.test(fieldsBlock));

    const updateCall = customPaymentFormSource.match(
      /checkout\.updateBillingAddress\(\s*\{([\s\S]+?)\}\s*\)/,
    );
    expect(updateCall).not.toBeNull();
    const args = updateCall![1];

    if (!allAddressNever) {
      // Passing address keys triggers the paired-collection runtime warning.
      expect(
        args,
        'updateBillingAddress passes an address subkey but PaymentElement still collects address fields — remove the address from this call or mark all address fields "never".',
      ).not.toMatch(/address:/);
    }
  });
});

describe('Stripe Custom Checkout contract — PaymentElement options shape', () => {
  it('does not pass deprecated layout.defaultCollapsed parameter', () => {
    expect(customPaymentFormSource).not.toContain('defaultCollapsed');
  });

  it('uses tabs layout (preserves current UX)', () => {
    expect(customPaymentFormSource).toMatch(/layout:\s*\{\s*type:\s*'tabs'/);
  });

  it('filters Link from paymentMethodOrder (we manage email ourselves)', () => {
    expect(customPaymentFormSource).toMatch(/paymentMethodOrder\.filter\([^)]+!==\s*'link'/);
  });
});
