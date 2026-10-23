import { it, expect } from 'vitest';
import { FakturowniaProvider } from '@/lib/invoicing/fakturownia';

it.skipIf(!process.env.FAKTUROWNIA_TEST_DOMAIN || !process.env.FAKTUROWNIA_TEST_TOKEN)('optional test account connection', async () => {
  const provider = new FakturowniaProvider(process.env.FAKTUROWNIA_TEST_DOMAIN!, process.env.FAKTUROWNIA_TEST_TOKEN!);
  const result = await provider.findByExternalKey('sellf-optional-test-account-check');
  expect(result === null || result.success).toBe(true);
});
