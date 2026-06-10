import { describe, it, expect, beforeAll } from 'vitest';
import { encryptHeaderMap, decryptHeaderMap } from '@/lib/webhooks/custom-headers';

beforeAll(() => {
  // 32-byte base64 key for AES-256-GCM
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
});

describe('custom header encryption', () => {
  it('round-trips a header map', async () => {
    const map = { Authorization: 'Bearer sk_live_secret', 'X-Tenant': 'tsa' };
    const enc = await encryptHeaderMap(map);
    expect(enc).not.toContain('Bearer sk_live_secret'); // ciphertext, not plaintext
    expect(await decryptHeaderMap(enc)).toEqual(map);
  });
  it('decrypt of null/empty returns empty map', async () => {
    expect(await decryptHeaderMap(null)).toEqual({});
    expect(await decryptHeaderMap('')).toEqual({});
  });
});
