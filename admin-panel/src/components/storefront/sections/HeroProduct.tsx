/** Server-rendered product hero. @see spec/contracts/section-contract.md */
import Image from 'next/image';
import OfferFocus from '@/components/storefront/sections/OfferFocus';
import { PublicProductPrice } from '@/components/storefront/PublicProductFacts';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import type { OfferFocusProps } from '@/lib/storefront-templates/phase2-contracts';
import type { ReactElement } from 'react';
import type { HeroProductProps } from '@/lib/storefront-templates/hero-product';
import styles from './HeroProduct.module.css';

export default function HeroProduct(props: HeroProductProps | OfferFocusProps): ReactElement {
  if (props.variant === 'offer-focus') return <OfferFocus {...props} />;
  const { variant, product, content, locale } = props;
  const messages = locale === 'pl' ? pl : en;
  const available = product?.availability === 'available';
  const steps = content?.steps.filter(step => step.trim()) ?? [];
  return <section className={styles.hero} lang={locale} data-variant={variant}>
    <div className={styles.layout}>
      <div className={styles.copy}>
        {content?.eyebrow.trim() && <p className={styles.eyebrow}>{content.eyebrow}</p>}
        <h1>{content?.heading.trim() || product?.title || messages.availabilityBanner.productUnavailable}</h1>
        {available ? <>
          {content?.body.trim() && <p className={styles.lead}>{content.body}</p>}
          <div className={styles.offer}>
            <div className={styles.price}>
              <p><PublicProductPrice price={product.price} locale={locale} /></p>
              {product.price.taxNote && <p className={styles.note}>{product.price.taxNote}</p>}
              {product.price.omnibus && <p className={styles.note}>{product.price.omnibus}</p>}
            </div>
            <a className={styles.action} href={product.actions.details}>{messages.myProducts.viewDetails}<span aria-hidden="true">↗</span></a>
          </div>
        </> : <p className={styles.lead}>{messages.availabilityBanner.productUnavailableMessage}</p>}
      </div>
      {available && product.image && <figure className={styles.media}>
        <Image src={product.image.src} alt={product.image.alt} width={product.image.width} height={product.image.height}
          unoptimized loading="eager" fetchPriority="high" sizes={variant === 'simple'
            ? '(max-width: 600px) calc(100vw - 66px), (max-width: 1328px) calc(100vw - 126px), 1202px'
            : '(max-width: 600px) calc(100vw - 66px), (max-width: 1328px) calc((100vw - 142px) / 2 - 46px), 547px'} />
      </figure>}
    </div>
    {available && steps.length > 0 && <ol className={styles.steps}>
      {steps.map((step, index) => <li key={index}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><p>{step}</p></li>)}
    </ol>}
  </section>;
}
