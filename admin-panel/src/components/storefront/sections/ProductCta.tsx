/** Closing offer using core product prices and destinations. @see faq-closing.ts */
import { useId } from 'react';
import { hasCoreProductActions } from '@/lib/storefront-templates/faq-closing';
import { PublicProductPrice } from '@/components/storefront/PublicProductFacts';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import type { ProductCtaProps } from '@/lib/storefront-templates/faq-closing';
import styles from './FaqClosing.module.css';

export default function ProductCta({ product, content, action, locale }: ProductCtaProps) {
  const headingId = useId();
  if (!product) return null;
  const messages = locale === 'pl' ? pl : en;
  const available = product.availability === 'available';
  const heading = content?.heading.trim() ? content.heading : product.title;
  const label = action === 'details' ? messages.myProducts.viewDetails : product.price.kind === 'free' ? messages.productView.getFreeAccess : messages.productView.purchase;
  return <section className={styles.closing} aria-labelledby={headingId}>
    <div className={`${styles.wrap} ${styles.closingGrid}`}>
      <div><h2 id={headingId}>{heading}</h2>
        {content?.body.trim() && <p className={styles.body}>{content.body}</p>}
        {available && hasCoreProductActions(product, locale) && <a className={styles.action} href={product.actions[action]}>{label}<span aria-hidden="true"> ↗</span></a>}
      </div>
      <div className={styles.product}>
        {heading !== product.title && <h3>{product.title}</h3>}
        {available ? <><div className={styles.price}><PublicProductPrice price={product.price} locale={locale} /></div>
          {product.price.taxNote && <small>{product.price.taxNote}</small>}
          {product.price.omnibus && <small>{product.price.omnibus}</small>}</>
          : <div>{messages.availabilityBanner.productUnavailable}</div>}
      </div>
    </div>
  </section>;
}
