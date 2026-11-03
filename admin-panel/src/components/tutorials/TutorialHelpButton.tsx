'use client';

/** Replays a tutorial from inside a form or dialog that covers the header help menu. */
import { CircleHelp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTutorials } from '@/components/tutorials/TutorialProvider';
import type { TutorialId } from '@/lib/tutorials/registry';

export default function TutorialHelpButton({ id }: { id: TutorialId }) {
  const tutorials = useTutorials();
  const t = useTranslations('tutorials.menu');
  if (!tutorials) return null;
  return (
    <button
      type="button"
      data-testid={`tutorial-help-${id}`}
      onClick={() => tutorials.start(id)}
      className="inline-flex min-h-11 items-center gap-1.5 rounded px-2 text-sm font-normal text-sf-accent hover:underline focus-visible:outline-2 focus-visible:outline-sf-accent"
    >
      <CircleHelp className="h-4 w-4" aria-hidden="true" />
      {t('title')}
    </button>
  );
}
