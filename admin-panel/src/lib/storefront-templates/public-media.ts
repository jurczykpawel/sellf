/** Projection of approved product-image adapter DTOs for author sections.
 * @see lib/storefront-templates/catalogue.ts
 */
import { z } from 'zod';

export const publicMediaSchema = z.object({
  src: z.string().max(2048).refine(value => {
    if (/[\u0000-\u0020\u007f\\]/.test(value)) return false;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
  }),
  alt: z.string().max(4000), width: z.number().int().positive(), height: z.number().int().positive(),
});
