/** Server-rendered section fixture; native disclosures need no application script. */
import { renderToStaticMarkup } from 'react-dom/server';
import Faq from '@/components/storefront/sections/Faq';
import ProductCta from '@/components/storefront/sections/ProductCta';
import { closingFixture, faqFixture } from './faq-closing';

const locale = process.argv[2] === 'pl' ? 'pl' : 'en';
const state = process.argv[3];
const faq = faqFixture(locale, state === 'long');
const closing = closingFixture(locale, state === 'free' ? 'free' : state === 'subscription' ? 'subscription' : state === 'pwyw' ? 'pwyw' : 'one-time');
if (state === 'empty') { faq.content = null; closing.content = null; }
if (state === 'missing') closing.product = null;
if (state === 'unavailable') closing.product!.availability = 'unavailable';
if (state === 'buy') closing.action = 'buy';
if (state === 'long') {
  closing.content = { kind: 'cta', heading: 'W'.repeat(160), body: 'Żółć '.repeat(800) };
  closing.product!.title = 'W'.repeat(240);
}
process.stdout.write(renderToStaticMarkup(<><main><h1>Store fixture</h1><Faq {...faq} /><ProductCta {...closing} /></main>
  <footer><a href={`/${locale}/terms`}>{locale === 'pl' ? 'Regulamin' : 'Terms'}</a><a href={`/${locale}/privacy`}>{locale === 'pl' ? 'Prywatność' : 'Privacy'}</a></footer></>));
