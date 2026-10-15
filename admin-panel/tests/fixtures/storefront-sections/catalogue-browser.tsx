/** Isolated catalogue browser entry; only a bounded initial page is serialized. */
import { createRoot } from 'react-dom/client';
import Catalogue from '@/components/storefront/sections/Catalogue';
import { catalogueFixture } from './catalogue';

const params = new URLSearchParams(location.search);
const props = catalogueFixture(params.get('variant') === 'default-groups' ? 'default-groups' : 'detail-cards');
props.locale = params.get('locale') === 'pl' ? 'pl' : 'en';
props.pageSize = Number(params.get('size') ?? 9) as 9 | 12 | 24;
if (params.get('empty')) props.groups = { all: { products: [], nextCursor: null } };
if (params.get('long'))
  for (const page of Object.values(props.groups))
    for (const product of page!.products) {
      product.title = 'ąŻExample'.repeat(28);
      product.marketing.en!.result = 'VeryLongResult'.repeat(16);
    }
for (const page of Object.values(props.groups))
  for (const product of page!.products) {
    product.actions.details = `/${props.locale}/p/${product.slug}`;
    if (params.get('media'))
      product.image = { src: 'https://catalogue.test/cover.svg', alt: product.title, width: 800, height: 500 };
  }
document.documentElement.lang = props.locale;
createRoot(document.getElementById('root')!).render(
  <main>
    <h1>Storefront fixture</h1>
    <Catalogue {...props} />
  </main>,
);
