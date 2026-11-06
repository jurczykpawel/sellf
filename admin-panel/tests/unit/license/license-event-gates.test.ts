/** Every license lifecycle event is a Pro event, subscribable, including expiry deadline changes. */
import { expect, it } from 'vitest';
import { EVENT_FEATURE_REQUIREMENTS } from '@/lib/license/features';
import { WEBHOOK_EVENT_TYPES } from '@/lib/validations/webhook';
import { WEBHOOK_EVENTS } from '@/types/webhooks';

const lifecycle = ['license.issued', 'license.revoked', 'license.restored', 'license.expired', 'license.updated'];
it('gates every license event behind the Pro license webhook feature', () => {
  for (const event of lifecycle) expect((EVENT_FEATURE_REQUIREMENTS as Record<string, string>)[event]).toBe('license-revoked-webhook');
});
it('accepts subscriptions to all license events and lists the emitted ones in the panel', () => {
  for (const event of lifecycle) expect(WEBHOOK_EVENT_TYPES).toContain(event);
  const listed = WEBHOOK_EVENTS.map(e => e.value);
  for (const event of ['license.issued', 'license.expired']) expect(listed).toContain(event);
  expect(listed).toContain('license.updated');
});
