/** @see src/lib/webhooks/signing-secret.ts */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encryptWebhookSecret, decryptWebhookSecret, publicWebhookSecret } from '@/lib/webhooks/signing-secret';

afterEach(() => vi.unstubAllEnvs());
describe('webhook signing secret storage', () => {
  it('round trips using the application encryption key and hides stored values', async () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32, 5).toString('base64'));
    const secret = 'whsec_new';
    const stored = await encryptWebhookSecret(secret);
    expect(stored).not.toContain(secret);
    expect(await decryptWebhookSecret(stored)).toBe(secret);
    expect(publicWebhookSecret(stored)).toBe('');
    expect(publicWebhookSecret('whsec_legacy')).toBe('whsec_legacy');
    expect(await decryptWebhookSecret('whsec_legacy')).toBe('whsec_legacy');
  });
  it('rejects an unreadable encrypted value', async () => {
    await expect(decryptWebhookSecret('enc:v1:invalid')).rejects.toThrow();
  });
});
