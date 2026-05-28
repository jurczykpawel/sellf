/**
 * Secret encryption service (AES-256-GCM) — round-trip + integrity.
 *
 * Backs Stripe API keys, webhook signing secrets, GUS/Currency API keys.
 * No coverage existed; the prod "Invalid IV length: 14 bytes" log (a sentinel
 * 'env_config_sentinel' value decoded as base64) made it clear the encrypt/
 * decrypt contract was untested. These lock the contract down.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';

const TEST_KEY = crypto.randomBytes(32).toString('base64'); // valid 32-byte AES-256 key
let prevKey: string | undefined;
let prevStripeKey: string | undefined;

beforeAll(() => {
  prevKey = process.env.APP_ENCRYPTION_KEY;
  prevStripeKey = process.env.STRIPE_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = TEST_KEY;
  delete process.env.STRIPE_ENCRYPTION_KEY;
});

afterAll(() => {
  if (prevKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
  else process.env.APP_ENCRYPTION_KEY = prevKey;
  if (prevStripeKey === undefined) delete process.env.STRIPE_ENCRYPTION_KEY;
  else process.env.STRIPE_ENCRYPTION_KEY = prevStripeKey;
});

describe('secret-encryption (AES-256-GCM)', () => {
  it('round-trips a Stripe secret key', async () => {
    const { encryptSecret, decryptSecret } = await import('@/lib/services/secret-encryption');
    const plaintext = 'sk_live_PLACEHOLDER_not_a_real_key'; // trufflehog:ignore — synthetic test value

    const enc = await encryptSecret(plaintext);
    const back = await decryptSecret({
      encrypted_key: enc.encryptedKey,
      encryption_iv: enc.iv,
      encryption_tag: enc.tag,
    });

    expect(back).toBe(plaintext);
  });

  it('produces a 16-byte IV and 16-byte tag (base64)', async () => {
    const { encryptSecret } = await import('@/lib/services/secret-encryption');
    const enc = await encryptSecret('whsec_test_value'); // trufflehog:ignore — synthetic test value

    expect(Buffer.from(enc.iv, 'base64').length).toBe(16);
    expect(Buffer.from(enc.tag, 'base64').length).toBe(16);
  });

  it('uses a fresh random IV per encryption (no deterministic ciphertext)', async () => {
    const { encryptSecret } = await import('@/lib/services/secret-encryption');
    const a = await encryptSecret('same-input');
    const b = await encryptSecret('same-input');

    expect(a.iv).not.toBe(b.iv);
    expect(a.encryptedKey).not.toBe(b.encryptedKey);
  });

  it('fails authentication when ciphertext is tampered', async () => {
    const { encryptSecret, decryptSecret } = await import('@/lib/services/secret-encryption');
    const enc = await encryptSecret('sk_live_dont_touch'); // trufflehog:ignore — synthetic test value

    const tampered = Buffer.from(enc.encryptedKey, 'base64');
    tampered[0] ^= 0xff; // flip a bit

    await expect(decryptSecret({
      encrypted_key: tampered.toString('base64'),
      encryption_iv: enc.iv,
      encryption_tag: enc.tag,
    })).rejects.toThrow(/authentication|Decryption failed/i);
  });

  it('rejects an invalid IV length (the env-sentinel symptom)', async () => {
    const { decryptSecret } = await import('@/lib/services/secret-encryption');
    // 'env_config_sentinel' base64-decodes to 14 bytes, not 16 — exactly the prod log.
    await expect(decryptSecret({
      encrypted_key: 'env_config_sentinel',
      encryption_iv: 'env_config_sentinel',
      encryption_tag: 'env_config_sentinel',
    })).rejects.toThrow(/Invalid IV length/i);
  });

  it('refuses to encrypt an empty value', async () => {
    const { encryptSecret } = await import('@/lib/services/secret-encryption');
    await expect(encryptSecret('')).rejects.toThrow(/empty/i);
  });

  it('decryption fails under a different key (key rotation safety)', async () => {
    const { encryptSecret, decryptSecret } = await import('@/lib/services/secret-encryption');
    const enc = await encryptSecret('sk_live_rotate_me'); // trufflehog:ignore — synthetic test value

    // validateEncryptionKey() reads process.env per call, so swapping the env
    // is enough to simulate a key change — no module reset needed.
    process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    try {
      await expect(decryptSecret({
        encrypted_key: enc.encryptedKey,
        encryption_iv: enc.iv,
        encryption_tag: enc.tag,
      })).rejects.toThrow(/Decryption failed|authentication/i);
    } finally {
      process.env.APP_ENCRYPTION_KEY = TEST_KEY; // restore for other tests
    }
  });
});
