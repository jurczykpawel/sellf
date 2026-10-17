/** Closing offer using core product prices and destinations. @see faq-closing.ts */
import { useId } from 'react';
import { hasCoreProductActions } from '@/lib/storefront-templates/faq-closing';
import { PublicProductPrice } from '@/components/storefront/PublicProductFacts';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import type { CatalogueLinkProps } from '@/lib/storefront-templates/phase2-contracts';
import type { ProductCtaProps } from '@/lib/storefront-templates/faq-closing';
import styles from './FaqClosing.module.css';

export default function ProductCta(props: ProductCtaProps | CatalogueLinkProps) {
  const headingId = useId();
  const messages = props.locale === 'pl' ? pl : en;
  if ('target' in props) return <section className={`${styles.closing} ${styles.catalogueLink}`} aria-labelledby={headingId}>
    <div className={styles.wrap}><h2 id={headingId}>{props.content?.heading.trim() || messages.storefrontClosing.catalogue}</h2>
      {props.content?.body.trim() && <p className={styles.body}>{props.content.body}</p>}
      <a className={styles.action} href={`#${props.target}`}>{messages.storefrontClosing.browseCatalogue}<span aria-hidden="true"> →</span></a>
    </div>
  </section>;
  const { product, content, action, locale } = props;
  if (!product) return null;
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
