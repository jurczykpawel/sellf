/**
 * Embed helpers for projecting Supabase joined relations on /api/v1/products.
 * Lets list and single endpoints share the same allowlist, SELECT builder and
 * post-fetch flatten — see route handlers in @/app/api/v1/products.
 */

export type EmbedKey = 'categories' | 'tags';
const ALLOWED: ReadonlySet<EmbedKey> = new Set(['categories', 'tags']);

function isEmbedKey(value: string): value is EmbedKey {
  return ALLOWED.has(value as EmbedKey);
}

export function parseEmbed(raw: string | null | undefined): Set<EmbedKey> {
  if (!raw) return new Set();
  const out = new Set<EmbedKey>();
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (isEmbedKey(trimmed)) out.add(trimmed);
  }
  return out;
}

export function buildProductSelect(baseFields: string, embed: ReadonlySet<EmbedKey>): string {
  const parts: string[] = [baseFields];
  if (embed.has('categories')) {
    parts.push('product_categories ( category_id, categories ( id, name, slug ) )');
  }
  if (embed.has('tags')) {
    parts.push('product_tags ( tag_id, tags ( id, name, slug ) )');
  }
  return parts.join(', ');
}

export interface EmbeddedTaxonomy { id: string; name: string; slug: string; }
export type EmbeddedCategory = EmbeddedTaxonomy;
export type EmbeddedTag = EmbeddedTaxonomy;

type EmbeddedRow = {
  product_categories?: Array<{ category_id: unknown; categories: EmbeddedTaxonomy | null }> | null;
  product_tags?: Array<{ tag_id: unknown; tags: EmbeddedTaxonomy | null }> | null;
};

export function transformEmbeddedRelations<T extends EmbeddedRow>(
  row: T,
): Omit<T, 'product_categories' | 'product_tags'> & { categories?: EmbeddedTaxonomy[]; tags?: EmbeddedTaxonomy[] } {
  const { product_categories, product_tags, ...rest } = row;
  const out: Omit<T, 'product_categories' | 'product_tags'> & { categories?: EmbeddedTaxonomy[]; tags?: EmbeddedTaxonomy[] } = { ...rest } as Omit<T, 'product_categories' | 'product_tags'>;
  if (Array.isArray(product_categories)) {
    out.categories = product_categories.map((pc) => pc.categories).filter((x) => x != null);
  }
  if (Array.isArray(product_tags)) {
    out.tags = product_tags.map((pt) => pt.tags).filter((x) => x != null);
  }
  return out;
}
