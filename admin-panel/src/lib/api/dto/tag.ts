/**
 * DTOs for /api/v1/tags create/update bodies and the API field projection.
 * Slug regex mirrors the DB CHECK constraint defined in
 * supabase/migrations/20250101000000_core_schema.sql (seller_main.tags).
 */

import { z } from 'zod';

const TAG_SLUG_RE = /^[a-zA-Z0-9_-]+$/;

export const TagCreateDTO = z
  .object({
    name: z.string().trim().min(1).max(50),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .refine((s) => TAG_SLUG_RE.test(s), 'slug must match ^[a-zA-Z0-9_-]+$'),
  })
  .strict();

export const TagUpdateDTO = TagCreateDTO.partial();

export type TagCreateInput = z.infer<typeof TagCreateDTO>;
export type TagUpdateInput = z.infer<typeof TagUpdateDTO>;

export const TAG_API_FIELDS = 'id, name, slug, created_at';

export const TAG_SORT_COLUMNS: Record<string, string> = {
  created_at: 'created_at',
  name: 'name',
  slug: 'slug',
};

export function validateTagSortColumn(sortBy: string | null): string {
  if (!sortBy || typeof sortBy !== 'string') return 'created_at';
  return TAG_SORT_COLUMNS[sortBy] ?? 'created_at';
}
