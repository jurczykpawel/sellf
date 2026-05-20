import { z } from 'zod';

export const ConsentBodySchema = z.object({
  anonymous_id: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9_-]+$/i, 'anonymous_id must be alphanumeric, underscore or hyphen')
    .optional(),
  consents: z
    .record(z.string(), z.unknown())
    .optional()
    .refine(
      (v) => v === undefined || JSON.stringify(v).length <= 5000,
      'consents payload exceeds 5000 bytes',
    ),
  consent_version: z.string().max(50).optional(),
});

export type ConsentBody = z.infer<typeof ConsentBodySchema>;

export type ConsentParseResult =
  | { ok: true; data: ConsentBody }
  | { ok: false; error: string };

export function parseConsentBody(input: unknown): ConsentParseResult {
  const parsed = ConsentBodySchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const first = parsed.error.issues[0];
  const path = first?.path.join('.') || '_';
  return { ok: false, error: `${path}: ${first?.message ?? 'invalid'}` };
}
