/** Free-product lead delivery shared by authenticated and magic-link grants. @see free-product-access.ts */
import { getCanonicalOriginOrNull } from '@/lib/utils/canonical-url';
import { issueLicense } from '@/lib/license-keys/issue';
import { sendLicenseMail } from '@/lib/license-keys/license-mail';
import { WebhookService } from '@/lib/services/webhook-service';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FreeProductInput } from '@/lib/services/free-product-access';

export async function emitFreeAccessLead(adminClient: SupabaseClient, { product, user, customFieldValues, locale }: FreeProductInput, lead?: { data: Record<string, unknown>; sendMail: boolean }): Promise<boolean> {
  try {
    const { data: details, error } = await adminClient.from('products').select('id,name,slug,price,currency,icon').eq('id', product.id).single();
    if (error || !details) {
      console.error('[free-access] Product details unavailable');
      return false;
    }
    const { data: access, error: accessError } = await adminClient.from('user_product_access').select('access_granted_at,access_expires_at,custom_field_values').eq('user_id', user.id).eq('product_id', product.id).single();
    if (accessError || !access) {
      console.error('[free-access] Access details unavailable');
      return false;
    }
    if (!locale) {
      const account = await adminClient.auth.admin.getUserById(user.id).catch(() => ({ data: { user: null } }));
      locale = account.data.user?.user_metadata?.locale === 'pl' ? 'pl' : 'en';
    }
    const savedValues = (access.custom_field_values ?? customFieldValues) as Record<string, string> | undefined;
    const orderId = `free_${user.id}_${product.id}`;
    const license = await issueLicense(adminClient, {
      productId: product.id, email: user.email, userId: user.id, orderId,
      ...(savedValues !== undefined ? { customFieldValues: savedValues } : {}),
    }).catch(() => { console.error('[free-access] License issuance failed'); return null; });
    if (license && (!lead || lead.sendMail)) await sendLicenseMail(adminClient, { userId: user.id, email: user.email, productSlug: details.slug, productName: details.name, token: license.token, locale });
    const payload = {
      ...lead?.data,
      ...(savedValues !== undefined ? { customFieldValues: savedValues } : {}),
      customer: { email: user.email, userId: user.id, locale }, product: details,
      accessGrantedAt: access.access_granted_at, accessExpiresAt: access.access_expires_at,
      ...(license ? { license: { token: license.token, kid: license.kid, jwksUrl: `${getCanonicalOriginOrNull() ?? ''}/api/licenses/jwks?seller=${license.sellerId}` } } : {}),
    };
    await WebhookService.trigger('lead.captured', payload, adminClient, product.id, lead ? `lead:${lead.data.leadId}` : orderId);
    return true;
  } catch {
    console.error('[free-access] Lead delivery failed');
    return false;
  }
}
