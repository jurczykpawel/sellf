/**
 * Purchase attribution snapshot + report, measured in the database the seller reads.
 * @see supabase/migrations/20261103120000_purchase_attribution.sql
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../../helpers/database-container';
import { collectAttribution } from '@/lib/attribution/collect';

const product = 'a1310000-0000-4000-a000-000000000001';
const buyer = 'a1310000-0000-4000-a000-000000000002';
const sub = 'a1310000-0000-4000-a000-000000000003';
const member = 'a1310000-0000-4000-a000-000000000004';
const coupon = 'a1310000-0000-4000-a000-000000000005';

const email = (campaign: string, content = 'cta-1') => JSON.stringify({
  v: 1, consent: 'analytics', mode: 'stored', sessions_count: 3, first_seen_at: new Date(Date.now() - 4 * 86400_000).toISOString(),
  first: { source: 'facebook', medium: 'paid_social', campaign: 'autumn', referrer_host: null, landing_path: '/' },
  last: { source: 'listmonk', medium: 'email', campaign, content, referrer_host: null, landing_path: '/offer' },
  click: { type: 'fbclid', value: 'IwAR-secret' }, device_class: 'mobile', country: 'PL',
});

function sql(body: string): string {
  const script = `BEGIN;
    SET LOCAL request.jwt.claims='{"role":"service_role"}';
    INSERT INTO public.products(id,name,slug,price,currency) VALUES('${product}','Attribution contract','attribution-contract',100,'PLN');
    INSERT INTO auth.users(id,email) VALUES('${buyer}','attribution-contract@example.com');
    ${body}
    ROLLBACK;`;
  return execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
    { input: script, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}
const assert = (condition: string, message: string) =>
  `DO $t$ BEGIN IF (${condition}) IS DISTINCT FROM true THEN RAISE EXCEPTION '${message}'; END IF; END $t$;`;
const pending = (ref: string, payload: string) =>
  `SELECT public.store_checkout_attribution('${ref}', '${payload}'::jsonb);`;
const paid = (id: string, session: string, amount = 10000, extra = '') =>
  `INSERT INTO public.payment_transactions(id,product_id,user_id,customer_email,session_id,amount,currency,status${extra ? ',' + extra.split('=')[0] : ''})
   VALUES('${id}','${product}','${buyer}','attribution-contract@example.com','${session}',${amount},'PLN','completed'${extra ? ',' + extra.split('=').slice(1).join('=') : ''});`;

describe('purchase attribution snapshot', () => {
  it('freezes last and first touch, channel, device and country at purchase; click id survives only with consent', () => {
    expect(() => sql(`${pending('cs_test_attr1', email('mail-05'))}
      ${paid('a1310000-0000-4000-a000-0000000000a1', 'cs_test_attr1')}
      ${assert(`(SELECT channel='email' AND first_channel='paid_social' AND last_source='listmonk' AND last_campaign='mail-05'
        AND first_source='facebook' AND sessions_count=3 AND device_class='mobile' AND country='PL' AND kind='payment'
        AND click_id IS NULL AND click_id_type IS NULL FROM public.purchase_attribution WHERE transaction_id='a1310000-0000-4000-a000-0000000000a1')`,
        'snapshot must hold the email last touch and paid-social first touch; analytics consent never keeps a click id')}
    `)).not.toThrow();
  });

  it('is immutable: the source of an order cannot be edited later', () => {
    expect(() => sql(`${pending('cs_test_attr2', email('mail-05'))}
      ${paid('a1310000-0000-4000-a000-0000000000a2', 'cs_test_attr2')}
      UPDATE public.purchase_attribution SET last_source='facebook' WHERE transaction_id='a1310000-0000-4000-a000-0000000000a2';`))
      .toThrow(/immutable/);
  });

  it('records an order without collected data as unknown, and a bank transfer by its order reference', () => {
    expect(() => sql(`${paid('a1310000-0000-4000-a000-0000000000a3', 'cs_test_attr_none')}
      ${pending('a1310000-0000-4000-a000-0000000000f1', JSON.stringify({ v: 1, consent: 'none', mode: 'url', last: { source: 'google', medium: 'cpc' } }))}
      INSERT INTO public.payment_transactions(id,product_id,customer_email,amount,currency,status,payment_provider,pricing_snapshot_version,metadata)
        VALUES('a1310000-0000-4000-a000-0000000000a4','${product}','attribution-contract@example.com',10000,'PLN','awaiting_payment','bank_transfer',1,
        '{"sf_attr_ref":"a1310000-0000-4000-a000-0000000000f1"}');
      ${assert(`(SELECT channel='unknown' FROM public.purchase_attribution WHERE transaction_id='a1310000-0000-4000-a000-0000000000a3')`, 'no data must be unknown')}
      ${assert(`(SELECT channel='paid_search' AND kind='bank_transfer' FROM public.purchase_attribution WHERE transaction_id='a1310000-0000-4000-a000-0000000000a4')`, 'transfer must be paid_search')}
    `)).not.toThrow();
  });

  it('attributes a subscription and its renewals to the source of the first checkout @J173', () => {
    expect(() => sql(`${pending('cs_test_sub1', email('mail-07'))}
      INSERT INTO public.subscriptions(id,user_id,product_id,stripe_customer_id,stripe_subscription_id,status,metadata)
        VALUES('${sub}','${buyer}','${product}','cus_attr','sub_attr1','active','{"sf_attr_ref":"cs_test_sub1"}');
      ${paid('a1310000-0000-4000-a000-0000000000b1', 'in_attr1', 5000, `subscription_id,stripe_invoice_id='${sub}','in_attr1'`)}
      ${paid('a1310000-0000-4000-a000-0000000000b2', 'in_attr2', 5000, `subscription_id,stripe_invoice_id='${sub}','in_attr2'`)}
      ${assert(`(SELECT count(*)=2 AND bool_and(last_campaign='mail-07') AND count(*) FILTER (WHERE kind='renewal')=1
        FROM public.purchase_attribution WHERE transaction_id IN ('a1310000-0000-4000-a000-0000000000b1','a1310000-0000-4000-a000-0000000000b2'))`,
        'renewal must inherit the first checkout source')}
    `)).not.toThrow();
  });

  it('classifies a partner coupon as affiliate and honours the seller rules', () => {
    expect(() => sql(`
      INSERT INTO public.coupons(id,code,discount_type,discount_value,currency) VALUES('${coupon}','ATTRPARTNER131','percentage',10,NULL);
      INSERT INTO public.affiliate_memberships(id,user_id,code,status,display_name,accepted_terms_version,accepted_at) VALUES('${member}','${buyer}','anna','approved','Anna','v1',now());
      INSERT INTO public.affiliate_coupon_bindings(coupon_id,member_id,version) VALUES('${coupon}','${member}',1);
      ${pending('cs_test_aff', email('mail-05'))}
      ${paid('a1310000-0000-4000-a000-0000000000c1', 'cs_test_aff', 9000, `coupon_id='${coupon}'`)}
      ${assert(`(SELECT channel='affiliate' AND affiliate_member_id='${member}' FROM public.purchase_attribution WHERE transaction_id='a1310000-0000-4000-a000-0000000000c1')`, 'partner coupon must win')}
      INSERT INTO public.attribution_channel_rules(priority,channel,field,operator,value) VALUES(1,'newsletter_wir','source','in','listmonk');
      ${pending('cs_test_rule', email('mail-06'))}
      ${paid('a1310000-0000-4000-a000-0000000000c2', 'cs_test_rule')}
      ${assert(`(SELECT channel='newsletter_wir' FROM public.purchase_attribution WHERE transaction_id='a1310000-0000-4000-a000-0000000000c2')`, 'seller rule must win over defaults')}
    `)).not.toThrow();
  });

  it('keeps a click id with marketing consent only for the configured retention', () => {
    const marketing = email('mail-05').replace('"consent":"analytics"', '"consent":"marketing"');
    expect(() => sql(`UPDATE public.attribution_settings SET click_id_retention_days=7;
      ${pending('cs_test_click', marketing)}
      ${paid('a1310000-0000-4000-a000-0000000000d1', 'cs_test_click')}
      ${assert(`(SELECT click_id='IwAR-secret' AND click_id_type='fbclid' AND click_id_expires_at BETWEEN now()+interval '6 days' AND now()+interval '8 days'
        FROM public.purchase_attribution WHERE transaction_id='a1310000-0000-4000-a000-0000000000d1')`, 'click id kept 7 days')}
      UPDATE public.purchase_attribution SET click_id_expires_at=now()-interval '1 minute' WHERE transaction_id='a1310000-0000-4000-a000-0000000000d1';
      SELECT public.purge_attribution_click_ids();
      ${assert(`(SELECT click_id IS NULL AND click_id_type='fbclid' FROM public.purchase_attribution WHERE transaction_id='a1310000-0000-4000-a000-0000000000d1')`, 'expired click id purged, type kept')}
    `)).not.toThrow();
  });

  it('lets the seller set click-id retention and replace own channel rules; defaults can only be switched off', () => {
    expect(() => sql(`INSERT INTO public.admin_users(user_id) VALUES('${buyer}');
      SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${buyer}"}';
      SET LOCAL role authenticated;
      SELECT public.save_attribution_config(14, jsonb_build_array(
        jsonb_build_object('priority',5,'channel','podcast','field','source','operator','in','value','spotify,apple','is_active',true),
        jsonb_build_object('id',(SELECT id::text FROM public.attribution_channel_rules WHERE is_default AND channel='email' AND field='medium'),'is_active',false)));
      RESET role;
      SET LOCAL request.jwt.claims='{"role":"service_role"}';
      ${assert(`(SELECT click_id_retention_days=14 FROM public.attribution_settings)`, 'retention saved')}
      ${assert(`(SELECT public.classify_attribution_channel('spotify',NULL,NULL,NULL,NULL)='podcast')`, 'custom rule active')}
      ${assert(`(SELECT NOT is_active FROM public.attribution_channel_rules WHERE is_default AND channel='email' AND field='medium')`, 'default switched off')}
      ${assert(`(SELECT count(*)=11 FROM public.attribution_channel_rules WHERE is_default)`, 'defaults kept')}
      ${assert(`EXISTS(SELECT 1 FROM public.admin_actions WHERE action='save_attribution_config')`, 'audited')}
    `)).not.toThrow();
    expect(() => sql(`SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${buyer}"}'; SET LOCAL role authenticated;
      SELECT public.save_attribution_config(14, '[]'::jsonb);`)).toThrow(/Not authorized/);
  });

  it('turns a guest free signup source into a free-access snapshot when the magic link is used', () => {
    expect(() => sql(`${pending('free:attribution-contract:abc', email('lm-2'))}
      SELECT public.record_free_attribution_from_ref('${product}', '${buyer}', 'free:attribution-contract:abc');
      ${assert(`(SELECT kind='free' AND channel='email' AND last_campaign='lm-2' FROM public.purchase_attribution WHERE product_id='${product}' AND user_id='${buyer}')`, 'free snapshot')}
      ${assert(`NOT EXISTS(SELECT 1 FROM public.checkout_attribution WHERE ref='free:attribution-contract:abc')`, 'pending consumed')}
    `)).not.toThrow();
  });
});

describe('attribution report', () => {
  it('reports every dimension from one touch: last = the email visit, first = the paid search visit (W147-6)', () => {
    const t0 = Date.now() - 3 * 86400_000;
    const ad = collectAttribution({ href: 'https://shop.example/?utm_source=google&utm_medium=cpc&utm_campaign=w153first&gclid=CjwKCAiA',
      referrer: '', now: t0, consent: 'marketing', stored: null });
    const mail = collectAttribution({ href: 'https://shop.example/offer?utm_source=w153last&utm_medium=email&utm_campaign=emb-last',
      referrer: '', now: t0 + 86400_000, consent: 'marketing', stored: ad.store });
    const out = sql(`DELETE FROM public.purchase_attribution;
      ${pending('cs_test_touch', JSON.stringify(mail.payload))} ${paid('a1310000-0000-4000-a000-0000000000f9', 'cs_test_touch', 4000)}
      SELECT public.get_attribution_report(now()-interval '3 days', now()+interval '1 minute', 'last', ARRAY['channel','source','medium','campaign'])::text;
      SELECT public.get_attribution_report(now()-interval '3 days', now()+interval '1 minute', 'first', ARRAY['channel','source','medium','campaign'])::text;`);
    const [last, first] = out.trim().split('\n').filter(l => l.startsWith('[')).map(l => JSON.parse(l));
    expect(last).toEqual([expect.objectContaining({ channel: 'email', source: 'w153last', medium: 'email', campaign: 'emb-last', orders: 1 })]);
    expect(first).toEqual([expect.objectContaining({ channel: 'paid_search', source: 'google', medium: 'cpc', campaign: 'w153first', orders: 1 })]);
  });

  it('answers "where did the last 3 days of purchases come from" with net revenue and no personal data @J173', () => {
    const out = sql(`DELETE FROM public.purchase_attribution;
      ${pending('cs_test_r1', email('mail-05'))} ${paid('a1310000-0000-4000-a000-0000000000e1', 'cs_test_r1', 10000)}
      ${pending('cs_test_r2', email('mail-05'))} ${paid('a1310000-0000-4000-a000-0000000000e2', 'cs_test_r2', 10000)}
      UPDATE public.payment_transactions SET status='partially_refunded', refunded_amount=2500 WHERE id='a1310000-0000-4000-a000-0000000000e2';
      ${pending('cs_test_r3', email('mail-05'))} ${paid('a1310000-0000-4000-a000-0000000000e3', 'cs_test_r3', 10000)}
      UPDATE public.payment_transactions SET status='disputed' WHERE id='a1310000-0000-4000-a000-0000000000e3';
      ${pending('cs_test_r4', JSON.stringify({ v: 1, consent: 'none', mode: 'url', last: { landing_path: '/offer' } }))}
      ${paid('a1310000-0000-4000-a000-0000000000e4', 'cs_test_r4', 4000)}
      SELECT public.record_free_attribution('${product}', '${buyer}', '${email('lm-1')}'::jsonb);
      SELECT public.get_attribution_report(now()-interval '3 days', now()+interval '1 minute', 'last', ARRAY['channel','source','medium','campaign','content'])::text;`);
    const rows = JSON.parse(out.split('\n').find(line => line.startsWith('['))!) as Array<Record<string, unknown>>;
    const mail = rows.find(r => r.campaign === 'mail-05');
    expect(mail).toMatchObject({ channel: 'email', source: 'listmonk', medium: 'email', content: 'cta-1', currency: 'PLN', orders: 3, gross: 300, refunded: 125, net: 175 });
    expect(rows.find(r => r.channel === 'direct')).toMatchObject({ orders: 1, net: 40 });
    expect(rows.find(r => r.campaign === 'lm-1')).toMatchObject({ orders: 1, free_orders: 1, net: 0 });
    expect(JSON.stringify(rows)).not.toMatch(/attribution-contract@example.com|IwAR|a1310000/);
  });
});
