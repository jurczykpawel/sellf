/** Co-creator share contracts shared by panel actions, API v1 and the OpenAPI registry. @see service.ts */
import { z } from 'zod';
import { currencySchema, minorSchema } from '@/lib/affiliates/model';

const reference = z.string().min(1).max(200).regex(/^[^\r\n]+$/).refine(value => value.trim().length > 0);
const revisionSchema = z.number().int().min(0).max(2147483646);

/** Percentage (basis points, 1–10000) or a fixed amount in minor units of one currency. */
export const cocreatorRateSchema = z.union([
  z.strictObject({ percentage_bps: z.number().int().min(1).max(10000), fixed_minor: z.null().optional(), currency: z.null().optional() }),
  z.strictObject({ percentage_bps: z.null().optional(), fixed_minor: minorSchema.refine(value => BigInt(value) > BigInt(0)), currency: currencySchema }),
]);

/** API v1 PUT body: the product comes from the path; omitting expected_revision overwrites the current setting. */
export const cocreatorPutSchema = z.strictObject({
  email: z.email().max(254).describe('E-mail of an existing account (the person signs in once before being assigned)'),
  display_name: z.string().trim().min(1).max(120).optional().describe('Name shown in the payout list; defaults to the part of the e-mail before @'),
  rule: cocreatorRateSchema,
  expected_revision: revisionSchema.optional().describe('Revision read earlier; a newer one returns 409'),
});
export const cocreatorSetSchema = cocreatorPutSchema.extend({ product_id: z.uuid(), expected_revision: revisionSchema });
export const cocreatorRemoveSchema = z.strictObject({ product_id: z.uuid(), expected_revision: revisionSchema });

export const creatorTermsSchema = z.strictObject({ en: z.string().trim().min(1).max(32768), pl: z.string().trim().min(1).max(32768) });
export const creatorTermsPublishSchema = z.strictObject({ expected_version: reference.nullable(), terms_version: reference, terms: creatorTermsSchema });
export const creatorAcceptSchema = z.strictObject({ terms_version: reference, accepted: z.literal(true) });

export const cocreatorResponseSchema = z.object({
  product_id: z.uuid(),
  revision: z.number().int().describe('Current revision; send it back as expected_revision'),
  program_configured: z.boolean().describe('Partner program settings exist (needed for hold days and payout thresholds)'),
  cocreator: z.object({
    member_id: z.uuid(), display_name: z.string(), email: z.string().nullable(),
    percentage_bps: z.number().int().nullable(), fixed_minor: z.string().nullable(), currency: z.string().nullable(),
    since: z.string().describe('Purchases from this moment on earn the share; earlier ones never do'),
    terms_accepted: z.boolean().describe('Payouts of co-creator shares wait for the creator terms'),
  }).nullable(),
});

export type CocreatorRate = z.infer<typeof cocreatorRateSchema>;
export type CocreatorInfo = z.infer<typeof cocreatorResponseSchema>;
export interface CreatorTermsInfo { terms_version: string; terms: { en: string; pl: string }; created_at: string }
