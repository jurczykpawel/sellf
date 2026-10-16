'use client';

/** Category finder; batched public props only. @see spec/contracts/section-contract.md */
import { useEffect, useId, useState } from 'react';
import { TASK_NAV_FILTER_EVENT, TASK_NAV_STATE_EVENT, TASK_NAV_LABELS, taskNavHref } from '@/lib/storefront-templates/task-nav-public';
import type { SearchHeroProps } from '@/lib/storefront-templates/phase2-contracts';
import type { TaskNavFilter, TaskNavProps } from '@/lib/storefront-templates/task-nav-public';
import styles from './TaskNav.module.css';

export default function TaskNav(props: TaskNavProps | SearchHeroProps) {
  const { categories, content, target, locale } = props;
  const hero = 'variant' in props && props.variant === 'search-hero';
  const searchContent = hero ? props.content : null;
  const headingId = useId();
  const [active, setActive] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const labels = TASK_NAV_LABELS[locale];
  const links = categories.slice(0, 12).filter(category => category.label.trim() && category.filterTarget === target);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<TaskNavFilter>).detail;
      if (detail?.target === target) setActive(detail.categoryIds?.length === 1 ? detail.categoryIds[0] : null);
    };
    document.addEventListener(TASK_NAV_STATE_EVENT, receive);
    return () => document.removeEventListener(TASK_NAV_STATE_EVENT, receive);
  }, [target]);
  if (!links.length && !hero) return null;

  function handoff(detail: TaskNavFilter): boolean {
    const catalogue = document.getElementById(target);
    return catalogue ? !catalogue.dispatchEvent(new CustomEvent<TaskNavFilter>(TASK_NAV_FILTER_EVENT, { detail, bubbles: true, cancelable: true })) : false;
  }

  return <section className={styles.finder} data-variant={hero ? 'search-hero' : undefined} aria-labelledby={content?.heading ? headingId : undefined} aria-label={content?.heading ? undefined : labels.choose}>
    <div className={styles.wrap}>
      {(content || hero) && <div className={styles.heading}>
        {hero ? <><div>{searchContent?.eyebrow && <p className={styles.eyebrow}>{searchContent.eyebrow}</p>}<h1 id={headingId}>{content?.heading || labels.search}</h1></div>{content?.body && <p>{content.body}</p>}</> : <>{content?.body && <p>{content.body}</p>}{content?.heading && <h2 id={headingId}>{content.heading}</h2>}</>}
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
        <>{hero && <button type="submit" aria-label={labels.submit}><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10" cy="10" r="6.5" /><path d="m15 15 6 6" /></svg></button>}<input id={`${headingId}-search`} name="search" type="search" placeholder={labels.search} onInput={event => event.currentTarget.setCustomValidity('')} /></>
        {!hero && <button type="submit">{labels.submit}<span aria-hidden="true"> ↗</span></button>}
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
          <span className={styles.number}>{hero ? String(index + 1).padStart(2, '0') : <>{String(index + 1).padStart(2, '0')} / {labels.choose}</>}</span>
          <span className={styles.label}>{category.label}<span aria-hidden="true"> ↗</span></span>
          {searchContent?.items.find(item => item.categoryId === category.id)?.description && <p className={styles.description}>{searchContent.items.find(item => item.categoryId === category.id)!.description}</p>}
        </a>)}
      </nav>
      <p className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
    </div>
  </section>;
}
