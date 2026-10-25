/**
 * Webhook URL validation exposes a stable `reason` code so the panel can show
 * the message in the interface language while the API keeps returning English.
 */

import { describe, it, expect } from 'vitest';
import { isValidWebhookUrl, WEBHOOK_URL_REASONS } from '@/lib/validations/webhook';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

describe('webhook URL reason codes', () => {
  it.each([
    ['https://127.0.0.1/hook', 'loopback'],
    ['http://localhost/hook', 'https_required'],
    ['https://localhost/hook', 'localhost'],
    ['https://10.1.2.3/hook', 'private_ip'],
    ['https://169.254.169.254/hook', 'link_local'],
    ['ftp://example.com/hook', 'https_required'],
    ['not a url', 'invalid_format'],
  ])('%s -> %s', (url, reason) => {
    const result = isValidWebhookUrl(url);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe(reason);
  });

  it('has a translation for every reason in both locales', () => {
    for (const reason of WEBHOOK_URL_REASONS) {
      expect(en.admin.webhooks.urlErrors[reason], `en ${reason}`).toBeTruthy();
      expect(pl.admin.webhooks.urlErrors[reason], `pl ${reason}`).toBeTruthy();
    }
  });
});
