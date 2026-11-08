import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../helpers/database-container';

const buyer = 'e1870000-0000-4000-a000-000000000001';
const product = 'e1870000-0000-4000-a000-000000000002';
const sub = 'e1870000-0000-4000-a000-000000000003';
const tx = 'e1870000-0000-4000-a000-000000000004';
function sql(body: string) {
  execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: `BEGIN;
    SET LOCAL request.jwt.claims='{"role":"service_role"}';
    INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${buyer}','final-buyer@example.com',now());
    INSERT INTO public.products(id,name,slug,price,currency,product_type,recurring_price,billing_interval,billing_interval_count)
      VALUES('${product}','Final purchase','final-purchase',10,'PLN','subscription',10,'month',1);
    INSERT INTO public.subscriptions(id,user_id,product_id,stripe_subscription_id,stripe_customer_id,status,current_period_end,cancel_at_period_end)
      VALUES('${sub}','${buyer}','${product}','sub_final187','cus_final187','active',now()+interval '30 days',true);
    INSERT INTO public.payment_transactions(id,user_id,product_id,subscription_id,session_id,customer_email,amount,currency,status)
      VALUES('${tx}','${buyer}','${product}','${sub}','in_final187','FINAL-BUYER@EXAMPLE.COM',1000,'PLN','completed');
    ${body} ROLLBACK;`, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
}
const check = (condition: string) => `DO $$ BEGIN IF (${condition}) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Purchase state differs'; END IF; END $$;`;
it('ends a fully refunded subscription and retains the end through subsequent updates', () => {
  expect(() => sql(`UPDATE public.payment_transactions SET status='refunded',refunded_amount=1000 WHERE id='${tx}';
    UPDATE public.subscriptions SET status='active',cancel_at_period_end=true,current_period_end=now()+interval '30 days' WHERE id='${sub}';
    ${check(`(SELECT status='canceled' AND cancel_at_period_end=false AND paid_access_expires_at IS NULL AND current_period_end IS NULL FROM public.subscriptions WHERE id='${sub}')`)}
  `)).not.toThrow();
});
it('keeps a partially refunded subscription active', () => {
  expect(() => sql(`UPDATE public.payment_transactions SET status='partially_refunded',refunded_amount=100 WHERE id='${tx}';
    ${check(`(SELECT status='active' AND current_period_end>now() FROM public.subscriptions WHERE id='${sub}')`)}
  `)).not.toThrow();
});
it('normalizes purchase email before persistence', () => {
  expect(() => sql(check(`(SELECT customer_email='final-buyer@example.com' FROM public.payment_transactions WHERE id='${tx}')`))).not.toThrow();
});

it('keeps a refunded subscription inactive when an access update arrives later', () => {
  expect(() => sql(`UPDATE public.payment_transactions SET status='refunded',refunded_amount=1000 WHERE id='${tx}';
    INSERT INTO public.user_product_access(user_id,product_id,subscription_id,access_expires_at)
      VALUES('${buyer}','${product}','${sub}',NULL);
    ${check(`NOT EXISTS(SELECT 1 FROM public.user_product_access WHERE subscription_id='${sub}' AND (access_expires_at IS NULL OR access_expires_at>now()))`)}
  `)).not.toThrow();
});
