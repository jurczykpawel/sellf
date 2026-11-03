import { describe, expect, it } from 'vitest';
import { buildTourSteps, tourSelector, escapeHtml } from '@/lib/tutorials/driver-steps';
import type { TutorialDef } from '@/lib/tutorials/registry';

const def: TutorialDef = {
  href: '/x',
  steps: [{ key: 'intro' }, { key: 'toggle', target: 'x-toggle', requires: 'x-fields' }, { key: 'fields', target: 'x-fields' }],
};
const text = (key: string) => `T[${key}]`;

describe('tour steps', () => {
  it('selects elements by their data-tour marker', () => {
    expect(tourSelector('x-fields')).toBe('[data-tour="x-fields"]');
  });

  it('escapes markup because the popover renders text as HTML', () => {
    expect(escapeHtml(`<img src=x onerror="a()"> & 'b'`)).toBe('&lt;img src=x onerror=&quot;a()&quot;&gt; &amp; &#39;b&#39;');
  });

  it('centres the introduction and highlights the targets of the other steps', () => {
    const steps = buildTourSteps(def, text, () => false);
    expect(steps[0].element).toBeUndefined();
    expect(steps[1].element).toBe('[data-tour="x-toggle"]');
    expect(steps.map(step => step.popover?.title)).toEqual(['T[steps.intro.title]', 'T[steps.toggle.title]', 'T[steps.fields.title]']);
    expect(steps[1].popover?.description).toBe('T[steps.toggle.body]');
  });

  it('turns a step into a click prompt while the element it reveals is missing', () => {
    const steps = buildTourSteps(def, text, target => target === 'x-fields');
    expect(steps[1].popover?.description).toBe('T[steps.toggle.bodyAct]');
    expect(steps[1].disableActiveInteraction).toBe(false);
  });

  it('waits for the element a click on the previous step reveals, and only for that one', () => {
    const steps = buildTourSteps(def, text, () => false);
    expect(steps.map(step => step.waitForElement)).toEqual([undefined, undefined, 2000]);
  });

  it('keeps the highlighted control inert once it only informs', () => {
    const steps = buildTourSteps(def, text, () => false);
    expect(steps[1].disableActiveInteraction).toBeUndefined();
  });
});
