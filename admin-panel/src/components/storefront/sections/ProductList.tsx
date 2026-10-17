/** Public, server-rendered starter cards. @see lib/storefront-templates/sections/product-list.ts */
import Image from 'next/image';
import { availableStarters, productListLabels, productListSectionSchema, resolveProductList } from '@/lib/storefront-templates/sections/product-list';
import { resolveMarketingCopy } from '@/lib/validations/product-marketing';
import { PublicProductFacts, PublicProductPrice } from '@/components/storefront/PublicProductFacts';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import type { PublicProductInfo } from '@/lib/storefront-templates/catalogue';
import type { ExtendedProductListProps, ProductListProps } from '@/lib/storefront-templates/sections/product-list';
import styles from './ProductList.module.css';

function ProductMetadata({ product, locale, detail = false }: { product: PublicProductInfo; locale: ProductListProps['locale']; detail?: boolean }) {
  const labels = productListLabels[locale];
  const editorial = resolveMarketingCopy(product.marketing, locale);
  const { result, tools, requirements } = editorial.copy;
  const format = product.marketing.format ? (locale === 'pl' ? pl : en).admin.products.form.marketing.formats[product.marketing.format] : null;
  if (detail) return <>
    {result && <p className={styles.outcome} lang={editorial.locale}>{result}</p>}
    <div className={styles.metadata}>
      {(format || tools.length > 0) && <p>{format}{format && tools.length > 0 && ' · '}<span lang={editorial.locale}>{tools.join(' · ')}</span></p>}
      {requirements.length > 0 && <p>{labels.requirements}: <span lang={editorial.locale}>{requirements.join(' · ')}</span></p>}
    </div>
  </>;
  return <dl className={styles.metadata}>
    {product.marketing.format && <><dt>{labels.format}</dt><dd>{(locale === 'pl' ? pl : en).admin.products.form.marketing.formats[product.marketing.format]}</dd></>}
    {result && <><dt>{labels.result}</dt><dd lang={editorial.locale}>{result}</dd></>}
    {tools.length > 0 && <><dt>{labels.tools}</dt><dd lang={editorial.locale}>{tools.join(' · ')}</dd></>}
    {requirements.length > 0 && <><dt>{labels.requirements}</dt><dd lang={editorial.locale}>{requirements.join(' · ')}</dd></>}
  </dl>;
}

export default function ProductList(props: ExtendedProductListProps) {
  const { variant, products, content, locale } = props;
  if (props.variant === 'featured-grid') return <Featured {...props} />;
  if (props.variant === 'comparison') return <Comparison {...props} />;
  const starters = availableStarters(products);
  if (!starters.length) return null;
  const labels = productListLabels[locale];
  const ProductHeading = content?.heading ? 'h3' : 'h2';
  return <section className={styles.section} data-section="product-list/1" data-variant={variant}>
    {content && (content.heading || content.body) && <header className={styles.heading}>
      {content.heading && <h2>{content.heading}</h2>}
      {content.body && <p>{content.body}</p>}
    </header>}
    <div className={variant === 'compact' ? styles.compact : styles.grid}>
      {starters.map(product => {
        const hasMetadata = product.marketing.format || Object.values(resolveMarketingCopy(product.marketing, locale).copy).some(value => Array.isArray(value) ? value.length : value);
        return <article className={styles.card} key={product.id}>
          {product.image && <div className={styles.cover}><Image unoptimized src={product.image.src} alt={product.image.alt} width={product.image.width} height={product.image.height} loading="lazy" /></div>}
          <div className={styles.body}>
            <ProductHeading>{product.title}</ProductHeading>
            {product.description && (variant === 'compact' || product.description !== resolveMarketingCopy(product.marketing, locale).copy.result) && <p className={styles.outcome}>{product.description}</p>}
            {variant === 'detail-cards' && hasMetadata && <ProductMetadata product={product} locale={locale} detail />}
            <div className={styles.buyrow}>
              <div className={styles.price} data-price-kind={product.price.kind}><PublicProductPrice price={product.price} locale={locale} />
                {product.price.taxNote && <small>{product.price.taxNote}</small>}
                {product.price.omnibus && <small>{product.price.omnibus}</small>}
              </div>
              <a href={product.actions.details}>{labels.details}<span className={styles.srOnly}>: {product.title}</span></a>
            </div>
            <PublicProductFacts product={product} locale={locale} />
            {variant === 'compact' && hasMetadata && <details className={styles.disclosure}>
              <summary>{labels.more}<span className={styles.srOnly}>: {product.title}</span></summary>
              <ProductMetadata product={product} locale={locale} />
            </details>}
          </div>
        </article>;
      })}
    </div>
  </section>;
}

function Featured({ products, content, locale }: Extract<ExtendedProductListProps, { variant: 'featured-grid' }>) {
  const available = availableStarters(products, 6);
  if (!available.length) return null;
  const labels = productListLabels[locale];
  const Heading = content?.heading ? 'h3' : 'h2';
  return <section className={`${styles.section} ${styles.featured}`} data-section="product-list/1" data-variant="featured-grid">
    {content && <header className={styles.heading}><div>{content.eyebrow && <p className={styles.eyebrow}>{content.eyebrow}</p>}<h2>{content.heading}</h2></div><p>{content.body}</p></header>}
    <div className={styles.grid}>{available.map(product => {
      const copy = content?.items?.find(item => item.productId === product.id);
      const editorial = resolveMarketingCopy(product.marketing, locale);
      const format = product.marketing.format ? (locale === 'pl' ? pl : en).admin.products.form.marketing.formats[product.marketing.format] : null;
      return <article className={styles.card} key={product.id}>
        {product.image && <div className={styles.cover}><Image unoptimized src={product.image.src} alt={product.image.alt} width={product.image.width} height={product.image.height} loading="lazy" />{format && <span className={styles.tag}>{copy?.descriptor || format}</span>}</div>}
        <div className={styles.body}>
          {copy?.eyebrow && <p className={styles.cardEyebrow}>{copy.eyebrow}</p>}
          <Heading>{product.title}</Heading>
          {product.description && product.description !== editorial.copy.result && <p className={styles.outcome}>{product.description}</p>}
          {editorial.copy.result && <p className={styles.outcome} lang={editorial.locale}>{editorial.copy.result}</p>}
          <p className={styles.metadata}>{copy?.descriptor || format}{editorial.copy.tools.length > 0 && <span lang={editorial.locale}> · {editorial.copy.tools.join(" · ")}</span>}<br />{copy?.requirementsLabel || (editorial.copy.requirements.length ? `${labels.requirements}: ${editorial.copy.requirements.join(' · ')}` : '')}</p>
          <div className={styles.buyrow}><div className={styles.price} data-price-kind={product.price.kind}><PublicProductPrice price={product.price} locale={locale} />
            {product.price.taxNote && <small>{product.price.taxNote}</small>}{product.price.omnibus && <small>{product.price.omnibus}</small>}
          </div><a href={product.actions.details}>{content?.actionLabel || labels.details}<span className={styles.srOnly}>: {product.title}</span></a></div>
          <PublicProductFacts product={product} locale={locale} />
          <details className={styles.disclosure}><summary>{content?.detailsLabel || labels.more}</summary><div className={styles.detailBody}>
            <strong>{copy?.detailHeading || product.title}</strong>{copy?.detailBody && <p>{copy.detailBody}</p>}
            <strong>{copy?.requirementsLabel || labels.requirements}</strong><p lang={editorial.locale}>{editorial.copy.requirements.join(" · ")}</p>
            <a href={product.actions.details}>{content?.detailActionLabel || labels.details} · {product.price.display}</a>
          </div></details>
        </div>
      </article>;
    })}</div>
  </section>;
}

function Comparison({ products, content, locale }: Extract<ExtendedProductListProps, { variant: 'comparison' }>) {
  const available = availableStarters(products, 2);
  if (!available.length) return null;
  const Heading = content?.heading ? 'h3' : 'h2';
  return <section className={`${styles.section} ${styles.comparison}`} data-section="product-list/1" data-variant="comparison">
    <div className={styles.wrap}>
      {content && <header>{content.eyebrow && <p className={styles.eyebrow}>{content.eyebrow}</p>}<h2>{content.heading}</h2><p className={styles.lead}>{content.body}</p></header>}
      <div className={styles.compareGrid}>{available.map(product => {
        const copy = content?.items.find(item => item.productId === product.id);
        return <article className={styles.panel} key={product.id}>
          {copy?.eyebrow && <span className={styles.tag}>{copy.eyebrow}</span>}
          <Heading>{copy?.heading || product.title}</Heading>
          {product.description && product.description !== copy?.body && <p className={styles.outcome}>{product.description}</p>}
          {copy?.body && <p className={styles.lead}>{copy.body}</p>}
          {copy?.bullets.length ? <ul>{copy.bullets.map((bullet, index) => <li key={index}>{bullet}</li>)}</ul> : null}
          <div className={styles.buyrow}><div className={styles.price} data-price-kind={product.price.kind}><PublicProductPrice price={product.price} locale={locale} />
            {product.price.taxNote && <small>{product.price.taxNote}</small>}{product.price.omnibus && <small>{product.price.omnibus}</small>}
          </div><a href={product.actions.details}>{content?.actionLabel || productListLabels[locale].details}<span className={styles.srOnly}>: {product.title}</span></a></div>
          <PublicProductFacts product={product} locale={locale} />
        </article>;
      })}</div>
    </div>
  </section>;
}

export const PRODUCT_LIST_SECTION = {
  type: 'product-list/1', schema: productListSectionSchema, resolve: resolveProductList, Component: ProductList,
  fixtureIds: ['comparison', 'featured-grid', 'detail-cards', 'compact', 'empty', 'missing', 'long', 'unavailable', 'pwyw'],
} as const;
