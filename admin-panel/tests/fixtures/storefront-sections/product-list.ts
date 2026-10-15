/** Synthetic starters; prices/actions stand in for the bounded core DTO. */
import type { PublicProductInfo } from '@/lib/storefront-templates/catalogue';
import type { ProductListInputs, ProductListSpec } from '@/lib/storefront-templates/sections/product-list';

export const starterProducts: PublicProductInfo[] = ['free', 'subscription', 'one-time'].map((kind, index) => ({
  id: `${index + 1}1111111-1111-4111-8111-111111111111`, slug: `starter-${index}`, title: ['First report', 'Practice library', 'Workflow workshop'][index],
  price: { kind: kind as PublicProductInfo['price']['kind'], display: ['Free', '0 PLN / month', '39 PLN'][index], taxNote: index === 2 ? 'Including VAT 23%' : null, omnibus: index === 2 ? 'Lowest prior price: 49 PLN' : null },
  marketing: { format: 'workshop', sourceLocale: 'en', en: { result: 'Build a report using a synthetic dataset.', tools: ['Spreadsheet'], requirements: ['A practice dataset'] } },
  image: index === 1 ? null : { src: 'https://media.example.test/starter.png', alt: 'Synthetic report diagram', width: 800, height: 500 },
  actions: { details: `/en/p/starter-${index}`, buy: `/en/checkout/starter-${index}` }, availability: 'available',
}));
export const starterSpec: ProductListSpec = { id: 'start', type: 'product-list/1', variant: 'detail-cards', products: { setting: 'starterProducts' }, content: { slot: 'home.starts' } };
export function starterInputs(): ProductListInputs {
  return { locale: 'en', settings: { starterProducts: starterProducts.map(product => product.id) }, productsById: Object.fromEntries(starterProducts.map(product => [product.id, product])),
    slots: { 'home.starts': { kind: 'heading', heading: 'Three starting points', body: 'Choose a product matching your current skills.' } } };
}
