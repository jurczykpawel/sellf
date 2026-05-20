import { describe, it, expect, vi, beforeEach } from 'vitest';

import { assertSafeOutboundUrl, UnsafeOutboundUrlError } from '@/lib/security/outbound-url';
import * as webhookValidator from '@/lib/validations/webhook';

describe('assertSafeOutboundUrl', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves silently when validator returns valid', async () => {
    vi.spyOn(webhookValidator, 'validateWebhookUrlAsync').mockResolvedValue({ valid: true });
    await expect(assertSafeOutboundUrl('https://example.com/hook')).resolves.toBeUndefined();
  });

  it('throws UnsafeOutboundUrlError when validator rejects', async () => {
    vi.spyOn(webhookValidator, 'validateWebhookUrlAsync').mockResolvedValue({
      valid: false,
      error: 'private address',
    });
    await expect(assertSafeOutboundUrl('http://10.0.0.1/x')).rejects.toBeInstanceOf(
      UnsafeOutboundUrlError,
    );
  });

  it('uses generic message when validator omits reason', async () => {
    vi.spyOn(webhookValidator, 'validateWebhookUrlAsync').mockResolvedValue({ valid: false });
    await expect(assertSafeOutboundUrl('http://bad/x')).rejects.toThrow(/unsafe url/);
  });

  it('attaches the original url to the error for logging', async () => {
    vi.spyOn(webhookValidator, 'validateWebhookUrlAsync').mockResolvedValue({
      valid: false,
      error: 'blocked',
    });
    try {
      await assertSafeOutboundUrl('https://blocked.example/x');
      throw new Error('expected rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(UnsafeOutboundUrlError);
      if (err instanceof UnsafeOutboundUrlError) expect(err.url).toBe('https://blocked.example/x');
    }
  });
});
