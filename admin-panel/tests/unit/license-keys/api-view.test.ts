/** License API view of a license whose product was permanently deleted. @see src/lib/license-keys/api-view.ts */
import { expect, it } from 'vitest';
import { LICENSE_API_FIELDS, toLicenseApiView, type LicenseApiRow } from '@/lib/license-keys/api-view';

const row: LicenseApiRow = {
  id: 'lic', product_id: null, product_name: 'Archived course', email: 'b@example.com', order_id: 'ord', kid: 'k',
  issued_at: '2026-11-01T00:00:00Z', expires_at: null, revoked_at: null, revoked_by_dispute_id: null,
  issuance_source: 'purchase', license_domain: null, original_seller_id: 'seller', products: null,
};

it('selects the purchase-time product name', () => {
  expect(LICENSE_API_FIELDS.split(/,\s*/)).toContain('product_name');
});

it('names the product from the purchase-time copy after a permanent delete', () => {
  expect(toLicenseApiView(row, 'https://shop.example').product).toEqual({ name: 'Archived course', slug: null });
  expect(toLicenseApiView(row, 'https://shop.example').productId).toBeNull();
});

const token = (tier: string | null) => `${Buffer.from(JSON.stringify({ v: 1, kid: 'k', product: 'course', email: 'b@example.com', order: 'ord', tier, iat: 1, exp: null })).toString('base64url')}.stored-signature`;
it.each(['pro', null])('keeps the issued tier %s after deleting the product', tier => {
  expect(toLicenseApiView({ ...row, license_key: token(tier) }, 'https://shop.example').tier).toBe(tier);
});
it('keeps the issued tier when the product tier is edited', () => {
  expect(toLicenseApiView({ ...row, products: { name: 'Course', slug: 'course', license_tier: 'new-tier' }, license_key: token('original') }, 'https://shop.example').tier).toBe('original');
});
it('selects the stored token for list views without returning it by default', () => {
  expect(LICENSE_API_FIELDS.split(/,\s*/)).toContain('license_key');
  expect(toLicenseApiView({ ...row, license_key: token('pro') }, 'https://shop.example')).not.toHaveProperty('token');
});
