import { afterEach, describe, expect, it, vi } from 'vitest';
import { invoiceTokenUpdate, redactInvoiceConfig, settingsSchema, configuredProvider } from '@/lib/invoicing/config';
import { decryptSecret } from '@/lib/services/secret-encryption';
import type { InvoiceConfig } from '@/lib/invoicing/config';

afterEach(() => vi.unstubAllEnvs());
describe('invoice settings', () => {
  it('encrypts token with APP_ENCRYPTION_KEY and returns no token from projection', async () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
    const columns = await invoiceTokenUpdate('test-token');
    expect(JSON.stringify(columns)).not.toContain('test-token');
    expect(await decryptSecret(columns.token!)).toBe('test-token');
    const config: InvoiceConfig = { id: true, instance_id: 'instance', provider: 'fakturownia', domain: 'example.fakturownia.pl', mode: 'manual', token: columns.token!, exemption: '', template: '{product}' };
    const response = redactInvoiceConfig(config);
    expect(response.tokenSet).toBe(true);
    expect(response).not.toHaveProperty('token');
    expect(JSON.stringify(response)).not.toContain(columns.token!.encrypted_key);
    expect(await configuredProvider(config)).toMatchObject({ id: 'fakturownia' });
  });
  it('keeps saved token on blank input', async () => expect(await invoiceTokenUpdate('')).toEqual({}));
  it('requires valid account and product placeholder, bounds token and rejects extra keys', () => {
    const input = { provider: 'fakturownia', domain: 'example.fakturownia.pl', mode: 'auto', exemption: '', template: '{product}' };
    expect(settingsSchema.safeParse(input).success).toBe(true);
    for (const patch of [{ domain: 'localhost' }, { template: 'no placeholder' }, { token: 'a'.repeat(1001) }, { other: 'value' }]) expect(settingsSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
});
