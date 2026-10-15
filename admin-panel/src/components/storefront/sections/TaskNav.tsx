'use client';

/** Category finder; batched public props only. @see spec/contracts/section-contract.md */
import { useId, useState } from 'react';
import { TASK_NAV_FILTER_EVENT, TASK_NAV_LABELS, taskNavHref } from '@/lib/storefront-templates/task-nav-public';
import type { TaskNavFilter, TaskNavProps } from '@/lib/storefront-templates/task-nav-public';
import styles from './TaskNav.module.css';

export default function TaskNav({ categories, content, target, locale }: TaskNavProps) {
  const headingId = useId();
  const [active, setActive] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const labels = TASK_NAV_LABELS[locale];
  const links = categories.slice(0, 12).filter(category => category.label.trim() && category.filterTarget === target);
  if (!links.length) return null;

  function handoff(detail: TaskNavFilter): boolean {
    const catalogue = document.getElementById(target);
    return catalogue ? !catalogue.dispatchEvent(new CustomEvent<TaskNavFilter>(TASK_NAV_FILTER_EVENT, { detail, bubbles: true, cancelable: true })) : false;
  }

  return <section className={styles.finder} aria-labelledby={content?.heading ? headingId : undefined} aria-label={content?.heading ? undefined : labels.choose}>
    <div className={styles.wrap}>
      {content && <div className={styles.heading}>
        {content.body && <p>{content.body}</p>}
        {content.heading && <h2 id={headingId}>{content.heading}</h2>}
      </div>}
      <form role="search" aria-label={labels.search} action={`#${target}`} method="get" className={styles.search} onSubmit={event => {
        const search = String(new FormData(event.currentTarget).get('search') ?? '').trim().normalize('NFC');
        if (Array.from(search).length > 100) {
          event.preventDefault();
          const input = event.currentTarget.elements.namedItem('search') as HTMLInputElement;
          input.setCustomValidity(labels.tooLong);
          input.reportValidity();
          return;
        }
        if (handoff({ target, search })) {
          event.preventDefault();
          setAnnouncement(`${labels.filtering}${search || labels.search}`);
        }
      }}>
        <label className={styles.srOnly} htmlFor={`${headingId}-search`}>{labels.search}</label>
        <input id={`${headingId}-search`} name="search" type="search" placeholder={labels.search} onInput={event => event.currentTarget.setCustomValidity('')} />
        <button type="submit">{labels.submit}<span aria-hidden="true"> ↗</span></button>
      </form>
      <nav aria-label={labels.choose} className={styles.tasks}>
        {links.map((category, index) => <a key={category.id} href={taskNavHref(target, category.id)}
          className={styles.task} aria-current={active === category.id ? 'true' : undefined}
          onClick={event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            if (handoff({ target, categoryIds: [category.id] })) {
              event.preventDefault();
              setActive(category.id);
              setAnnouncement(`${labels.filtering}${category.label}`);
            }
          }}>
          <span className={styles.number}>{String(index + 1).padStart(2, '0')} / {labels.choose}</span>
          <span className={styles.label}>{category.label}<span aria-hidden="true"> ↗</span></span>
        </a>)}
      </nav>
      <p className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
    </div>
  </section>;
}
