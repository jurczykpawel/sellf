import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/services/secret-encryption', () => ({
  encryptSecret: vi.fn(),
  decryptSecret: vi.fn(),
}));

import { encryptSecret, decryptSecret } from '@/lib/services/secret-encryption';
import {
  generateSellerKeypair,
  deriveKid,
  publicFromPrivate,
  storeSellerKey,
  importSellerKey,
  loadActiveSellerKey,
  loadActivePublicKeyInfo,
} from '@/lib/license-keys/keys';

const SELLER = '33333333-3333-3333-3333-333333333333';

function adminMock(opts: { row?: Record<string, unknown> | null; upsert?: ReturnType<typeof vi.fn> }) {
  const upsert = opts.upsert ?? vi.fn().mockResolvedValue({ error: null });
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve({ data: opts.row ?? null, error: null }),
  };
  return { from: vi.fn(() => ({ ...chain, upsert })) };
}

beforeEach(() => {
  vi.mocked(encryptSecret).mockReset();
  vi.mocked(encryptSecret).mockResolvedValue({ encryptedKey: 'ENC', iv: 'IV', tag: 'TAG' });
  vi.mocked(decryptSecret).mockReset();
});

describe('license key management', () => {
  it('rejects a non-P-256 key (BYOK must be EC P-256 to match the advertised alg)', async () => {
    const { generateKeyPairSync } = await import('node:crypto');
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1', publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    const { publicFromPrivate: pfp } = await import('@/lib/license-keys/keys');
    expect(() => pfp(rsa.privateKey)).toThrow();
    expect(() => pfp(p384.privateKey)).toThrow();
    await expect(importSellerKey(adminMock({ insert: vi.fn() }) as never, { sellerId: SELLER, privateKeyPem: rsa.privateKey })).rejects.toThrow();
  });

  it('generates an EC P-256 keypair with a deterministic kid', () => {
    const k = generateSellerKeypair();
    expect(k.publicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(k.privateKeyPem).toContain('BEGIN PRIVATE KEY');
    expect(k.kid).toMatch(/^[0-9a-f]{16}$/);
    expect(k.kid).toBe(deriveKid(k.publicKeyPem));
  });

  it('derives the matching public key from a private key', () => {
    const k = generateSellerKeypair();
    expect(publicFromPrivate(k.privateKeyPem).trim()).toBe(k.publicKeyPem.trim());
  });

  it('storeSellerKey encrypts the private key and upserts on (seller_id, kid)', async () => {
    const k = generateSellerKeypair();
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const admin = adminMock({ upsert });
    const res = await storeSellerKey(admin as never, { sellerId: SELLER, publicKeyPem: k.publicKeyPem, privateKeyPem: k.privateKeyPem, custody: 'managed' });
    expect(vi.mocked(encryptSecret)).toHaveBeenCalledWith(k.privateKeyPem);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        seller_id: SELLER, kid: k.kid, public_key: k.publicKeyPem,
        encrypted_key: 'ENC', encryption_iv: 'IV', encryption_tag: 'TAG',
        custody: 'managed', is_active: true,
      }),
      { onConflict: 'seller_id,kid' },
    );
    expect(res.kid).toBe(k.kid);
  });

  it('storeSellerKey re-upload of same key reactivates (upsert idempotent)', async () => {
    const k = generateSellerKeypair();
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const admin = adminMock({ upsert });
    // First store
    await storeSellerKey(admin as never, { sellerId: SELLER, publicKeyPem: k.publicKeyPem, privateKeyPem: k.privateKeyPem, custody: 'byok' });
    // Second store — same key, same kid — must not throw
    const res = await storeSellerKey(admin as never, { sellerId: SELLER, publicKeyPem: k.publicKeyPem, privateKeyPem: k.privateKeyPem, custody: 'byok' });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(res.kid).toBe(k.kid);
  });

  it('importSellerKey derives the public key and stores as byok', async () => {
    const k = generateSellerKeypair();
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const admin = adminMock({ upsert });
    await importSellerKey(admin as never, { sellerId: SELLER, privateKeyPem: k.privateKeyPem });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ public_key: expect.stringContaining('BEGIN PUBLIC KEY'), custody: 'byok' }),
      expect.objectContaining({ onConflict: 'seller_id,kid' }),
    );
  });

  it('loadActiveSellerKey decrypts and returns pems + kid', async () => {
    const k = generateSellerKeypair();
    vi.mocked(decryptSecret).mockResolvedValue(k.privateKeyPem);
    const admin = adminMock({ row: { kid: k.kid, public_key: k.publicKeyPem, encrypted_key: 'ENC', encryption_iv: 'IV', encryption_tag: 'TAG' } });
    const res = await loadActiveSellerKey(admin as never, SELLER);
    expect(res).toEqual({ kid: k.kid, publicKeyPem: k.publicKeyPem, privateKeyPem: k.privateKeyPem });
    expect(vi.mocked(decryptSecret)).toHaveBeenCalledWith({ encrypted_key: 'ENC', encryption_iv: 'IV', encryption_tag: 'TAG' });
  });

  it('loadActiveSellerKey returns null when the seller has no key', async () => {
    const admin = adminMock({ row: null });
    expect(await loadActiveSellerKey(admin as never, SELLER)).toBeNull();
  });

  it('loadActivePublicKeyInfo returns public material WITHOUT decrypting the private key', async () => {
    const k = generateSellerKeypair();
    const admin = adminMock({ row: { kid: k.kid, public_key: k.publicKeyPem } });
    const res = await loadActivePublicKeyInfo(admin as never, SELLER);
    expect(res).toEqual({ kid: k.kid, publicKeyPem: k.publicKeyPem });
    expect(vi.mocked(decryptSecret)).not.toHaveBeenCalled();
  });

  it('loadActivePublicKeyInfo returns null when the seller has no key', async () => {
    expect(await loadActivePublicKeyInfo(adminMock({ row: null }) as never, SELLER)).toBeNull();
  });
});
