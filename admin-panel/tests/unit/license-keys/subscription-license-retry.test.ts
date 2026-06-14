import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(__dirname, '../../../src/app/api/webhooks/stripe/subscription-handlers.ts'),
  'utf8',
);

describe('invoice.paid license retry wiring', () => {
  it('retries idempotent issuance before acknowledging an already booked invoice', () => {
    const replayBlock = source.match(/if \(existingTx\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
    expect(replayBlock).toContain('await issueRenewalLicense()');
    expect(replayBlock.indexOf('await issueRenewalLicense()'))
      .toBeLessThan(replayBlock.indexOf('return { processed: true'));
  });

  it('does not swallow renewal issuance errors', () => {
    expect(source).not.toContain('License issuance failed');
    expect(source).not.toContain('issueRenewalLicense().catch');
  });
});
