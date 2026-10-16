/** Offer references reuse the shipped simple hero, FAQ and core buy CTA. */
import { renderToStaticMarkup } from 'react-dom/server';
import HeroProduct from '@/components/storefront/sections/HeroProduct';
import Faq from '@/components/storefront/sections/Faq';
import ProductCta from '@/components/storefront/sections/ProductCta';
import { D_TOKENS } from '@/lib/storefront-templates/fixtures';
import type { CSSProperties } from 'react';
import { referenceConfig } from './contracts';
import { referenceProducts } from './reference';

const color = D_TOKENS.light;
const style = { '--sf-font-family': 'FixtureGeist', '--sf-font-body-weight': 400, '--sf-font-heading-weight': 600,
  '--sf-text-heading': color.foreground, '--sf-text-body': color.mutedForeground, '--sf-accent': color.accent, '--sf-accent-fg': color.accentForeground,
  '--sf-bg-raised': color.muted, '--sf-border': color.border, '--sf-radius-sm': '4px', '--sf-radius-md': '12px', '--sf-radius-lg': '16px' } as CSSProperties;
const content = referenceConfig().content;
process.stdout.write(JSON.stringify(Object.fromEntries((['en', 'pl'] as const).map(locale => {
  const product = referenceProducts(locale)[1];
  return [locale, renderToStaticMarkup(<main style={style}>
    <HeroProduct variant="simple" product={product} content={content['home.hero'][locale]} locale={locale} />
    <Faq content={content['home.faq'][locale]} locale={locale} />
    <div data-offer-card><ProductCta product={product} content={content['home.closing'][locale]} action="buy" locale={locale} /></div>
  </main>)];
}))));
