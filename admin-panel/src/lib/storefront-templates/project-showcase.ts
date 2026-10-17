/** Project presentation from localized slots and approved product-image DTOs.
 * @see docs/templates/phase2-contracts.md
 */
import ProjectShowcase from '@/components/storefront/sections/ProjectShowcase';
import { phase2SectionSchema, projectsContentSchema } from '@/lib/storefront-templates/phase2-contracts';
import { publicMediaSchema } from '@/lib/storefront-templates/public-media';
import type { Phase2PublicInputs, ProjectShowcaseProps } from '@/lib/storefront-templates/phase2-contracts';

type ProjectShowcaseInputs = Pick<Phase2PublicInputs, 'locale' | 'mediaById'> & { slots: Record<string, unknown> };
export function resolveProjectShowcase(spec: unknown, inputs: ProjectShowcaseInputs):
  { success: true; data: ProjectShowcaseProps } | { success: false; error: 'INVALID' } {
  const invalid = { success: false, error: 'INVALID' } as const;
  const parsed = phase2SectionSchema.safeParse(spec);
  if (!parsed.success || parsed.data.type !== 'project-showcase/1') return invalid;
  const slot = inputs.slots[parsed.data.content.slot];
  if (slot === undefined) return { success: true, data: { heading: '', items: [], locale: inputs.locale } };
  const content = projectsContentSchema.safeParse(slot);
  if (!content.success) return invalid;
  const items = content.data.items.map(({ id, name, body, url, mediaId }) => {
    const key = mediaId?.toLowerCase();
    const media = publicMediaSchema.safeParse(key && Object.hasOwn(inputs.mediaById, key) ? inputs.mediaById[key] : null);
    return { id, name, body, url, media: media.success ? media.data : null };
  });
  return { success: true, data: { heading: content.data.heading, items, locale: inputs.locale } };
}
export const projectShowcaseDefinition = {
  type: 'project-showcase/1', schema: phase2SectionSchema.options.find(schema => schema.shape.type.value === 'project-showcase/1')!,
  resolve: resolveProjectShowcase, Component: ProjectShowcase,
  fixtureIds: ['projects', 'empty', 'long', 'media', 'unresolved-media'],
} as const;
