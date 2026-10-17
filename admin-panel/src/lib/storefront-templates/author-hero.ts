/** Author hero over resolved public media; pass the visible recipe after layout resolution.
 * @see docs/templates/phase2-contracts.md
 */
import AuthorHero from '@/components/storefront/sections/AuthorHero';
import { authorContentSchema, phase2SectionSchema, phase2StorefrontRecipeSchema } from '@/lib/storefront-templates/phase2-contracts';
import { publicMediaSchema } from '@/lib/storefront-templates/public-media';
import type { AuthorHeroProps, Phase2PublicInputs } from '@/lib/storefront-templates/phase2-contracts';

type AuthorHeroInputs = Pick<Phase2PublicInputs, 'locale' | 'mediaById'> & { slots: Record<string, unknown> };
export function resolveAuthorHero(spec: unknown, inputs: AuthorHeroInputs, recipe: unknown):
  { success: true; data: AuthorHeroProps } | { success: false; error: 'INVALID' } {
  const invalid = { success: false, error: 'INVALID' } as const;
  const parsed = phase2SectionSchema.safeParse(spec);
  const layout = phase2StorefrontRecipeSchema.safeParse(recipe);
  if (!parsed.success || parsed.data.type !== 'author-hero/1' || !layout.success) return invalid;
  const section = parsed.data;
  if (!layout.data.sections.some(candidate => candidate.type === section.type && candidate.id === section.id
    && candidate.pathsTarget === section.pathsTarget && candidate.catalogueTarget === section.catalogueTarget)) return invalid;
  const slot = inputs.slots[section.content.slot];
  const content = slot === undefined ? null : authorContentSchema.safeParse(slot);
  if (content && !content.success) return invalid;
  const author = content?.success ? content.data : null;
  const mediaId = author?.portraitMediaId?.toLowerCase();
  const portrait = publicMediaSchema.safeParse(mediaId && Object.hasOwn(inputs.mediaById, mediaId) ? inputs.mediaById[mediaId] : null);
  return { success: true, data: { content: author, portrait: portrait.success ? portrait.data : null,
    pathsTarget: section.pathsTarget, catalogueTarget: section.catalogueTarget, locale: inputs.locale } };
}

export const authorHeroDefinition = {
  type: 'author-hero/1', schema: phase2SectionSchema.options.find(schema => schema.shape.type.value === 'author-hero/1')!,
  resolve: resolveAuthorHero, Component: AuthorHero,
  fixtureIds: ['portrait', 'empty', 'blank', 'no-media', 'unresolved-media', 'long', 'hostile'],
} as const;
