/** Browser fixture for production starter variants; no application services. */
import { createRoot } from 'react-dom/client';
import ProductList from '@/components/storefront/sections/ProductList';
import { resolveProductList } from '@/lib/storefront-templates/sections/product-list';
import { starterInputs, starterSpec } from './product-list';

const query = new URLSearchParams(location.search);
const locale = query.get('locale') === 'pl' ? 'pl' : 'en';
const variant = query.get('variant') === 'compact' ? 'compact' : 'detail-cards';
const inputs = starterInputs();
inputs.locale = locale;
const props = resolveProductList({ ...starterSpec, variant }, inputs);
if (locale === 'pl') props.content = { kind: 'heading', heading: 'Trzy punkty startu', body: 'Wybierz materiał pasujący do Twoich umiejętności.' };
for (const product of props.products) product.actions.details = product.actions.details.replace('/en/', `/${locale}/`);
switch (query.get('state')) {
  case 'bare': props.content = null; break;
  case 'empty': props.products = []; break;
  case 'missing': props.products = props.products.map(product => ({ ...product, image: null })); break;
  case 'unavailable': props.products = props.products.map(product => ({ ...product, availability: 'unavailable' })); break;
  case 'pwyw': props.products = [{ ...props.products[0], price: { kind: 'pwyw', display: 'From 5 PLN', taxNote: null, omnibus: null } }]; break;
  case 'long': props.products = props.products.map(product => ({ ...product, title: 'Żółćąę '.repeat(30), marketing: { format: 'workshop', sourceLocale: 'pl', pl: { result: 'ą'.repeat(240), tools: ['Żółć'.repeat(20)], requirements: ['ę'.repeat(240)] } } })); break;
}
createRoot(document.getElementById('root')!).render(<><header><h1>Storefront fixture</h1></header><main><ProductList {...props} /></main><footer><a href={`/${locale}/terms`}>Terms fixture</a><p>Core notice fixture</p></footer></>);
