/**
 * DTOs for the category server actions (createCategory/updateCategory). Mirrors
 * dto/tag.ts. Limits mirror the DB CHECK constraints in
 * supabase/migrations/20250101000000_core_schema.sql (public.categories):
 *   name <= 100, slug ~ ^[a-zA-Z0-9_-]+$ AND length 1..100, description <= 500.
 * (There is no /api/v1/categories route yet; this is also ready for one.)
 */

import { z } from 'zod';

const CATEGORY_SLUG_RE = /^[a-zA-Z0-9_-]+$/;

export const CategoryCreateDTO = z
  .object({
    name: z.string().trim().min(1).max(100),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((s) => CATEGORY_SLUG_RE.test(s), 'slug must match ^[a-zA-Z0-9_-]+$'),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const CategoryUpdateDTO = CategoryCreateDTO.partial();

export type CategoryCreateInput = z.infer<typeof CategoryCreateDTO>;
export type CategoryUpdateInput = z.infer<typeof CategoryUpdateDTO>;
