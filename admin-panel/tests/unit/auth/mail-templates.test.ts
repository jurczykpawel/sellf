/** Auth email bodies and deployment copies. @see supabase/templates/README.md */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

it.each(['confirmation', 'magic-link'])('%s includes conditional purchase details in both languages', name => {
  const html = readFileSync(path.resolve(__dirname, `../../../../supabase/templates/${name}.html`), 'utf8');
  expect(html).toContain('{{ if eq .Data.locale "en" }}');
  for (const field of ['event_date', 'event_online_url', 'transfer_text', 'purchase_product', 'purchase_amount', 'release_text', 'pay_url', 'participants_url']) {
    expect(html).toContain(`{{ if .Data.${field} }}`);
  }
  for (const kind of ['transfer_placed', 'payment_reminder', 'order_cancelled', 'participants_needed']) expect(html).toContain(`eq .Data.mail_kind "${kind}"`);
  expect(html).toBe(readFileSync(path.resolve(__dirname, `../../../public/auth-email-templates/${name}.html`), 'utf8'));
});
