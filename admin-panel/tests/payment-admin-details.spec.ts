/** Order context shown to the seller on the real local stack. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { loginAsAdmin, supabaseAdmin as db } from './helpers/admin-auth';
import pl from '@/messages/pl.json';

async function checked<T>({ data, error }: { data: T; error: unknown }): Promise<NonNullable<T>> { if (error) throw error; return data!; }
const now = new Date().toISOString();
let partnerUser: string, productId: string, txId: string, order: number, member: string, coupon: string, rule: string, binding: string, commission: string;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  const product = await checked(await db.from('products').insert({ name: 'Details workshop', slug: `details-${randomUUID()}`, price: 100, currency: 'PLN', is_active: true, event_mode: true }).select('id').single()); productId = product.id;
  const session = await checked(await db.from('product_sessions').insert({ product_id: productId, title: 'November workshop', starts_at: '2099-11-19T16:00:00Z', ends_at: '2099-11-19T18:00:00Z', timezone: 'Europe/Warsaw', venue: 'Workshop room', online_url: 'https://example.com/join' }).select('id').single());
  const tier = await checked(await db.from('product_price_tiers').insert({ session_id: session.id, label: 'Early seats', price: 100, sort: 0 }).select('id').single());
  const tx = await checked(await db.from('payment_transactions').insert({ product_id: productId, customer_email: 'details@example.com', amount: 10000, currency: 'PLN', status: 'cancelled', payment_provider: 'bank_transfer', pricing_snapshot_version: 1, invoice_hold_at: now }).select('id,order_number').single()); txId = tx.id; order = tx.order_number!;
  const line = await checked(await db.from('payment_line_items').insert({ transaction_id: txId, product_id: productId, item_type: 'main_product', product_name: 'Details workshop', quantity: 2, unit_price: 50, session_id: session.id, tier_id: tier.id, session_label: 'November workshop', session_starts_at:'2099-11-19T16:00:00Z', total_price: 100, discounted_total: 100, currency: 'PLN' }).select('id').single());
  await checked(await db.from('seat_reservations').insert({ transaction_id: txId, session_id: session.id, tier_id: tier.id, quantity: 2, status: 'released', released_at: now }).select());
  const created = await db.auth.admin.createUser({ email: `details-partner-${randomUUID()}@example.com`, email_confirm:true }); if (created.error) throw created.error; partnerUser=created.data.user.id;
  member = (await checked(await db.from('affiliate_memberships').insert({ user_id: partnerUser, code: `details-${randomUUID().slice(0,8)}`, display_name: 'Workshop partner', status: 'approved', accepted_terms_version: '1', accepted_at: now }).select('id').single())).id;
  coupon = (await checked(await db.from('coupons').insert({ code: `DETAILS${randomUUID().slice(0,8)}`, discount_type: 'percentage', discount_value: 10 }).select('id').single())).id;
  rule = (await checked(await db.from('affiliate_rules').insert({ product_id: productId, revision: 1, enabled: true, percentage_bps: 1500 }).select('id').single())).id;
  binding = (await checked(await db.from('affiliate_coupon_bindings').insert({ coupon_id: coupon, member_id: member, version: 1 }).select('id').single())).id;
  commission = (await checked(await db.from('affiliate_commissions').insert({ payment_id: txId, line_item_id: line.id, member_id: member, rule_id: rule, binding_id: binding, livemode: false, session_created_at: now, paid_at: now, currency: 'PLN', base_minor: 10000, accrued_minor: 1500, self_referral: false, is_refundable: false, hold_days: 0, buffer_days: 0, eligible_at: '2020-01-01', observed_refunded_gross: 0, observed_status: 'cancelled' }).select('id').single())).id;
  await checked(await db.from('affiliate_ledger').insert({ member_id: member, commission_id: commission, kind: 'accrual', amount_minor: 1500, currency: 'PLN', economic_key: `details-${randomUUID()}` }).select());
});
test.afterAll(async () => {
  if (commission) { await db.from('affiliate_ledger').delete().eq('commission_id',commission); await db.from('affiliate_commissions').delete().eq('id',commission); }
  if (binding) await db.from('affiliate_coupon_bindings').delete().eq('id',binding);
  if (rule) await db.from('affiliate_rules').delete().eq('id',rule);
  if (member) { await db.from('affiliate_membership_events').delete().eq('member_id',member); await db.from('affiliate_memberships').delete().eq('id',member); }
  if (partnerUser) await db.auth.admin.deleteUser(partnerUser);
  if (coupon) await db.from('coupons').delete().eq('id',coupon);
  if (txId) { await db.from('invoices').delete().eq('transaction_id',txId); await db.from('seat_reservations').delete().eq('transaction_id',txId); await db.from('payment_line_items').delete().eq('transaction_id',txId); await db.from('payment_transactions').delete().eq('id',txId); }
  if (productId) await db.from('products').delete().eq('id',productId);
});
test('seller sees partner, reserved session, purchase time and manual correction @J191 @J185', async ({ page }) => {
  await loginAsAdmin(page,'demo@sellf.app','demo123');
  await page.goto(`/pl/dashboard/payments?order=${order}`);
  const dialog = page.getByRole('dialog', { name: 'Szczegóły transakcji' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Data i godzina zakupu')).toBeVisible();
  const partner = dialog.getByRole('region',{ name: 'Partner',exact:true });
  await expect(partner.getByText('Workshop partner')).toBeVisible();
  await expect(partner.getByText('15%')).toBeVisible();
  await expect(partner.getByText('Naliczona',{exact:true})).toBeVisible();
  const event = dialog.getByRole('region',{ name: 'Wydarzenie',exact:true });
  await expect(event.getByText('Workshop room')).toBeVisible();
  await expect(event.getByText(/Early seats/)).toBeVisible();
  await expect(event.getByText(/Europe\/Warsaw/)).toBeVisible();
  await expect(event.getByText('Zwolniona',{exact:true})).toBeVisible();
  await expect(event.getByRole('link')).toHaveAttribute('href','https://example.com/join');
  await expect(dialog.getByRole('link',{ name: pl.admin.payments.transactions.issueLicense })).toHaveCount(0);
  const invoice = dialog.getByRole('region',{ name: 'Faktury',exact:true });
  await expect(invoice.getByText(pl.invoicing.manualCorrectionHelp)).toBeVisible();
  await invoice.getByRole('button',{ name: pl.invoicing.correct,exact:true }).click();
  await expect(dialog).not.toBeVisible();
  await page.goto(`/pl/dashboard/payments?order=${order}`);
  await expect(page.getByRole('region',{name:'Faktury',exact:true}).getByText(pl.invoicing.corrected,{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:pl.bankTransfer.acceptLate,exact:true})).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath('payment-details.png'),fullPage:true});
});

test('license action follows product configuration and opens the specific issued license @J191', async ({ page }) => {
  await checked(await db.from('products').update({ issue_license_on_purchase: true, license_tier: 'business' }).eq('id',productId).select());
  await loginAsAdmin(page,'demo@sellf.app','demo123');
  await page.goto(`/pl/dashboard/payments?order=${order}`);
  await expect(page.getByRole('link',{name:pl.admin.payments.transactions.issueLicense,exact:true})).toBeVisible();
  const admin = await checked(await db.from('admin_users').select('user_id').limit(1).single());
  const license = await checked(await db.from('issued_licenses').insert({ product_id: productId, seller_id: admin.user_id, original_seller_id: admin.user_id, email: 'details@example.com', order_id: txId, kid: 'details-fixture', license_key: 'fixture', issuance_source: 'purchase' }).select('id').single());
  try {
    await page.reload();
    const link = page.getByRole('link',{name:pl.admin.payments.transactions.licenseIssued,exact:true});
    await expect(link).toHaveAttribute('href',`/dashboard/licenses?license=${license.id}`);
    await expect(page.getByRole('link',{name:pl.admin.payments.transactions.issueLicense,exact:true})).toHaveCount(0);
    const response = await page.request.get(`/api/admin/licenses?licenseId=${license.id}`);
    expect(response.status()).toBe(200);
    const data = await response.json(); expect(data.licenses).toHaveLength(1); expect(data.licenses[0].id).toBe(license.id);
  } finally { await db.from('issued_licenses').delete().eq('id',license.id); }
});
