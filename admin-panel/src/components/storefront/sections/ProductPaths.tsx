/** Situation-to-product cards using core public prices and details actions.
 * @see lib/storefront-templates/product-paths.ts
 */
import Image from 'next/image';
import { PublicProductFacts, PublicProductPrice } from '@/components/storefront/PublicProductFacts';
import { productListLabels } from '@/lib/storefront-templates/sections/product-list';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import type { ReactElement } from 'react';
import type { ProductPathsProps } from '@/lib/storefront-templates/phase2-contracts';
import styles from './ProductPaths.module.css';

export default function ProductPaths({ heading, body, eyebrow, actionLabel, items, locale }: ProductPathsProps): ReactElement | null {
  if (!items.length) return null;
  const messages = locale === 'pl' ? pl : en;
  return <section className={styles.paths} lang={locale} data-section="product-paths/1">
    {(eyebrow || heading || body) && <div className={styles.heading}><div>{eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}{heading && <h2>{heading}</h2>}</div>{body && <p>{body}</p>}</div>}
    {items.map(({ id, situation, body, label, product }, index) => <article className={styles.path} key={id}>
      <span className={styles.number} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <div className={styles.situation}><h3>{situation}</h3>{body && <p>{body}</p>}</div>
      <div className={styles.product}>
        {product.image && <Image unoptimized src={product.image.src} alt={product.image.alt} width={product.image.width} height={product.image.height} loading="lazy" />}
        <div className={styles.productBody}>
          {(label || product.marketing.format) && <span className={styles.tag}>{label || (product.marketing.format && messages.admin.products.form.marketing.formats[product.marketing.format])}</span>}
          <h4>{product.title}</h4>
          <div className={styles.buyrow}><div className={styles.price} data-price-kind={product.price.kind}>
            <PublicProductPrice price={product.price} locale={locale} />
            {product.price.taxNote && <small>{product.price.taxNote}</small>}{product.price.omnibus && <small>{product.price.omnibus}</small>}
          </div><a href={product.actions.details}>{actionLabel || productListLabels[locale].details}<span className={styles.srOnly}>: {product.title}</span></a></div>
          <PublicProductFacts product={product} locale={locale} />
        </div>
      </div>
    </article>)}
  </section>;
}
