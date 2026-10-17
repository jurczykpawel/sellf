/** Optional server-rendered biography, using only seller-supplied plain prose.
 * @see docs/templates/phase2-contracts.md
 */
import type { ReactElement } from 'react';
import type { AuthorStoryProps } from '@/lib/storefront-templates/phase2-contracts';
import styles from './AuthorStory.module.css';

export default function AuthorStory({ content, locale }: AuthorStoryProps): ReactElement | null {
  const paragraphs = content?.paragraphs.filter(paragraph => paragraph.trim()) ?? [];
  if (!content || (!content.heading.trim() && paragraphs.length === 0)) return null;
  return <section className={styles.story} lang={locale} data-section="author-story/1">
    {content.heading.trim() && <h2>{content.heading}</h2>}
    {paragraphs.length > 0 && <div className={styles.prose}>
      <blockquote>{paragraphs[0]}</blockquote>
      {paragraphs.slice(1).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
    </div>}
  </section>;
}
