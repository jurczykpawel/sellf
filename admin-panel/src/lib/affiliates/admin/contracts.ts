/** Session-only affiliate administration DTOs. @see actions.ts */
import { z } from 'zod';
import { programSchema, versionSchema } from '@/lib/affiliates/model';
import type { ActionResponse } from '@/lib/actions/admin-auth';
import type { ProgramInput } from '@/lib/affiliates/model';

const reference = z.string().min(1).max(200).regex(/^[^\r\n]+$/).refine(value => value.trim().length > 0);
export const programUpdateSchema = programSchema.extend({ version: z.union([z.literal('0'), versionSchema]), terms_version: reference });
export const applicationSchema = z.strictObject({
  code: z.string().regex(/^[a-z0-9_-]{3,40}$/), display_name: z.string().trim().min(1).max(120),
  channel: z.string().trim().max(500), terms_version: reference, accepted: z.literal(true), captcha_token: z.string().min(1).max(16384),
});
export const memberUpdateSchema = z.strictObject({ member_id: z.uuid(), version: versionSchema, status: z.enum(['approved', 'rejected', 'suspended', 'terminated']), reason: reference });
export const pageSchema = z.strictObject({ cursor: z.uuid().optional(), limit: z.number().int().min(1).max(100).default(25), status: z.enum(['pending', 'approved', 'rejected', 'suspended', 'terminated']).optional() });
export function boundedInput(input: unknown): boolean {
  try { return new TextEncoder().encode(JSON.stringify(input)).length <= 32768; } catch { return false; }
}
export interface MemberInfo {
  id: string; code: string; display_name: string; email?: string | null; channel: string | null; status: string; version: string;
  accepted_terms_version: string; accepted_at: string; created_at: string;
}
export interface ProgramInfo extends ProgramInput { id: string }
export interface TermsInfo { terms_version: string; terms: { en: string; pl: string } }
export interface ApplicationProgramInfo extends TermsInfo { enabled: boolean; applicationStatus?: string | null }
export interface AdminOverview { program: ProgramInfo | null; members: MemberInfo[]; next_cursor: string | null }
export type AdminResult<T> = ActionResponse<T> & { status: number };
// A1.8 applies these on the private route shells/HTTP adapters. Actions opt out of caching themselves.
export const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

export const workRetrySchema = z.strictObject({ payment_id: z.uuid(), generation: versionSchema, reason: reference });
export interface SyncWorkInfo { payment_id: string; requested_generation: string; attempts: number; last_error_code: string | null; payment: { created_at: string; product: { name: string } | null } | null }
export interface SyncOverview { work: SyncWorkInfo[]; next_cursor: string | null; oldest_pending_at: string | null }
