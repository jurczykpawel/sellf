'use client';

/** Help button in the dashboard header: "Show how this works" for the open screen plus the other tutorials. */
import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { CircleHelp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTutorials } from '@/components/tutorials/TutorialProvider';
import { TUTORIAL_IDS, TUTORIALS } from '@/lib/tutorials/registry';
import type { TutorialId } from '@/lib/tutorials/registry';

const itemClass = 'block w-full min-h-11 px-3 py-2 text-left text-sm text-sf-heading hover:bg-sf-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sf-accent';

export default function TutorialMenu() {
  const tutorials = useTutorials();
  const t = useTranslations('tutorials');
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return;
        setOpen(false);
        button.current?.focus();
      } else if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  if (!tutorials) return null;
  const onScreen = TUTORIAL_IDS.filter(id => tutorials.available.includes(id));
  const elsewhere = TUTORIAL_IDS.filter(id => !onScreen.includes(id));
  const link = (id: TutorialId) => {
    const { href } = TUTORIALS[id];
    return 'needsOpenForm' in TUTORIALS[id] ? href : `${href}${href.includes('?') ? '&' : '?'}tutorial=${id}`;
  };

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        data-testid="tutorial-menu-button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t('menu.open')}
        title={t('menu.open')}
        onClick={() => setOpen(value => !value)}
        className="flex h-11 w-11 items-center justify-center rounded text-sf-sidebar-text hover:bg-sf-hover hover:text-sf-accent focus-visible:outline-2 focus-visible:outline-sf-accent"
      >
        <CircleHelp className="h-5 w-5" aria-hidden="true" />
      </button>
      {open && (
        <div id={panelId} role="group" aria-label={t('menu.title')} className="absolute right-0 top-full z-50 mt-2 max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-sf-border bg-sf-raised py-2 shadow-lg">
          <h2 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-sf-muted">{t('menu.title')}</h2>
          {onScreen.length > 0 && (
            <ul>
              {onScreen.map(id => (
                <li key={id}>
                  <button type="button" className={itemClass} data-testid={`tutorial-start-${id}`} onClick={() => { setOpen(false); tutorials.start(id); }}>{t(`${id}.name`)}</button>
                </li>
              ))}
            </ul>
          )}
          {elsewhere.length > 0 && (
            <>
              <h3 className="px-3 pb-1 pt-3 text-xs font-medium text-sf-muted">{t(onScreen.length ? 'menu.elsewhere' : 'menu.all')}</h3>
              <ul>
                {elsewhere.map(id => (
                  <li key={id}>
                    <Link href={link(id)} className={itemClass} data-testid={`tutorial-link-${id}`} onClick={() => setOpen(false)}>
                      {t(`${id}.name`)}
                      {'needsOpenForm' in TUTORIALS[id] && <span className="mt-0.5 block text-xs text-sf-muted">{t(`${id}.where`)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
