/** Legal setup points to the current shop settings tab. @see components/settings/LegalDocumentsSettings.tsx */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
it('uses the Shop tab in country and contact-email guidance', () => {
  const source = readFileSync('src/components/settings/LegalDocumentsSettings.tsx', 'utf8');
  for (const key of ['notPolishShopNotice', 'contactEmailShopNotice']) expect(source).toContain(`t('${key}')`);
  expect(pl.settings.legal.notPolishShopNotice).toContain('Ustawienia → Sklep');
  expect(en.settings.legal.contactEmailShopNotice).toContain('Settings → Store');
});
