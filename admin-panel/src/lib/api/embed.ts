export type EmbedKey = 'categories' | 'tags';
const ALLOWED: ReadonlySet<EmbedKey> = new Set(['categories', 'tags']);

export function parseEmbed(raw: string | null | undefined): Set<EmbedKey> {
  if (!raw) return new Set();
  const out = new Set<EmbedKey>();
  for (const part of raw.split(',')) {
    const key = part.trim() as EmbedKey;
    if (ALLOWED.has(key)) out.add(key);
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

type EmbeddedRow = Record<string, unknown> & {
  product_categories?: Array<{ category_id: unknown; categories: unknown }> | null;
  product_tags?: Array<{ tag_id: unknown; tags: unknown }> | null;
};

export function transformEmbeddedRelations<T extends EmbeddedRow>(
  row: T,
): Omit<T, 'product_categories' | 'product_tags'> & { categories?: unknown[]; tags?: unknown[] } {
  const { product_categories, product_tags, ...rest } = row;
  const out: Record<string, unknown> = { ...rest };
  if (Array.isArray(product_categories)) {
    out.categories = product_categories.map((pc) => pc.categories).filter((x) => x != null);
  }
  if (Array.isArray(product_tags)) {
    out.tags = product_tags.map((pt) => pt.tags).filter((x) => x != null);
  }
  return out as Omit<T, 'product_categories' | 'product_tags'> & {
    categories?: unknown[];
    tags?: unknown[];
  };
}
