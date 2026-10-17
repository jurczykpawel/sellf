/** One public section dispatcher for canonical and snapshot rendering. @see lib/storefront-templates/resolver.ts */
import { heroProductDefinition } from '@/lib/storefront-templates/hero-product';
import { PRODUCT_LIST_SECTION } from '@/components/storefront/sections/ProductList';
import AuthorHero from '@/components/storefront/sections/AuthorHero';
import AuthorStory from '@/components/storefront/sections/AuthorStory';
import ProductPaths from '@/components/storefront/sections/ProductPaths';
import ProjectShowcase from '@/components/storefront/sections/ProjectShowcase';
import TaskNav from '@/components/storefront/sections/TaskNav';
import Catalogue from '@/components/storefront/sections/Catalogue';
import Faq from '@/components/storefront/sections/Faq';
import ProductCta from '@/components/storefront/sections/ProductCta';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import { catalogueLabels } from '@/lib/storefront-templates/catalogue-section';
import type { PresentationModel, ResolvedSection } from '@/lib/storefront-templates/resolver';
import styles from './StorefrontComposition.module.css';

function Section({ section, templateId }: { section: ResolvedSection; templateId: string }) {
  switch (section.type) {
    case 'author-hero/1': return <AuthorHero {...section.props} />;
    case 'author-story/1': return <AuthorStory {...section.props} />;
    case 'product-paths/1': return <div id={section.id}><ProductPaths {...section.props} /></div>;
    case 'project-showcase/1': return <ProjectShowcase {...section.props} />;
    case 'hero-product/1': return <heroProductDefinition.Component {...section.props} />;
    case 'task-nav/1': return <div className={templateId === 'storefront-a' ? styles.categories : undefined}><TaskNav {...section.props} /></div>;
    case 'product-list/1': return <div className={section.props.variant === 'comparison' ? undefined : styles.starters}><PRODUCT_LIST_SECTION.Component {...section.props} /></div>;
    case 'catalogue/1': return <Catalogue {...section.props} />;
    case 'faq/1': return <Faq {...section.props} />;
    case 'product-cta/1': return <ProductCta {...section.props} />;
  }
}
/** `year` and `showSellfBranding` come from the server so first paint and hydration agree. */
export default function StorefrontComposition({ model, shopName, renderKey, year, showSellfBranding }: { model: PresentationModel<string>; shopName: string; renderKey: string; year: number; showSellfBranding: boolean }) {
  const messages = (model.locale === 'pl' ? pl : en).storefront;
  const footer = messages.footer;
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
    {model.sections.map(section => <Section templateId={model.templateId} key={`${renderKey}:${model.templateId}:${section.id}`} section={section} />)}
    <footer className={(model.templateId === 'storefront-a' || model.templateId === 'storefront-b' || model.templateId === 'storefront-c') ? styles.footer : "border-t border-sf-border px-6 py-8 text-center text-sf-muted"}>
      <p>{footer.copyright.replace('{year}', String(year)).replace('{shopName}', shopName)}</p>
      {showSellfBranding && <p className="mt-2 text-xs"><a href="https://sellf.app" target="_blank" rel="noopener" className="underline underline-offset-2">{footer.runsOn}</a></p>}
    </footer>
  </div>;
}
