/** Registered transition samples contain the fields an integration needs to act. */
import { expect, it } from 'vitest';
import { WEBHOOK_EVENTS } from '@/types/webhooks';
import { validateEventTypes } from '@/lib/validations/webhook';
import { WEBHOOK_MOCK_PAYLOADS } from '@/lib/webhooks/mock-payloads';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

it.each(['order.abandoned', 'access.granted', 'access.updated', 'access.revoked', 'access.expired', 'seats.held', 'seats.confirmed', 'seats.released'])('registers %s with usable actor, state and identity fields', event => {
  expect(WEBHOOK_EVENTS.some(entry => entry.value === event)).toBe(true);
  expect(validateEventTypes([event]).valid).toBe(true);
  const data = WEBHOOK_MOCK_PAYLOADS[event];
  expect(data.actor.type).toBe('system'); expect(data.reason).toEqual(expect.any(String));
  if (event.startsWith('access.')) expect(data.access).toMatchObject({ id: expect.any(String), statusBefore: expect.any(String), statusAfter: expect.any(String), grantedAt: expect.any(String), expiresAt: expect.any(String) });
  else if (event.startsWith('seats.')) expect(data.reservation).toMatchObject({ id: expect.any(String), sessionId: expect.any(String), tierId: expect.any(String), quantity: 2, statusAfter: event.split('.')[1] });
  else expect(data).toMatchObject({ amountUnit: 'minor', order: { orderId: expect.any(String), orderNumber: expect.any(Number), statusBefore: 'pending', statusAfter: 'abandoned', taxSnapshotStatus: 'unavailable' } });
  for (const messages of [en, pl]) expect(JSON.stringify(messages).match(new RegExp(`"${event.replace('.', '_')}":`, 'g'))).toHaveLength(2);
});
