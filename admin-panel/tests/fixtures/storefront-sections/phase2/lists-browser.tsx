/** Functional Phase 2 sections with matching synthetic reference inputs. */
import { createRoot } from 'react-dom/client';
import ProductList from '@/components/storefront/sections/ProductList';
import Catalogue from '@/components/storefront/sections/Catalogue';
import { resolveProductList } from '@/lib/storefront-templates/sections/product-list';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import { phase2SectionSchema } from '@/lib/storefront-templates/phase2-contracts';
import { referenceConfig, phase2Recipes } from './contracts';
import { referenceCopy, referenceProducts } from './reference';

const query = new URLSearchParams(location.search);
const locale = query.get('locale') === 'pl' ? 'pl' : 'en';
const variant = query.get('variant') || 'featured-grid';
const t = referenceCopy[locale];
const products = referenceProducts(locale).map((p, i) => ({ ...p, price: { ...p.price, display: p.price.kind === 'free' ? (locale === 'pl' ? pl : en).checkout.customPrice.freePreset : p.price.display }, image: { ...p.image!, src: 'https://lists.test/sample.svg' }, ...(query.has('long') ? { title: 'ŻółćExample'.repeat(24) } : {}), ...(query.has('missing') ? { image: null, marketing: { ...p.marketing, format: null } } : {}), ...(query.has('unavailable') ? { availability: 'unavailable' as const } : {}), ...(i === 2 && query.has('prices') ? { price: { kind: 'subscription' as const, display: '0 PLN / month', taxNote: 'Tax note', omnibus: 'Prior price' } } : {}) }));
const config = referenceConfig();
const comparison = { ...config.content['home.comparison'][locale], eyebrow: t.distinct, actionLabel: t.view };
const featured = { ...config.content['home.featured'][locale], eyebrow: t.eyebrow, actionLabel: t.view, detailsLabel: t.details, detailActionLabel: t.action, items: products.map((p, i) => ({ productId: p.id, eyebrow: i === 0 ? t.free : t.product, descriptor: t.format, detailHeading: p.title, detailBody: t.receive, requirementsLabel: t.requires })) };
const spec = phase2SectionSchema.parse(variant === 'comparison' ? phase2Recipes.a.sections[2] : phase2Recipes.b.sections[1]);
if (spec.type !== 'product-list/1') throw new Error('Expected list');
const props = resolveProductList(spec, { locale, settings: { comparisonProducts: products.slice(0, 2).map(p => p.id), featuredProducts: products.map(p => p.id) }, productsById: Object.fromEntries(products.map(p => [p.id, p])), slots: { 'home.comparison': comparison, 'home.featured': featured } });
createRoot(document.getElementById('root')!).render(<main>{variant === 'compact' ? <Catalogue variant="compact" id="catalogue" locale={locale} content={{ kind: 'heading', heading: t.catalogueTitle, body: t.requirement, eyebrow: t.eyebrow }} groups={{ all: { products: query.has('empty') ? [] : products, nextCursor: 'cursor-6' } }} pageSize={24} density="compact" filters={['category', 'price-kind', 'format']} categories={[{ id: products[0].id, label: t.tasks[0], filterTarget: 'catalogue' }]} /> : <div className="list-wrap"><ProductList {...props} products={query.has('empty') ? [] : props.products} /></div>}</main>);
