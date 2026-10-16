/** Dominant offer with static, seller-authored sample copy. @see D-055 */
import Image from 'next/image';
import { resolveMarketingCopy } from '@/lib/validations/product-marketing';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import type { OfferFocusProps } from '@/lib/storefront-templates/phase2-contracts';
import styles from './HeroProduct.module.css';

export default function OfferFocus({ product, content, locale }: OfferFocusProps) {
  const messages = locale === 'pl' ? pl : en;
  const available = product?.availability === 'available';
  const editorial = product ? resolveMarketingCopy(product.marketing, locale) : null;
  const lines = (content?.heading.trim() || product?.title || messages.availabilityBanner.productUnavailable).split('\n');
  return <section className={styles.focusHero} data-variant="offer-focus">
    <div className={styles.focusLayout}>
      <div className={styles.focusCopy}>
        {content?.eyebrow.trim() && <p className={styles.focusEyebrow}>{content.eyebrow}</p>}
        <h1>{lines.map((line, index) => <span key={index} className={lines.length > 1 && index === lines.length - 1 ? styles.focusAccent : undefined}>{line}{index < lines.length - 1 && <br />}</span>)}</h1>
        <p className={styles.focusLead}>{available ? content?.body : messages.availabilityBanner.productUnavailableMessage}</p>
        {available && <>
          <div className={styles.focusOffer}>
            <div className={styles.focusPrice}>{product.price.display}
              {product.marketing.format && <small>{messages.admin.products.form.marketing.formats[product.marketing.format]}</small>}
              {product.price.taxNote && <small>{product.price.taxNote}</small>}
              {product.price.omnibus && <small>{product.price.omnibus}</small>}
            </div>
            <a className={styles.focusAction} href={product.actions.details}>{messages.myProducts.viewDetails}<span aria-hidden="true">↗</span></a>
          </div>
          {!!editorial?.copy.requirements.length && <p className={styles.focusNote} lang={editorial.locale}>{editorial.copy.requirements.join(' · ')}</p>}
        </>}
      </div>
      {available && (product.image || content?.staticDemo) && <div className={styles.focusVisual}>
        {product.image && <figure className={styles.focusCover}>
          <Image src={product.image.src} alt={product.image.alt} width={product.image.width} height={product.image.height} unoptimized loading="eager" fetchPriority="high" sizes="(max-width: 600px) calc(100vw - 67px), (max-width: 900px) 45vw, 537px" />
          <figcaption><span>{product.image.alt}</span>{content?.mediaCaption && <span>{content.mediaCaption}</span>}</figcaption>
        </figure>}
        {content?.staticDemo && <div className={styles.focusSample}><strong>{content.staticDemo.title}</strong>{content.staticDemo.body}</div>}
      </div>}
    </div>
    {available && !!content?.steps.length && <ol className={styles.focusSteps}>{content.steps.map((step, index) => <li key={index}>
      <strong><span aria-hidden="true">{String(index + 1).padStart(2, '0')} / </span>{step}</strong>
      {content.stepDetails?.[index] && <p>{content.stepDetails[index]}</p>}
    </li>)}</ol>}
  </section>;
}
