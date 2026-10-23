/** Every selectable webhook event has a localized description. @see types/webhooks.ts */
import { expect, it } from 'vitest';
import { WEBHOOK_EVENTS } from '@/types/webhooks';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

it.each([['en', en], ['pl', pl]] as const)('%s describes every selectable webhook event', (_locale, messages) => {
  const descriptions = messages.admin.webhooks.events_desc as Record<string, string>;
  for (const event of WEBHOOK_EVENTS) {
    expect(descriptions[event.value.replaceAll('.', '_')], event.value).toBeTruthy();
  }
});
