/** Public, server-rendered starter cards. @see lib/storefront-templates/sections/product-list.ts */
import Image from 'next/image';
import { availableStarters, productListLabels, productListSectionSchema, resolveProductList } from '@/lib/storefront-templates/sections/product-list';
import { resolveMarketingCopy } from '@/lib/validations/product-marketing';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import type { PublicProductInfo } from '@/lib/storefront-templates/catalogue';
import type { ProductListProps } from '@/lib/storefront-templates/sections/product-list';
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

export default function ProductList({ variant, products, content, locale }: ProductListProps) {
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
            {variant === 'detail-cards' && hasMetadata && <ProductMetadata product={product} locale={locale} detail />}
            <div className={styles.buyrow}>
              <div className={styles.price} data-price-kind={product.price.kind}>{product.price.display}
                {product.price.taxNote && <small>{product.price.taxNote}</small>}
                {product.price.omnibus && <small>{product.price.omnibus}</small>}
              </div>
              <a href={product.actions.details}>{labels.details}<span className={styles.srOnly}>: {product.title}</span></a>
            </div>
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

export const PRODUCT_LIST_SECTION = {
  type: 'product-list/1', schema: productListSectionSchema, resolve: resolveProductList, Component: ProductList,
  fixtureIds: ['detail-cards', 'compact', 'empty', 'missing', 'long', 'unavailable', 'pwyw'],
} as const;
