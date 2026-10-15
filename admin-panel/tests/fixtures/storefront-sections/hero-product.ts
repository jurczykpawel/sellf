/** Synthetic hero inputs shared by section unit and browser checks. */
import type { HeroProductProps } from '@/lib/storefront-templates/hero-product';

export function heroProductFixture(locale: 'en' | 'pl' = 'en'): HeroProductProps {
  return {
    locale, variant: 'split-process',
    content: locale === 'en'
      ? { kind: 'hero', eyebrow: 'Example workshop', heading: 'Input.\nWorkflow. Report.\nOne workspace.', body: 'Build an automated report with a synthetic dataset. Review each step at your own pace.', steps: ['Choose the input', 'Build the workflow', 'Review the report'] }
      : { kind: 'hero', eyebrow: 'Przykładowy warsztat', heading: 'Dane.\nProces. Raport.\nJeden arkusz.', body: 'Zbuduj automatyczny raport na przykładowych danych. Sprawdź każdy krok we własnym tempie.', steps: ['Wybierz dane', 'Zbuduj proces', 'Sprawdź raport'] },
    product: {
      id: '11111111-1111-4111-8111-111111111111', slug: 'example-workshop', title: 'Example workshop',
      price: { display: '99 zł', kind: 'one-time', taxNote: locale === 'en' ? 'Including VAT 23%' : 'W tym VAT 23%', omnibus: null },
      marketing: { format: 'workshop', sourceLocale: 'en', en: { result: null, tools: [], requirements: [] } },
      image: { src: 'https://media.example.test/workshop.webp', alt: 'Example workshop diagram', width: 800, height: 500 },
      actions: { details: `/${locale}/p/example-workshop`, buy: `/${locale}/checkout/example-workshop` }, availability: 'available',
    },
  };
}

export const HERO_FIXTURE_IDS = ['paid', 'free', 'subscription', 'pwyw', 'empty', 'unavailable', 'missing-media', 'long'] as const;

export function heroProductCases(locale: 'en' | 'pl'): Record<typeof HERO_FIXTURE_IDS[number], HeroProductProps> {
  const paid = heroProductFixture(locale);
  const change = () => heroProductFixture(locale);
  const free = change(); free.product!.price = { kind: 'free', display: locale === 'pl' ? 'Za darmo' : 'Free', taxNote: null, omnibus: null };
  const subscription = change(); subscription.product!.price = { kind: 'subscription', display: locale === 'pl' ? '0 zł / miesiąc' : '$0 / month', taxNote: null, omnibus: null };
  const pwyw = change(); pwyw.product!.price = { kind: 'pwyw', display: locale === 'pl' ? 'Od 5 zł' : 'From $5', taxNote: null, omnibus: null };
  const empty = change(); empty.product = null; empty.content = null;
  const unavailable = change(); unavailable.product!.availability = 'unavailable';
  const missing = change(); missing.product!.image = null;
  const long = change(); long.content = { kind: 'hero', eyebrow: 'Żółć'.repeat(20), heading: 'Źdźbło'.repeat(26), body: 'Ą'.repeat(4000), steps: Array.from({ length: 6 }, () => 'Ę'.repeat(240)) };
  return { paid, free, subscription, pwyw, empty, unavailable, 'missing-media': missing, long };
}

/** Input for the real catalogue projection, never a section prop. */
export function heroProductRow() {
  const product = heroProductFixture().product!;
  return { id: product.id, slug: product.slug, name: product.title, created_at: '2026-01-01T00:00:00Z',
    price: 20, currency: 'USD', product_type: 'one_time', recurring_price: null, billing_interval: null, billing_interval_count: null,
    allow_custom_price: false, custom_price_min: null, sale_price: null, sale_price_until: null, sale_quantity_limit: null,
    sale_quantity_sold: 0, marketing_fields: product.marketing, image_url: product.image!.src, vat_rate: 23, vat_exempt: false,
    vat_exempt_note: null, price_includes_vat: true, tax_mode: 'local', lowest_prior_price: null,
    content_config: 'PRIVATE_CONTENT', customer: 'PRIVATE_CUSTOMER', license_key: 'PRIVATE_KEY' };
}
