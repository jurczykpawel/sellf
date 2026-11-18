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

it.each([['en', en], ['pl', pl]] as const)('%s explains the recommended Stripe webhook permission', (_locale, messages) => {
  expect(messages).toHaveProperty('stripe.wizard.step3.step4.webhookRecommendedNote', expect.any(String));
});
