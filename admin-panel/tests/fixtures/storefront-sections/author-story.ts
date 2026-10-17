/** Synthetic biography fixtures, independent of product batches. */
import { referenceConfig } from './phase2/contracts';

export const storySpec = { id: 'story', type: 'author-story/1', content: { slot: 'home.story' } } as const;
export type AuthorStoryState = 'story' | 'empty' | 'blank' | 'long' | 'punctuation';
export function authorStoryFixture(locale: 'en' | 'pl', state: AuthorStoryState = 'story') {
  const content = structuredClone(referenceConfig().content['home.story'][locale]);
  if (state === 'blank') Object.assign(content, { heading: '  ', paragraphs: ['', '  '] });
  if (state === 'long') Object.assign(content, { heading: 'ąŻLongText'.repeat(16), paragraphs: Array(6).fill('ąŻlongword'.repeat(200)) });
  if (state === 'punctuation') Object.assign(content, { heading: '" & { biography }', paragraphs: ['Plain "quoted" prose & punctuation.'] });
  return { locale, slots: state === 'empty' ? {} : { 'home.story': content } };
}
