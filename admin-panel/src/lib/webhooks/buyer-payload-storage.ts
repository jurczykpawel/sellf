import { encryptSecret, decryptSecret } from '@/lib/services/secret-encryption';
import type { Json } from '@/types/database';
import type { EncryptedConfig } from '@/lib/services/secret-encryption';

const STORAGE_VERSION = 'sellf:buyer-payload:v1';
type SealedValues = Record<string, EncryptedConfig>;

export function isBuyerDelivery(event: string): boolean {
  return ['license.issued', 'order.participants_needed', 'purchase.completed', 'lead.captured'].includes(event);
}
async function seal(value: unknown): Promise<EncryptedConfig> {
  const encrypted = await encryptSecret(JSON.stringify(value));
  return { encrypted_key: encrypted.encryptedKey, encryption_iv: encrypted.iv, encryption_tag: encrypted.tag };
}
async function mapValues(
  value: unknown, path: string[], transform: (value: unknown, path: string[]) => Promise<unknown>,
): Promise<unknown> {
  const mapped = await transform(value, path);
  if (mapped !== value || !value || typeof value !== 'object') return mapped;
  if (Array.isArray(value)) return Promise.all(value.map((item, index) => mapValues(item, [...path, String(index)], transform)));
  return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) =>
    [key, await mapValues(item, [...path, key], transform)])));
}
export async function storeBuyerPayload(event: string, payload: unknown): Promise<Json> {
  const sealed: SealedValues = {};
  let visible: unknown;
  if (event === 'license.issued' || event === 'order.participants_needed') {
    sealed['[]'] = await seal(payload);
    visible = null;
  } else {
    visible = await mapValues(payload, [], async (value, path) => {
      if (typeof value !== 'string' || !['token', 'licenseKey', 'participantsUrl', 'payUrl'].includes(path.at(-1) ?? '')) return value;
      sealed[JSON.stringify(path)] = await seal(value);
      return null;
    });
  }
  return Object.keys(sealed).length ? [STORAGE_VERSION, visible, sealed] as Json : payload as Json;
}
export async function readBuyerPayload(payload: unknown): Promise<unknown> {
  if (!Array.isArray(payload) || payload[0] !== STORAGE_VERSION) return payload;
  if (payload.length !== 3 || !payload[2] || typeof payload[2] !== 'object' || Array.isArray(payload[2])) {
    throw new Error('Invalid stored delivery payload');
  }
  const sealed = payload[2] as SealedValues;
  return mapValues(payload[1], [], async (value, path) => {
    const config = sealed[JSON.stringify(path)];
    return config ? JSON.parse(await decryptSecret(config)) : value;
  });
}
