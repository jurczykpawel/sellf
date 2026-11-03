'use client';

/** Marks a screen as carrying a tutorial: offers it in the help menu and, unless `auto` is false, starts it on the user's first visit. */
import { useEffect } from 'react';
import { useTutorials } from '@/components/tutorials/TutorialProvider';
import type { TutorialId } from '@/lib/tutorials/registry';

export default function TutorialTrigger({ id, auto = true }: { id: TutorialId; auto?: boolean }) {
  const tutorials = useTutorials();
  const register = tutorials?.register;
  const autoStart = tutorials?.autoStart;
  useEffect(() => register?.(id), [register, id]);
  useEffect(() => (auto ? autoStart?.(id) : undefined), [autoStart, id, auto]);
  return null;
}
