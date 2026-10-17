/** Biography over an already localized public slot; no product or media reads.
 * @see docs/templates/phase2-contracts.md
 */
import AuthorStory from '@/components/storefront/sections/AuthorStory';
import { biographyContentSchema, phase2SectionSchema } from '@/lib/storefront-templates/phase2-contracts';
import type { AuthorStoryProps, Phase2PublicInputs } from '@/lib/storefront-templates/phase2-contracts';

type AuthorStoryInputs = Pick<Phase2PublicInputs, 'locale'> & { slots: Record<string, unknown> };
export function resolveAuthorStory(spec: unknown, inputs: AuthorStoryInputs):
  { success: true; data: AuthorStoryProps } | { success: false; error: 'INVALID' } {
  const parsed = phase2SectionSchema.safeParse(spec);
  if (!parsed.success || parsed.data.type !== 'author-story/1') return { success: false, error: 'INVALID' };
  const slot = inputs.slots[parsed.data.content.slot];
  if (slot === undefined) return { success: true, data: { content: null, locale: inputs.locale } };
  const content = biographyContentSchema.safeParse(slot);
  return content.success ? { success: true, data: { content: content.data, locale: inputs.locale } }
    : { success: false, error: 'INVALID' };
}

export const authorStoryDefinition = {
  type: 'author-story/1', schema: phase2SectionSchema.options.find(schema => schema.shape.type.value === 'author-story/1')!,
  resolve: resolveAuthorStory, Component: AuthorStory,
  fixtureIds: ['story', 'empty', 'blank', 'long', 'punctuation'],
} as const;
