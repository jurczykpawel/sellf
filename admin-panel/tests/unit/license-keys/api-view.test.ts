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
