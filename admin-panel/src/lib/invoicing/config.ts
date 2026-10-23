/** Private settings and token handling. @see ../services/secret-encryption.ts */
import 'server-only';
import { z } from 'zod';
import { domainSchema, FakturowniaProvider } from '@/lib/invoicing/fakturownia';
import { decryptSecret, encryptSecret } from '@/lib/services/secret-encryption';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EncryptedConfig } from '@/lib/services/secret-encryption';

export const settingsSchema = z.object({
  provider: z.enum(['none', 'fakturownia']), domain: z.union([z.literal(''), domainSchema]),
  mode: z.enum(['auto', 'manual']), exemption: z.string().max(1000),
  template: z.string().min(1).max(300).refine(v => v.includes('{product}')),
  token: z.string().trim().max(1000).optional(),
}).strict().refine(v => v.provider === 'none' || Boolean(v.domain));
export interface InvoiceConfig {
  id: boolean; instance_id: string; provider: 'none' | 'fakturownia'; domain: string;
  token: EncryptedConfig | null; mode: 'auto' | 'manual'; exemption: string; template: string;
}
export function redactInvoiceConfig(config: InvoiceConfig): Omit<InvoiceConfig, 'token'> & { tokenSet: boolean } {
  const { token, ...rest } = config;
  return { ...rest, tokenSet: Boolean(token) };
}
export async function invoiceTokenUpdate(token?: string): Promise<{ token?: EncryptedConfig }> {
  if (!token) return {};
  const encrypted = await encryptSecret(token);
  return { token: { encrypted_key: encrypted.encryptedKey, encryption_iv: encrypted.iv, encryption_tag: encrypted.tag } };
}
export async function readInvoiceConfig(client: SupabaseClient): Promise<InvoiceConfig | null> {
  const { data, error } = await client.from('invoicing_config').select('*').eq('id', true).single();
  return error ? null : data as InvoiceConfig;
}
export async function configuredProvider(config: InvoiceConfig): Promise<FakturowniaProvider | null> {
  if (config.provider !== 'fakturownia' || !config.token) return null;
  return new FakturowniaProvider(config.domain, await decryptSecret(config.token));
}
