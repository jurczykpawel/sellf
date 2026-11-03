'use client';

/** Runs guided tutorials with driver.js; first-visit tutorials start once per user. @see lib/tutorials/registry.ts */
import 'driver.js/dist/driver.css';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { Driver } from 'driver.js';
import { markTutorialSeen } from '@/lib/actions/tutorial-progress';
import { buildTourSteps, tourSelector } from '@/lib/tutorials/driver-steps';
import { TUTORIALS } from '@/lib/tutorials/registry';
import type { TutorialId } from '@/lib/tutorials/registry';

const AUTO_START_DELAY_MS = 600;
/** A click that reveals the next element re-renders after the click handler returns. */
const REVEAL_GRACE_MS = 600;

function requestedTutorial(): string | null {
  return new URLSearchParams(window.location.search).get('tutorial');
}

function appears(target: string, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const selector = tourSelector(target);
    if (document.querySelector(selector)) { resolve(true); return; }
    const finish = (found: boolean) => { observer.disconnect(); clearTimeout(timer); resolve(found); };
    const observer = new MutationObserver(() => { if (document.querySelector(selector)) finish(true); });
    const timer = setTimeout(() => finish(false), timeoutMs);
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

interface TutorialContextValue {
  /** Tutorials whose screen is currently open. */
  available: readonly TutorialId[];
  /** Lists the tutorial as available while its screen is open; `?tutorial=<id>` starts it on request. */
  register(id: TutorialId): () => void;
  /** Starts the tutorial on its own once the user has not seen it yet. */
  autoStart(id: TutorialId): () => void;
  start(id: TutorialId): void;
}

const TutorialContext = createContext<TutorialContextValue | null>(null);

export function useTutorials(): TutorialContextValue | null {
  return useContext(TutorialContext);
}

interface TutorialProviderProps { initialSeen: readonly TutorialId[]; autoStart: boolean; children: ReactNode }

export default function TutorialProvider({ initialSeen, autoStart, children }: TutorialProviderProps) {
  const t = useTranslations('tutorials');
  const [available, setAvailable] = useState<TutorialId[]>([]);
  const seen = useRef(new Set<TutorialId>(initialSeen));
  const active = useRef<{ id: TutorialId; destroy(): void } | null>(null);
  const translate = useRef(t);
  translate.current = t;

  const run = useCallback(async (id: TutorialId, remember: boolean) => {
    if (active.current) return;
    active.current = { id, destroy() {} };
    const { driver } = await import('driver.js');
    const text = (key: string) => translate.current(`${id}.${key}`);
    const isMissing = (target: string) => !document.querySelector(tourSelector(target));
    const definition = TUTORIALS[id];
    const advance = async (instance: Driver, state: ReturnType<Driver['getState']>) => {
      const current = definition.steps[state.activeIndex ?? -1];
      const required = current && 'requires' in current ? current.requires : undefined;
      if (required && !(await appears(required, REVEAL_GRACE_MS))) {
        const description = state.popover?.description;
        if (description) description.textContent = translate.current('mustAct');
        return;
      }
      instance.moveNext();
    };
    const tour = driver({
      steps: buildTourSteps(definition, text, isMissing),
      showProgress: true,
      progressText: translate.current('progress', { current: '{{current}}', total: '{{total}}' }),
      nextBtnText: translate.current('next'),
      prevBtnText: translate.current('previous'),
      doneBtnText: translate.current('done'),
      closeBtnLabel: translate.current('close'),
      popoverClass: 'sellf-tour',
      overlayOpacity: 0.6,
      stagePadding: 6,
      stageRadius: 8,
      disableActiveInteraction: true,
      overlayClickBehavior: 'none',
      skipMissingElement: true,
      animate: false,
      smoothScroll: false,
      onNextClick: (_element, _step, { driver: instance, state }) => advance(instance, state),
      onHighlighted: (element, _step, { driver: instance, state }) => {
        const current = definition.steps[state.activeIndex ?? -1];
        if (!element || !current || !('requires' in current) || !current.requires || !isMissing(current.requires)) return;
        const proceed = () => { element.removeEventListener('click', proceed, true); if (instance.getActiveElement() === element) void advance(instance, instance.getState()); };
        element.addEventListener('click', proceed, true);
      },
      onDestroyed: () => { layoutWatch.disconnect(); active.current = null; },
    });
    const layoutWatch = new ResizeObserver(() => {
      const element = tour.getActiveElement();
      if (!element || element.id === 'driver-dummy-element') return;
      const { top, bottom } = element.getBoundingClientRect();
      if (bottom < 0 || top > window.innerHeight) element.scrollIntoView({ block: 'center' });
      tour.refresh();
    });
    layoutWatch.observe(document.body);
    active.current = { id, destroy: () => tour.destroy() };
    if (remember) {
      seen.current.add(id);
      void markTutorialSeen(id).then(result => { if (!result.success) console.error('[tutorials] Progress not saved:', result.error); });
    }
    tour.drive();
  }, []);

  const runRef = useRef(run);
  runRef.current = run;

  const register = useCallback((id: TutorialId) => {
    setAvailable(current => [...current, id]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (requestedTutorial() === id) {
      timer = setTimeout(() => {
        const url = new URL(window.location.href);
        url.searchParams.delete('tutorial');
        window.history.replaceState(window.history.state, '', url);
        void runRef.current(id, false);
      }, AUTO_START_DELAY_MS);
    }
    return () => {
      clearTimeout(timer);
      setAvailable(current => { const next = [...current]; const index = next.indexOf(id); if (index >= 0) next.splice(index, 1); return next; });
      if (active.current?.id === id) active.current.destroy();
    };
  }, []);

  const autoStartTutorial = useCallback((id: TutorialId) => {
    if (!autoStart || seen.current.has(id) || requestedTutorial() === id) return () => {};
    const timer = setTimeout(() => { if (!seen.current.has(id)) void runRef.current(id, true); }, AUTO_START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [autoStart]);

  const start = useCallback((id: TutorialId) => { void runRef.current(id, false); }, []);
  const value = useMemo(() => ({ available, register, autoStart: autoStartTutorial, start }), [available, register, autoStartTutorial, start]);

  return <TutorialContext.Provider value={value}>{children}</TutorialContext.Provider>;
}
