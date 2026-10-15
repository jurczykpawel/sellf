/** Synthetic FAQ and closing inputs, with no seller claims. */
import type { FaqProps, ProductCtaProps } from '@/lib/storefront-templates/faq-closing';

export function faqFixture(locale: 'en' | 'pl', long = false): FaqProps {
  return { locale, content: { kind: 'faq', items: Array.from({ length: long ? 20 : 3 }, (_, i) => ({
    id: `question-${i}`, question: long ? 'Q'.repeat(240) : locale === 'pl' ? `Gdzie znajdę wymagania? ${i + 1}` : `Where are the requirements? ${i + 1}`,
    answer: long ? 'Żółć '.repeat(800) : locale === 'pl' ? 'Wymagania znajdziesz przy ofercie produktu.' : 'Requirements are listed alongside the product offer.',
  })) } };
}
export function closingFixture(locale: 'en' | 'pl', kind: 'free' | 'one-time' | 'subscription' | 'pwyw' = 'one-time'): ProductCtaProps {
  return { locale, action: 'details', content: { kind: 'cta', heading: locale === 'pl' ? 'Przeczytaj szczegóły warsztatu' : 'Read the workshop details',
    body: locale === 'pl' ? 'Sprawdź ofertę produktu przed zakupem.' : 'Review the current product offer before buying.' }, product: {
    id: '11111111-1111-4111-8111-111111111111', slug: 'example-workshop', title: 'Example workshop',
    price: { kind, display: { free: '0 zł', 'one-time': '49 zł', subscription: '0 zł / month', pwyw: 'From 5 zł' }[kind], taxNote: kind === 'free' ? null : 'VAT 23%', omnibus: kind === 'one-time' ? 'Lowest price: 45 zł' : null },
    marketing: { format: 'other', sourceLocale: 'en', en: { result: null, tools: [], requirements: [] } }, image: null,
    actions: { details: `/${locale}/p/example-workshop`, buy: `/${locale}/checkout/example-workshop` }, availability: 'available',
  } };
}
