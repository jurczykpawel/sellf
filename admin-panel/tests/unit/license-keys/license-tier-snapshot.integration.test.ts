import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../../helpers/database-container';
import { buildLicenseRevokeWebhookData } from '@/lib/services/license-revoke-webhook-payload';

it.each(['pro', null])('keeps the issued tier %s in an event without a product row', tier => {
  const token = `${Buffer.from(JSON.stringify({ v: 1, kid: 'key', product: 'product', email: 'buyer@example.com', order: 'order', tier, iat: 1, exp: null })).toString('base64url')}.signature`;
  const output = execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], {
    input: `SELECT public.license_event_snapshot(jsonb_populate_record(NULL::public.issued_licenses, '${JSON.stringify({ id: crypto.randomUUID(), product_id: crypto.randomUUID(), license_key: token, order_id: 'order' })}'::jsonb));`, encoding: 'utf8',
  });
  const snapshot = JSON.parse(output);
  expect(snapshot.products).toBeNull();
  expect(snapshot.tier).toBe(tier);
  expect(snapshot).not.toHaveProperty('license_key');
  expect(buildLicenseRevokeWebhookData(snapshot, 'http://localhost').license.tier).toBe(tier);
});
