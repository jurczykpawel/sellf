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

function adminMock(opts: { row?: Record<string, unknown> | null; rpc?: ReturnType<typeof vi.fn> }) {
  const rpc = opts.rpc ?? vi.fn().mockResolvedValue({ data: null, error: null });
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve({ data: opts.row ?? null, error: null }),
  };
  return { from: vi.fn(() => chain), rpc };
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
    await expect(importSellerKey(adminMock({}) as never, { sellerId: SELLER, privateKeyPem: rsa.privateKey })).rejects.toThrow();
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

  it('storeSellerKey encrypts the private key, then replaces the active key in one database call', async () => {
    const k = generateSellerKeypair();
    const order: string[] = [];
    vi.mocked(encryptSecret).mockImplementation(async () => { order.push('encrypt'); return { encryptedKey: 'ENC', iv: 'IV', tag: 'TAG' }; });
    const rpc = vi.fn(async () => { order.push('rpc'); return { data: k.kid, error: null }; });
    const admin = adminMock({ rpc });
    const res = await storeSellerKey(admin as never, { sellerId: SELLER, publicKeyPem: k.publicKeyPem, privateKeyPem: k.privateKeyPem, custody: 'managed' });
    expect(vi.mocked(encryptSecret)).toHaveBeenCalledWith(k.privateKeyPem);
    expect(order).toEqual(['encrypt', 'rpc']);
    expect(rpc).toHaveBeenCalledWith('replace_seller_license_key', {
      p_seller_id: SELLER, p_kid: k.kid, p_public_key: k.publicKeyPem,
      p_encrypted_key: 'ENC', p_encryption_iv: 'IV', p_encryption_tag: 'TAG', p_custody: 'managed',
    });
    expect(admin.from).not.toHaveBeenCalled();
    expect(res.kid).toBe(k.kid);
  });

  it('storeSellerKey does not touch the database when encryption fails', async () => {
    const k = generateSellerKeypair();
    vi.mocked(encryptSecret).mockRejectedValue(new Error('no encryption key'));
    const admin = adminMock({});
    await expect(storeSellerKey(admin as never, { sellerId: SELLER, publicKeyPem: k.publicKeyPem, privateKeyPem: k.privateKeyPem, custody: 'managed' })).rejects.toThrow();
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('storeSellerKey reports a failed save', async () => {
    const k = generateSellerKeypair();
    const admin = adminMock({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'write failed' } }) });
    await expect(storeSellerKey(admin as never, { sellerId: SELLER, publicKeyPem: k.publicKeyPem, privateKeyPem: k.privateKeyPem, custody: 'byok' })).rejects.toThrow(/write failed/);
  });

  it('importSellerKey derives the public key and stores as byok', async () => {
    const k = generateSellerKeypair();
    const admin = adminMock({});
    await importSellerKey(admin as never, { sellerId: SELLER, privateKeyPem: k.privateKeyPem });
    expect(admin.rpc).toHaveBeenCalledWith('replace_seller_license_key', expect.objectContaining({
      p_public_key: expect.stringContaining('BEGIN PUBLIC KEY'), p_kid: k.kid, p_custody: 'byok',
    }));
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
