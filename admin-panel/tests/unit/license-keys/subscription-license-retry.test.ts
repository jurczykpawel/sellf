import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(__dirname, '../../../src/app/api/webhooks/stripe/subscription-handlers.ts'),
  'utf8',
);

describe('invoice.paid license retry wiring', () => {
  it('retries idempotent issuance before acknowledging an already booked invoice', () => {
    const completedAt = source.indexOf('if (insertedTx.fulfillment_completed_at)');
    const issuance = source.indexOf('await issueRenewalLicense()', completedAt);
    const delivery = source.indexOf("await WebhookService.trigger('invoice.paid'", issuance);
    const saved = source.indexOf('update({ fulfillment_completed_at:', delivery);
    expect(completedAt).toBeGreaterThan(0);
    expect(issuance).toBeGreaterThan(completedAt);
    expect(delivery).toBeGreaterThan(issuance);
    expect(saved).toBeGreaterThan(delivery);
  });

  it('does not swallow renewal issuance errors', () => {
    expect(source).not.toContain('License issuance failed');
    expect(source).not.toContain('issueRenewalLicense().catch');
  });
});
