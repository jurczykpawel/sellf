import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { decryptSecret, encryptSecret } from '@/lib/services/secret-encryption';

export type Custody = 'managed' | 'byok';

export interface SellerKeypair {
  publicKeyPem: string;
  privateKeyPem: string;
  kid: string;
}

export function deriveKid(publicKeyPem: string): string {
  return createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 16);
}

export function generateSellerKeypair(): SellerKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey, kid: deriveKid(publicKey) };
}

export function publicFromPrivate(privateKeyPem: string): string {
  return createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' }).toString();
}

export async function storeSellerKey(
  admin: SupabaseClient,
  input: { sellerId: string; publicKeyPem: string; privateKeyPem: string; custody: Custody },
): Promise<{ kid: string }> {
  const kid = deriveKid(input.publicKeyPem);
  const enc = await encryptSecret(input.privateKeyPem);
  const { error } = await admin.from('seller_license_keys').insert({
    seller_id: input.sellerId,
    kid,
    public_key: input.publicKeyPem,
    encrypted_key: enc.encryptedKey,
    encryption_iv: enc.iv,
    encryption_tag: enc.tag,
    custody: input.custody,
  });
  if (error) throw new Error(`storeSellerKey: ${error.message}`);
  return { kid };
}

export async function importSellerKey(
  admin: SupabaseClient,
  input: { sellerId: string; privateKeyPem: string },
): Promise<{ kid: string }> {
  const publicKeyPem = publicFromPrivate(input.privateKeyPem);
  return storeSellerKey(admin, { sellerId: input.sellerId, publicKeyPem, privateKeyPem: input.privateKeyPem, custody: 'byok' });
}

export async function loadActiveSellerKey(
  admin: SupabaseClient,
  sellerId: string,
): Promise<{ kid: string; publicKeyPem: string; privateKeyPem: string } | null> {
  const { data } = await admin
    .from('seller_license_keys')
    .select('kid, public_key, encrypted_key, encryption_iv, encryption_tag')
    .eq('seller_id', sellerId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    kid: string;
    public_key: string;
    encrypted_key: string;
    encryption_iv: string;
    encryption_tag: string;
  };
  const privateKeyPem = await decryptSecret({
    encrypted_key: row.encrypted_key,
    encryption_iv: row.encryption_iv,
    encryption_tag: row.encryption_tag,
  });
  return { kid: row.kid, publicKeyPem: row.public_key, privateKeyPem };
}
