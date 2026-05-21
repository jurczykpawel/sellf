import { createAdminClient } from '@/lib/supabase/admin';

export interface ConsumedNonce {
  userId: string;
  productId: string;
}

export interface StoreNonceInput {
  productId: string;
  userId: string;
  nonceHash: string;
  expiresAt: Date;
}

export async function storeLoginwallNonce(input: StoreNonceInput): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('loginwall_tokens')
    .insert({
      user_id: input.userId,
      product_id: input.productId,
      nonce_hash: input.nonceHash,
      expires_at: input.expiresAt.toISOString(),
    });
  if (error) {
    throw new Error(`storeLoginwallNonce: ${error.message}`);
  }
}

export async function consumeLoginwallNonce(nonceHash: string): Promise<ConsumedNonce | null> {
  const supabase = createAdminClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('loginwall_tokens')
    .update({ used_at: nowIso })
    .eq('nonce_hash', nonceHash)
    .is('used_at', null)
    .gt('expires_at', nowIso)
    .select('user_id, product_id')
    .maybeSingle();

  if (error) {
    throw new Error(`consumeLoginwallNonce: ${error.message}`);
  }
  if (!data) return null;
  return { userId: data.user_id, productId: data.product_id };
}
