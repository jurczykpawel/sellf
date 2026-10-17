/** Login field guidance. @see components/LoginForm.tsx */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
it('uses password entry guidance rather than an example password', () => {
  const source = readFileSync('src/components/LoginForm.tsx', 'utf8');
  expect(source).toContain("placeholder={t('auth.passwordEntryPlaceholder')}");
  for (const messages of [en, pl]) expect(messages.auth.passwordEntryPlaceholder).not.toMatch(/demo123/);
});
