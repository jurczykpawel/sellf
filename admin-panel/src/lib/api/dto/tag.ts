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
