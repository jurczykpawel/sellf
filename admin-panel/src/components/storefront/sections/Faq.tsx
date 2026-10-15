/** Native FAQ disclosures; public copy is resolved before rendering. @see faq-closing.ts */
import { useId } from 'react';
import type { FaqProps } from '@/lib/storefront-templates/faq-closing';
import styles from './FaqClosing.module.css';

export default function Faq({ content, locale }: FaqProps) {
  const headingId = useId();
  const items = content?.items.filter(item => item.question.trim() && item.answer.trim()).slice(0, 20) ?? [];
  if (!items.length) return null;
  return <section className={styles.faq} aria-labelledby={headingId}>
    <div className={`${styles.wrap} ${styles.faqGrid}`}>
      <h2 id={headingId}>{locale === 'pl' ? 'Pytania i odpowiedzi' : 'Frequently asked questions'}</h2>
      <div className={styles.answers}>{items.map(item => <details key={item.id}>
        <summary>{item.question}<span className={styles.indicator} aria-hidden="true" /></summary>
        <p>{item.answer}</p>
      </details>)}</div>
    </div>
  </section>;
}
