'use server';

/** Panel actions for the co-creator share and the creator terms. @see service.ts */
import { revalidatePath } from 'next/cache';
import { withAdminClient } from '@/lib/actions/admin-auth';
import { isDemoMode } from '@/lib/demo-guard';
import { checkRateLimit } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { creatorAcceptSchema, creatorTermsPublishSchema, cocreatorRemoveSchema, cocreatorSetSchema } from '@/lib/affiliates/cocreator/model';
import { cocreatorFailure, publishCreatorTermsWith, readCreatorTerms, readProductCocreator, writeProductCocreator } from '@/lib/affiliates/cocreator/service';
import type { ActionResponse } from '@/lib/actions/admin-auth';
import type { CocreatorInfo, CreatorTermsInfo } from '@/lib/affiliates/cocreator/model';
import type { CocreatorResult } from '@/lib/affiliates/cocreator/service';

function toAction<T>(result: CocreatorResult<T>): ActionResponse<T> {
  return result.success ? result : { success: false, error: result.errorCode, errorCode: result.errorCode };
}
const invalid: ActionResponse<never> = { success: false, error: 'INVALID_INPUT', errorCode: 'INVALID_INPUT' };

export async function getProductCocreator(productId: string): Promise<ActionResponse<CocreatorInfo & { product_type: string; product_currency: string }>> {
  return withAdminClient(async ({ dataClient }) => {
    if (!cocreatorRemoveSchema.shape.product_id.safeParse(productId).success) return invalid;
    return toAction(await readProductCocreator(dataClient, productId));
  });
}

export async function setProductCocreator(input: unknown): Promise<ActionResponse<{ revision: number }>> {
  return withAdminClient(async ({ user, dataClient }) => {
    const parsed = cocreatorSetSchema.safeParse(input);
    if (!parsed.success) return invalid;
    const { product_id, expected_revision, email, display_name, rule } = parsed.data;
    return toAction(await writeProductCocreator(dataClient, user.id, { product_id, expected_revision, person: { email, display_name, rule } }));
  }, { mutating: true });
}

export async function removeProductCocreator(input: unknown): Promise<ActionResponse<{ revision: number }>> {
  return withAdminClient(async ({ user, dataClient }) => {
    const parsed = cocreatorRemoveSchema.safeParse(input);
    if (!parsed.success) return invalid;
    return toAction(await writeProductCocreator(dataClient, user.id, { ...parsed.data, person: null }));
  }, { mutating: true });
}

export async function getCreatorTerms(): Promise<ActionResponse<CreatorTermsInfo | null>> {
  return withAdminClient(async ({ dataClient }) => toAction(await readCreatorTerms(dataClient)));
}

export async function publishCreatorTerms(input: unknown): Promise<ActionResponse<CreatorTermsInfo>> {
  return withAdminClient(async ({ user, dataClient }) => {
    const parsed = creatorTermsPublishSchema.safeParse(input);
    if (!parsed.success) return invalid;
    const result = await publishCreatorTermsWith(dataClient, user.id, parsed.data);
    if (result.success) revalidatePath('/[locale]/my-affiliate', 'page');
    return toAction(result);
  }, { mutating: true });
}

/** The signed-in co-creator accepts the current creator terms (their own account only). */
export async function acceptCreatorTerms(input: unknown): Promise<ActionResponse<{ terms_version: string }>> {
  if (isDemoMode()) return { success: false, error: 'DEMO_MODE', errorCode: 'DEMO_MODE' };
  const parsed = creatorAcceptSchema.safeParse(input);
  if (!parsed.success) return invalid;
  try {
    const session = await createClient();
    const { data: { user }, error } = await session.auth.getUser();
    if (error || !user) return { success: false, error: 'UNAUTHORIZED', errorCode: 'UNAUTHORIZED' };
    if (!await checkRateLimit('affiliate_creator_accept', 10, 15)) return { success: false, error: 'RATE_LIMITED', errorCode: 'RATE_LIMITED' };
    const { data, error: acceptError } = await createAdminClient().rpc('affiliate_creator_accept', { p_user: user.id, p_terms_version: parsed.data.terms_version });
    const version = (data as { creator_terms_version?: string | null } | null)?.creator_terms_version;
    if (acceptError || !version) return toAction(cocreatorFailure(acceptError));
    revalidatePath('/[locale]/my-affiliate', 'page');
    return { success: true, data: { terms_version: version } };
  } catch {
    return { success: false, error: 'INTERNAL_ERROR', errorCode: 'INTERNAL_ERROR' };
  }
}
