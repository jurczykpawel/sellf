/** Full public composition first paint. */
import { renderToString } from 'react-dom/server';
import StorefrontComposition from '@/components/storefront/StorefrontComposition';
import { compositionFixture } from './composition';
const pages = Object.fromEntries((['en', 'pl'] as const).flatMap(locale => (['default', 'd'] as const).map(template => {
  const model = compositionFixture(locale, template);
  return [`${locale}/${template}`, { model, html: renderToString(<StorefrontComposition renderKey="initial" model={model} shopName="Example shop" year={2026} showSellfBranding={false} />) }];
})));
process.stdout.write(JSON.stringify(pages));
