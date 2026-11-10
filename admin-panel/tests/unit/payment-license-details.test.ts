import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ allowed: true, tx: {} as unknown, licenses: [] as unknown[], reads: [] as string[] }));
vi.mock('@/lib/actions/admin-auth', () => ({ withAdminClient: async (fn: (ctx: unknown) => unknown) => m.allowed ? fn({ dataClient: { from(table: string) {
 m.reads.push(table); const q = { select: () => q, eq: () => q, ilike: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: table === 'payment_transactions' ? m.tx : m.licenses[0] ?? null, error: null }) }; return q;
} } }) : { success: false } }));
import { getPaymentLicenseDetails } from '@/lib/actions/payment-details';
const id = '00000000-0000-4000-8000-000000000001';
beforeEach(() => { m.allowed = true; m.reads = []; m.licenses = []; m.tx = { product_id: id, customer_email: 'buyer@example.com', product: { issue_license_on_purchase: true } }; });
it('offers issuance only for an enabled product with an email', async () => { expect((await getPaymentLicenseDetails(id)).data).toMatchObject({ licenseId: null, productId: id, email: 'buyer@example.com' }); });
it('links to an existing license for the product instead of issuing again', async () => { m.licenses = [{ id: 'license' }]; expect((await getPaymentLicenseDetails(id)).data?.licenseId).toBe('license'); });
it('hides issuance for products without licenses', async () => { m.tx = { product: { issue_license_on_purchase: false } }; expect((await getPaymentLicenseDetails(id)).data).toBeNull(); expect(m.reads).not.toContain('issued_licenses'); });
it('requires admin', async () => { m.allowed = false; expect((await getPaymentLicenseDetails(id)).success).toBe(false); expect(m.reads).toEqual([]); });
