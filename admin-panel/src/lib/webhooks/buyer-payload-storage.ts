/** Storage representation for buyer delivery bodies. @see services/webhook-queue/supabase-queue.ts */
import { encryptSecret, decryptSecret } from '@/lib/services/secret-encryption';
import type { Json } from '@/types/database';
import type { EncryptedConfig } from '@/lib/services/secret-encryption';

export function isBuyerDelivery(event: string): boolean {
  return ['license.issued', 'order.participants_needed', 'purchase.completed', 'lead.captured'].includes(event);
}
async function seal(value: unknown): Promise<EncryptedConfig> {
  const encrypted = await encryptSecret(JSON.stringify(value));
  return { encrypted_key: encrypted.encryptedKey, encryption_iv: encrypted.iv, encryption_tag: encrypted.tag };
}
async function mapCredentials(value: unknown, reading: boolean): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map(item => mapCredentials(item, reading)));
  if (!value || typeof value !== 'object') return value;
  if (reading && 'sealedBuyerValue' in value) return JSON.parse(await decryptSecret(value.sealedBuyerValue as EncryptedConfig));
  return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key,
    !reading && ['token', 'licenseKey', 'participantsUrl'].includes(key) && typeof item === 'string'
      ? { sealedBuyerValue: await seal(item) } : await mapCredentials(item, reading),
  ])));
}
export async function storeBuyerPayload(event: string, payload: unknown): Promise<Json> {
  if (event === 'license.issued' || event === 'order.participants_needed') return { buyerDelivery: { ...await seal(payload) } };
  return await mapCredentials(payload, false) as Json;
}
export async function readBuyerPayload(payload: unknown): Promise<unknown> {
  if (payload && typeof payload === 'object' && 'buyerDelivery' in payload) return JSON.parse(await decryptSecret(payload.buyerDelivery as EncryptedConfig));
  return mapCredentials(payload, true);
}
