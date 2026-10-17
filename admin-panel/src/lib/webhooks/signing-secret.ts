/**
 * Storage format for rotated outbound webhook secrets.
 * @see services/secret-encryption.ts
 */
import { encryptSecret, decryptSecret } from '@/lib/services/secret-encryption';
import type { EncryptedConfig } from '@/lib/services/secret-encryption';

const ENCRYPTED_PREFIX = 'enc:v1:';

export async function encryptWebhookSecret(secret: string): Promise<string> {
  const { encryptedKey, iv, tag } = await encryptSecret(secret);
  const config: EncryptedConfig = {
    encrypted_key: encryptedKey, encryption_iv: iv, encryption_tag: tag,
  };
  return ENCRYPTED_PREFIX + JSON.stringify(config);
}

export async function decryptWebhookSecret(stored: string): Promise<string> {
  if (!stored.startsWith(ENCRYPTED_PREFIX)) return stored;
  return decryptSecret(JSON.parse(stored.slice(ENCRYPTED_PREFIX.length)) as EncryptedConfig);
}

export function publicWebhookSecret(stored: string): string {
  return stored.startsWith(ENCRYPTED_PREFIX) ? '' : stored;
}
