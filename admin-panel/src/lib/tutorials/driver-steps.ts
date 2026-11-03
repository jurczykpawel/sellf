import type { DriveStep } from 'driver.js';
import type { TutorialDef } from '@/lib/tutorials/registry';

/** How long a step waits for an element revealed by the click on the previous step. */
const REVEAL_WAIT_MS = 2000;

export function tourSelector(target: string): string {
  return `[data-tour="${target}"]`;
}

/** The popover renders title and description as HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** `text` resolves `steps.<key>.title|body|bodyAct`; `isMissing` tells whether a `data-tour` element is absent from the page. */
export function buildTourSteps(def: TutorialDef, text: (key: string) => string, isMissing: (target: string) => boolean): DriveStep[] {
  return def.steps.map((step, index): DriveStep => {
    const prompt = 'requires' in step && step.requires !== undefined && isMissing(step.requires);
    const previous = def.steps[index - 1];
    const revealedByClick = previous !== undefined && 'requires' in previous && previous.requires !== undefined && 'target' in step && step.target === previous.requires;
    return {
      ...('target' in step && step.target ? { element: tourSelector(step.target) } : {}),
      ...(revealedByClick ? { waitForElement: REVEAL_WAIT_MS } : {}),
      ...(prompt ? { advanceOnClick: true, disableActiveInteraction: false } : {}),
      popover: {
        title: escapeHtml(text(`steps.${step.key}.title`)),
        description: escapeHtml(text(`steps.${step.key}.${prompt ? 'bodyAct' : 'body'}`)),
      },
    };
  });
}
