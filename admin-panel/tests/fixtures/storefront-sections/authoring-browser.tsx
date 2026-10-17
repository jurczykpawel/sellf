import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import StorefrontEditor from '@/components/storefront-editor/StorefrontEditor';
import TemplateHistory from '@/components/storefront/TemplateHistory';
import { D_CONFIG, DEFAULT_CONFIG } from '@/lib/storefront-templates/fixtures';
import { validateConfig } from '@/lib/storefront-templates/registry';
import { templateRightsForTier } from '@/lib/storefront-templates/rights';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import type { TemplateReadResult } from '@/lib/storefront-templates/lifecycle';

const locale = location.pathname.startsWith('/pl') ? 'pl' : 'en';
const draft = structuredClone(D_CONFIG);
delete draft.settingsByTemplate.d!.closingProduct;
const initial: TemplateReadResult = {
  revision: 3, draft, published: DEFAULT_CONFIG, effectiveTemplateId: 'd', unusedSlots: [], effectiveTokens: [],
  rights: { ...templateRightsForTier('business'), canPublish: [] }, validation: validateConfig(draft),
};
createRoot(document.getElementById('root')!).render(
  <NextIntlClientProvider locale={locale} messages={locale === 'pl' ? pl : en}>
    {location.pathname.endsWith('/history') ? <TemplateHistory /> : <StorefrontEditor initial={initial} />}
  </NextIntlClientProvider>,
);
