/** Server-rendered seller projects; samples remain static images.
 * @see lib/storefront-templates/project-showcase.ts
 */
import Image from 'next/image';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import type { ReactElement } from 'react';
import type { ProjectShowcaseProps } from '@/lib/storefront-templates/phase2-contracts';
import styles from './ProjectShowcase.module.css';

export default function ProjectShowcase({ heading, items, locale }: ProjectShowcaseProps): ReactElement | null {
  if (!items.length) return null;
  const labels = (locale === 'pl' ? pl : en).storefrontProjects;
  return <section className={styles.showcase} lang={locale} data-section="project-showcase/1">
    <div className={styles.wrap}>
      {heading.trim() && <h2>{heading}</h2>}
      <div className={styles.grid}>{items.map(({ id, name, body, url, media }) => <article key={id}>
        <h3>{name}</h3>
        {body.trim() && <p>{body}</p>}
        <a href={url} rel="noreferrer">{labels.viewProject}<span className={styles.srOnly}>: {name}</span><span aria-hidden="true"> ↗</span></a>
        {media && <Image unoptimized src={media.src} alt={media.alt} width={media.width} height={media.height}
          loading="lazy" sizes="(max-width: 600px) calc(100vw - 36px), (max-width: 900px) 30vw, 400px" />}
      </article>)}</div>
    </div>
  </section>;
}
