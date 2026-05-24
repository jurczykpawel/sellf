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

export interface EmbeddedCategory { id: string; name: string; slug: string; }
export interface EmbeddedTag { id: string; name: string; slug: string; }

type EmbeddedRow = {
  product_categories?: Array<{ category_id: unknown; categories: EmbeddedCategory | null }> | null;
  product_tags?: Array<{ tag_id: unknown; tags: EmbeddedTag | null }> | null;
};

export function transformEmbeddedRelations<T extends EmbeddedRow>(
  row: T,
): Omit<T, 'product_categories' | 'product_tags'> & { categories?: EmbeddedCategory[]; tags?: EmbeddedTag[] } {
  const { product_categories, product_tags, ...rest } = row;
  const out: Omit<T, 'product_categories' | 'product_tags'> & { categories?: EmbeddedCategory[]; tags?: EmbeddedTag[] } = { ...rest } as Omit<T, 'product_categories' | 'product_tags'>;
  if (Array.isArray(product_categories)) {
    out.categories = product_categories.map((pc) => pc.categories).filter((x) => x != null);
  }
  if (Array.isArray(product_tags)) {
    out.tags = product_tags.map((pt) => pt.tags).filter((x) => x != null);
  }
  return out;
}
