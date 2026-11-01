/** A license restoration gives the consumer identity, original dates and an authoritative CRL link. */
import { expect, it } from 'vitest';
import { buildLicenseRestoreWebhookData } from '@/lib/services/license-revoke-webhook-payload';
import type { RevokedLicenseRow } from '@/lib/services/license-revoke-webhook-payload';
const row:RevokedLicenseRow={id:'licence-id',product_id:'product-id',email:'buyer@example.com',order_id:'order-id',seller_id:'seller-id',original_seller_id:'seller-id',license_domain:'buyer.example.com',issuance_source:'purchase',issued_at:'2026-01-01T00:00:00Z',expires_at:'2026-12-01T00:00:00Z',revoked_at:null,products:{name:'Course',slug:'course',license_tier:'pro'}};
it('keeps the original term and identifies the restored license without a token',()=>{
 const data=buildLicenseRestoreWebhookData({...row,license_key:'not-part-of-the-notification'} as RevokedLicenseRow,'https://shop.example','2026-02-01T00:00:00Z');
 expect(data).toMatchObject({license:{id:row.id,order:row.order_id,email:row.email,expiresAt:row.expires_at,revokedAt:null,restoredAt:'2026-02-01T00:00:00Z'},product:{id:row.product_id},crlUrl:'https://shop.example/api/licenses/revoked?seller=seller-id'});
 expect(JSON.stringify(data)).not.toContain('license_key');expect(JSON.stringify(data)).not.toContain('not-part-of-the-notification');
});

it('retains the original issuer in the CRL URL after its account reference is removed',()=>{
 const data=buildLicenseRestoreWebhookData({...row,seller_id:null},'https://shop.example','2026-02-01T00:00:00Z');
 expect(data.crlUrl).toBe('https://shop.example/api/licenses/revoked?seller=seller-id');
});
