/** Checkout offers a transfer for an event only when the reservation window ends before the session starts (server enforces the same). */
import { expect, it } from 'vitest';
import { transferFitsSession } from '@/lib/orders/bank-transfer-config';
const now = Date.parse('2026-02-01T12:00:00Z');
it.each([
  ['session after the 48 h window', '2026-02-03T12:00:01Z', 48, true],
  ['session exactly at the release time', '2026-02-03T12:00:00Z', 48, false],
  ['session inside the window', '2026-02-02T12:00:00Z', 48, false],
  ['timed reservation off', '2026-02-01T13:00:00Z', null, true],
  ['no session chosen yet', undefined, 48, true],
] as const)('%s', (_, startsAt, hours, expected) => expect(transferFitsSession(startsAt, hours, now)).toBe(expected));
