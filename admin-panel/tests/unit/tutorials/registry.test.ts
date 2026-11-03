import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TUTORIALS, TUTORIAL_IDS, isTutorialId } from '@/lib/tutorials/registry';

const root = path.resolve(import.meta.dirname, '../../..');
const sources = (readdirSync(path.join(root, 'src'), { recursive: true }) as string[])
  .filter(file => /\.tsx$/.test(file) && !file.startsWith('messages'))
  .map(file => readFileSync(path.join(root, 'src', file), 'utf8'));
const messages = (locale: 'en' | 'pl') => JSON.parse(readFileSync(path.join(root, `src/messages/${locale}.json`), 'utf8')).tutorials as Record<string, Record<string, unknown>>;

describe('tutorial registry', () => {
  it('uses identifiers the progress table accepts', () => {
    for (const id of TUTORIAL_IDS) expect(id).toMatch(/^[a-z][a-z0-9-]{1,63}$/);
    expect(isTutorialId('events')).toBe(true);
    expect(isTutorialId('constructor')).toBe(false);
    expect(isTutorialId(42)).toBe(false);
  });

  it('gives every step a unique key and every non-introductory step a target', () => {
    for (const id of TUTORIAL_IDS) {
      const keys = TUTORIALS[id].steps.map(step => step.key);
      expect(new Set(keys).size, id).toBe(keys.length);
      expect(TUTORIALS[id].steps[0].key, id).toBe('intro');
      for (const step of TUTORIALS[id].steps.slice(1)) expect('target' in step && step.target, `${id}/${step.key}`).toBeTruthy();
    }
  });

  it('points every step at an element that carries the matching data-tour marker exactly once in the code', () => {
    const seen = new Set<string>();
    for (const id of TUTORIAL_IDS) {
      for (const step of TUTORIALS[id].steps) {
        const targets = ['target' in step ? step.target : undefined, 'requires' in step ? step.requires : undefined].filter((v): v is string => Boolean(v));
        for (const target of targets) {
          const owners = sources.filter(source => source.includes(`'${target}'`) || source.includes(`"${target}"`));
          expect(owners.length, `${id}/${step.key} -> ${target}`).toBeGreaterThan(0);
        }
        if ('target' in step && step.target) {
          expect(seen.has(step.target), `duplicate target ${step.target}`).toBe(false);
          seen.add(step.target);
        }
      }
    }
  });

  it.each(['en', 'pl'] as const)('has complete %s texts for every tutorial and step', locale => {
    const texts = messages(locale);
    for (const id of TUTORIAL_IDS) {
      const entry = texts[id] as { name?: string; where?: string; steps?: Record<string, { title?: string; body?: string; bodyAct?: string }> };
      expect(entry?.name, `${id}.name`).toBeTruthy();
      for (const step of TUTORIALS[id].steps) {
        const text = entry.steps?.[step.key];
        expect(text?.title, `${id}.${step.key}.title`).toBeTruthy();
        expect(text?.body, `${id}.${step.key}.body`).toBeTruthy();
        if ('requires' in step && step.requires) expect(text?.bodyAct, `${id}.${step.key}.bodyAct`).toBeTruthy();
        expect(`${text?.title}${text?.body}${text?.bodyAct ?? ''}`, `${id}.${step.key}`).not.toMatch(/[<>{}]/);
      }
      if ('needsOpenForm' in TUTORIALS[id]) expect(entry.where, `${id}.where`).toBeTruthy();
    }
  });
});
