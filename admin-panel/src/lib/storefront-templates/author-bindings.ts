/** Localized author references for the shared public product adapter.
 * Media UUIDs identify public product covers; missing covers remain absent.
 * @see public-media.ts
 */
import { authorContentSchema, pathsContentSchema, projectsContentSchema } from '@/lib/storefront-templates/phase2-contracts';
import type { StorefrontSelection } from '@/lib/storefront-templates/resolver';

export function collectAuthorBindings(selection: StorefrontSelection, locale: 'en' | 'pl'): { pathProducts: string[]; mediaProducts: string[] } {
  const localized = (id: keyof StorefrontSelection['content']) => {
    const slot = selection.content[id];
    return slot?.[locale] ?? (slot && slot[slot.sourceLocale]);
  };
  const visible = new Set(selection.recipe.sections.map(section => section.type));
  const paths = visible.has('product-paths/1') ? pathsContentSchema.safeParse(localized('home.paths')) : null;
  const author = visible.has('author-hero/1') ? authorContentSchema.safeParse(localized('home.author')) : null;
  const projects = visible.has('project-showcase/1') ? projectsContentSchema.safeParse(localized('home.projects')) : null;
  return {
    pathProducts: paths?.success ? [...new Set(paths.data.items.map(item => item.productId.toLowerCase()))] : [],
    mediaProducts: [...new Set([author?.success ? author.data.portraitMediaId : null,
      ...(projects?.success ? projects.data.items.map(item => item.mediaId) : [])].filter((id): id is string => id !== null).map(id => id.toLowerCase()))],
  };
}
