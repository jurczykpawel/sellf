/** One public section dispatcher for canonical and snapshot rendering. @see lib/storefront-templates/resolver.ts */
import { heroProductDefinition } from '@/lib/storefront-templates/hero-product';
import { PRODUCT_LIST_SECTION } from '@/components/storefront/sections/ProductList';
import TaskNav from '@/components/storefront/sections/TaskNav';
import Catalogue from '@/components/storefront/sections/Catalogue';
import Faq from '@/components/storefront/sections/Faq';
import ProductCta from '@/components/storefront/sections/ProductCta';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import { catalogueLabels } from '@/lib/storefront-templates/catalogue-section';
import type { PresentationModel, ResolvedSection } from '@/lib/storefront-templates/resolver';
import styles from './StorefrontComposition.module.css';

function Section({ section }: { section: ResolvedSection }) {
  switch (section.type) {
    case 'hero-product/1': return <heroProductDefinition.Component {...section.props} />;
    case 'task-nav/1': return <TaskNav {...section.props} />;
    case 'product-list/1': return <div className={styles.starters}><PRODUCT_LIST_SECTION.Component {...section.props} /></div>;
    case 'catalogue/1': return <Catalogue {...section.props} />;
    case 'faq/1': return <Faq {...section.props} />;
    case 'product-cta/1': return <ProductCta {...section.props} />;
  }
}
export default function StorefrontComposition({ model, shopName, renderKey }: { model: PresentationModel; shopName: string; renderKey: string }) {
  const messages = (model.locale === 'pl' ? pl : en).storefront;
  const products = [...new Map(Object.values(model.catalogue.groups).flatMap(page => page?.products.map(p => [p.id, p] as const) ?? [])).values()];
  const freeCount = products.filter(p => p.price.kind === 'free').length;
  const paidCount = products.length - freeCount;
  const hero = freeCount && paidCount ? messages.hero.mixed : freeCount ? messages.hero.freeOnly : messages.hero.paidOnly;
  const complete = Object.values(model.catalogue.groups).every(page => !page?.nextCursor);
  const description = hero.description.replace('{count}', String(products.length)).replace('{freeCount}', String(freeCount)).replace('{paidCount}', String(paidCount));
  return <div data-testid="storefront" data-template={model.templateId}>
    {model.templateId === 'default' && <header className={styles.brand}>
      <div><h1>{products.length ? <>{hero.title} <span>{hero.titleHighlight}</span></> : shopName}</h1>
        {complete && products.length > 0 && <p>{description}</p>}
      </div>
      {complete && <dl aria-label={catalogueLabels[model.locale].shown}>
        <div><dt>{messages.brandMoment.statsProducts}</dt><dd>{products.length}</dd></div>
        {freeCount > 0 && <div><dt>{messages.brandMoment.statsFree}</dt><dd>{freeCount}</dd></div>}
        {paidCount > 0 && <div><dt>{messages.brandMoment.statsPremium}</dt><dd>{paidCount}</dd></div>}
      </dl>}
      <p>{catalogueLabels[model.locale].shown}</p>
    </header>}
    {model.sections.map(section => <Section key={`${renderKey}:${model.templateId}:${section.id}`} section={section} />)}
    <footer className="border-t border-sf-border px-6 py-8 text-center text-sf-muted">
      <p>{(model.locale === 'pl' ? pl : en).storefront.footer.poweredBy.replace('{shopName}', shopName)}</p>
    </footer>
  </div>;
}
