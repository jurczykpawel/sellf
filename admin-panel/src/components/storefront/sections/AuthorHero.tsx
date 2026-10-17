/** Server-rendered author introduction. @see docs/templates/phase2-contracts.md */
import Image from 'next/image';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import type { ReactElement } from 'react';
import type { AuthorHeroProps } from '@/lib/storefront-templates/phase2-contracts';
import styles from './AuthorHero.module.css';

export default function AuthorHero({ content, portrait, pathsTarget, catalogueTarget, locale }: AuthorHeroProps): ReactElement {
  const messages = locale === 'pl' ? pl : en;
  const [first, ...rest] = (content?.heading.trim() || content?.name.trim() || messages.storefrontClosing.catalogue).split('\n');
  return <section className={styles.hero} lang={locale} data-section="author-hero/1">
    <div className={`${styles.layout} ${portrait ? '' : styles.withoutPortrait}`}>
      <div className={styles.copy}>
        {content?.eyebrow.trim() && <p className={styles.eyebrow}>{content.eyebrow}</p>}
        <h1>{first}{rest.length > 0 && <><br /><em>{rest.join('\n')}</em></>}</h1>
        {content?.intro.trim() && <p className={styles.intro}>{content.intro}</p>}
        <div className={styles.actions}>
          <a className={styles.primary} href={`#${pathsTarget}`}>{messages.storefrontAuthor.choosePath}<span aria-hidden="true">→</span></a>
          <a className={styles.secondary} href={`#${catalogueTarget}`}>{messages.storefrontClosing.catalogue}</a>
        </div>
      </div>
      {portrait && <figure className={styles.portrait}>
        <Image src={portrait.src} alt={portrait.alt} width={portrait.width} height={portrait.height}
          unoptimized loading="eager" fetchPriority="high" sizes="(max-width: 600px) 62px, (max-width: 1000px) 40vw, 392px" />
        {content?.name.trim() && <figcaption>{content.name}</figcaption>}
      </figure>}
    </div>
  </section>;
}
