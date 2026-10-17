/** Synthetic seller projects over already approved public image DTOs. */
import { referenceConfig } from './phase2/contracts';

export const projectsSpec = { id: 'projects', type: 'project-showcase/1', content: { slot: 'home.projects' } } as const;
export const projectMediaId = '00000000-0000-4000-8000-000000000017';
export type ProjectsState = 'projects' | 'empty' | 'long' | 'media' | 'unresolved-media';
export function projectsFixture(locale: 'en' | 'pl', state: ProjectsState = 'projects') {
  const content = structuredClone(referenceConfig().content['home.projects'][locale]);
  if (state === 'long') {
    content.heading = 'ąŻLongWord'.repeat(16);
    for (const item of content.items) Object.assign(item, { name: 'ąŻ'.repeat(60), body: 'ąŻLongWord'.repeat(100) });
  }
  if (state === 'media' || state === 'unresolved-media') content.items[0].mediaId = projectMediaId;
  return { locale, slots: state === 'empty' ? {} : { 'home.projects': content },
    mediaById: state === 'media' ? { [projectMediaId]: { src: 'https://phase2.test/sample.svg', alt: locale === 'pl' ? 'Przykładowy projekt' : 'Example project', width: 800, height: 500 } } : {} };
}
