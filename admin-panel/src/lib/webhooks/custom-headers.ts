import { encryptSecret, decryptSecret } from '@/lib/services/secret-encryption';
import type { EncryptedConfig } from '@/lib/services/secret-encryption';

export type HeaderMap = Record<string, string>;

/** Encrypt a header map into the text stored in webhook_endpoints.custom_headers_encrypted. */
export async function encryptHeaderMap(map: HeaderMap): Promise<string> {
  const { encryptedKey, iv, tag } = await encryptSecret(JSON.stringify(map));
  const config: EncryptedConfig = {
    encrypted_key: encryptedKey,
    encryption_iv: iv,
    encryption_tag: tag,
  };
  return JSON.stringify(config);
}

/** Decrypt the stored text back into a header map. Null/empty -> {}. */
export async function decryptHeaderMap(stored: string | null | undefined): Promise<HeaderMap> {
  if (!stored) return {};
  const config = JSON.parse(stored) as EncryptedConfig;
  const json = await decryptSecret(config);
  return JSON.parse(json) as HeaderMap;
}
