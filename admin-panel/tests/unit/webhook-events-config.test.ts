import { describe, expect, it } from 'vitest';
import enMessages from '@/messages/en.json';
import plMessages from '@/messages/pl.json';
import { WEBHOOK_EVENT_TYPES } from '@/lib/validations/webhook';
import { WEBHOOK_MOCK_PAYLOADS } from '@/lib/webhooks/mock-payloads';
import { WEBHOOK_EVENTS } from '@/types/webhooks';

function eventTranslationKey(eventType: string) {
  return eventType.replace(/\./g, '_');
}

describe('webhook events configuration', () => {
  it('keeps active admin events wired to validation, preview payloads, and translations', () => {
    const validEventTypes = new Set<string>(WEBHOOK_EVENT_TYPES);

    for (const event of WEBHOOK_EVENTS) {
      const key = eventTranslationKey(event.value);

      expect(validEventTypes.has(event.value), `${event.value} is not accepted by validation`).toBe(true);
      expect(WEBHOOK_MOCK_PAYLOADS[event.value], `${event.value} has no mock payload`).toBeTruthy();
      expect(
        enMessages.admin.webhooks.events_list[key as keyof typeof enMessages.admin.webhooks.events_list],
        `${event.value} is missing EN translation`
      ).toBeTruthy();
      expect(
        plMessages.admin.webhooks.events_list[key as keyof typeof plMessages.admin.webhooks.events_list],
        `${event.value} is missing PL translation`
      ).toBeTruthy();
    }
  });
});
