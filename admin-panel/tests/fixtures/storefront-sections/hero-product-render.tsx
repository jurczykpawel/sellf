/** Prerender the real section for browser tests with JavaScript disabled. */
import { renderToStaticMarkup } from 'react-dom/server';
import HeroProduct from '@/components/storefront/sections/HeroProduct';
import { heroProductCases } from './hero-product';

const pages: Record<string, string> = {};
for (const locale of ['en', 'pl'] as const) {
  for (const variant of ['split-process', 'simple'] as const) {
    for (const [name, props] of Object.entries(heroProductCases(locale))) {
      pages[`${locale}/${variant}/${name}`] = renderToStaticMarkup(<HeroProduct {...props} variant={variant} />);
    }
  }
}
process.stdout.write(JSON.stringify(pages));
