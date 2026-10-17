/** @see src/components/UpgradeInstructions.tsx */
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

describe('deployment instruction translations', () => {
  it.each([['en', en], ['pl', pl]] as const)('formats every %s instruction as plain text', (locale, messages) => {
    const translate = createTranslator({ locale, messages, namespace: 'systemUpdate', onError: error => { throw error; } });
    for (const runtime of ['docker', 'compose', 'coolify', 'pm2', 'systemd', 'vercel', 'netlify', 'manual'] as const) {
      expect(translate(`deployment.${runtime}`, { version: '2026.11.0' })).toContain('2026.11.0');
    }
    expect(translate('deployment.migrations')).toContain('bunx supabase db push');
  });
});
