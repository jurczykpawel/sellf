/** Real T2.5 sections with the real catalogue event receiver; bounded public fixtures. */
import { createRoot } from 'react-dom/client';
import HeroProduct from '@/components/storefront/sections/HeroProduct';
import TaskNav from '@/components/storefront/sections/TaskNav';
import ProductCta from '@/components/storefront/sections/ProductCta';
import Catalogue from '@/components/storefront/sections/Catalogue';
import { phase2StorefrontRecipeSchema } from '@/lib/storefront-templates/phase2-contracts';
import { resolveSharedPhase2Section } from '@/lib/storefront-templates/phase2-shared';
import { referenceConfig, phase2Recipes } from './contracts';
import { referenceProducts, referenceCategories } from './reference';

const query = new URLSearchParams(location.search);
const locale = query.get('locale') === 'pl' ? 'pl' : 'en';
const concept = query.get('concept') === 'a' ? 'a' : 'b';
const config = referenceConfig();
const recipe = phase2StorefrontRecipeSchema.parse(phase2Recipes[concept]);
const slots: Record<string, unknown> = Object.fromEntries(Object.entries(config.content).map(([key, value]) => [key, value[locale] ?? value.en]));
if (query.has('long')) for (const key of ['home.hero', 'home.search', 'home.closing']) {
  const value = slots[key] as { heading: string; body: string };
  value.heading = 'ąŻLongExample'.repeat(12);
  value.body = 'Long illustrative text '.repeat(80);
}
if (query.has('empty')) for (const key of Object.keys(slots)) delete slots[key];
const products = referenceProducts(locale);
if (query.has('unavailable')) products[1].availability = 'unavailable';
if (query.has('no-media')) products[1].image = null;
if (query.has('price')) products[1].price = { ...products[1].price, kind: query.get('price') as 'free' | 'subscription' | 'pwyw', display: query.get('price') === 'subscription' ? '49 PLN / month' : '0 PLN', taxNote: 'Tax included', omnibus: 'Lowest price: 39 PLN' };
const categories = query.has('empty') ? [] : referenceCategories(locale);
const inputs = { locale, settings: config.settingsByTemplate[concept === 'a' ? 'storefront-a' : 'storefront-b'], slots,
  productsById: Object.fromEntries(products.map(product => [product.id, product])), categoriesById: Object.fromEntries(categories.map(category => [category.id, category])) };
const hero = resolveSharedPhase2Section(recipe.sections[0], inputs, recipe);
const closing = resolveSharedPhase2Section(recipe.sections.at(-1), inputs, recipe);
if (!hero.success || !closing.success) throw new Error('Invalid fixture');
const section = hero.data;
document.documentElement.lang = locale;
createRoot(document.getElementById('root')!).render(<main>
  {section.type === 'hero-product/1' ? <HeroProduct {...section.props} /> : section.type === 'task-nav/1' ? <TaskNav {...section.props} /> : null}
  <div data-closing>{closing.data.type === 'product-cta/1' && <ProductCta {...closing.data.props} />}</div>
  {!query.has('geometry') && <Catalogue id="catalogue" variant="detail-cards" locale={locale} filters={['category', 'price-kind', 'format']} pageSize={24} density="comfortable" categories={categories} groups={{ all: { products: products.map(product => ({ ...product, image: null })), nextCursor: null } }} />}
  {query.has('geometry') && <section id="catalogue"><h2>Catalogue</h2></section>}
  <footer><a href={`/${locale}/terms`}>{locale === 'pl' ? 'Regulamin' : 'Terms'}</a></footer>
</main>);
