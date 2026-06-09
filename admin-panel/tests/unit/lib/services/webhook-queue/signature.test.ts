import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  signWebhookPayload,
  parseWebhookSignatureHeader,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_VERSION,
} from '@/lib/services/webhook-queue/signature';

const secret = 'whsec_test_abc';
const body = JSON.stringify({ event: 'purchase.completed', data: { foo: 'bar' } });

describe('signWebhookPayload', () => {
  it('formats the header as t=<unix>,v1=<hmac over `${t}.${body}`>', () => {
    const t = 1_700_000_000;
    const header = signWebhookPayload(secret, body, t);
    const expectedMac = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    expect(header).toBe(`t=${t},v1=${expectedMac}`);
  });

  it('signs the timestamp — same body at a different t yields a different signature', () => {
    expect(signWebhookPayload(secret, body, 1000)).not.toBe(signWebhookPayload(secret, body, 2000));
  });
});

describe('parseWebhookSignatureHeader', () => {
  it('extracts t and v1 regardless of order, ignoring unknown keys', () => {
    expect(parseWebhookSignatureHeader('v1=abc,t=123,foo=bar')).toEqual({ t: 123, v1: 'abc' });
  });

  it('returns nulls for a malformed header', () => {
    expect(parseWebhookSignatureHeader('garbage')).toEqual({ t: null, v1: null });
  });
});

describe('verifyWebhookSignature', () => {
  const t = 1_700_000_000;
  const header = signWebhookPayload(secret, body, t);

  it('accepts a valid signature within the tolerance window', () => {
    expect(verifyWebhookSignature(secret, body, header, { nowSeconds: t + 60 })).toBe(true);
  });

  it('rejects a replayed signature outside the tolerance window', () => {
    expect(verifyWebhookSignature(secret, body, header, { nowSeconds: t + 6 * 60 })).toBe(false);
  });

  it('rejects a tampered body', () => {
    expect(verifyWebhookSignature(secret, body + 'x', header, { nowSeconds: t })).toBe(false);
  });

  it('rejects a tampered timestamp — t is covered by the MAC (the replay fix)', () => {
    const forged = header.replace(/t=\d+/, `t=${t + 1}`);
    expect(verifyWebhookSignature(secret, body, forged, { nowSeconds: t + 1 })).toBe(false);
  });

  it('rejects a wrong secret', () => {
    expect(verifyWebhookSignature('wrong-secret', body, header, { nowSeconds: t })).toBe(false);
  });

  it('rejects a malformed signature header', () => {
    expect(verifyWebhookSignature(secret, body, 'nope', { nowSeconds: t })).toBe(false);
  });
});

describe('WEBHOOK_SIGNATURE_VERSION', () => {
  it('is v1 (versioned so the algorithm can rotate without breaking receivers)', () => {
    expect(WEBHOOK_SIGNATURE_VERSION).toBe('v1');
  });
});
