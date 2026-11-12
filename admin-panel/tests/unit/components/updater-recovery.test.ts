/** The panel explains blocked updates in both supported languages. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { expect, it } from 'vitest';
import UpgradeInstructions from '@/components/UpgradeInstructions';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

it.each([['pl', pl], ['en', en]] as const)('shows the required updater and the Stackpilot command in %s', (locale, messages) => {
  const html = renderToStaticMarkup(React.createElement(NextIntlClientProvider, { locale, messages },
    React.createElement(UpgradeInstructions, { updateInfo: {
      current_version: '2026.10.6', latest_version: '2026.11.0', update_available: true,
      release_notes: null, published_at: null, release_url: null,
      upgrade: { runtime: 'pm2', mode: 'manual' },
      updater: { version: 1, min_updater_version: 3, compatible: false, reason: 'too_old' },
    } })));
  expect(html).toContain('3');
  expect(html).toContain('./local/deploy.sh sellf --ssh=&lt;server&gt; --update');
  expect(html).toContain('Stackpilot');
});
