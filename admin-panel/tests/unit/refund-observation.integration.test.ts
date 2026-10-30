/** Observe each recorded processor refund independently and retain notification progress. */
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import full from '../fixtures/stripe/refund_list_full.json';
import pending from '../fixtures/stripe/refund_pending.json';
import partial from '../fixtures/stripe/refund_list_partial.json';
import { deriveDeliveryReference } from '@/lib/services/webhook-service';
import { getTestDatabaseContainer } from '../helpers/database-container';

it('records one issuance and one version per actual processor-status transition @J35', () => {
  const refund = full.data[0];
  const sql = `BEGIN;
    INSERT INTO public.products(id,name,slug,price,currency) VALUES
      ('e5100000-0000-4000-a000-000000000001','Refund observation','refund-observation',11,'PLN');
    INSERT INTO public.payment_transactions(id,product_id,customer_email,session_id,amount,currency,status) VALUES
      ('e5100000-0000-4000-a000-000000000002','e5100000-0000-4000-a000-000000000001','fixture@example.com','pi_refund_observation',${refund.amount},'PLN','completed');
    DO $test$ DECLARE r record; BEGIN
      SELECT * INTO r FROM public.observe_payment_refund('e5100000-0000-4000-a000-000000000002','${pending.id}',${pending.amount},'${pending.currency}','${pending.status}');
      IF r.refund_version<>1 OR r.previous_status IS NOT NULL OR r.notified_version<>0 THEN RAISE EXCEPTION 'Initial refund contract'; END IF;
      PERFORM public.confirm_refund_notification('${pending.id}',1);
      SELECT * INTO r FROM public.observe_payment_refund('e5100000-0000-4000-a000-000000000002','${pending.id}',${pending.amount},'${pending.currency}','${pending.status}');
      IF r.refund_version<>1 OR r.notified_version<>1 THEN RAISE EXCEPTION 'Duplicate changed version'; END IF;
      SELECT * INTO r FROM public.observe_payment_refund('e5100000-0000-4000-a000-000000000002','${pending.id}',${pending.amount},'${pending.currency}','${refund.status}');
      IF r.refund_version<>2 OR r.previous_status<>'pending' OR r.notified_version<>0 THEN RAISE EXCEPTION 'Status change contract'; END IF;
      SELECT * INTO r FROM public.observe_payment_refund('e5100000-0000-4000-a000-000000000002','${refund.id}',${refund.amount},'${refund.currency}','${refund.status}');
      IF r.refund_version<>1 THEN RAISE EXCEPTION 'A different refund must have its own issuance'; END IF;
    END $test$;
    DO $test$ DECLARE versions integer[]; r record; BEGIN
      SELECT array_agg(refund_version ORDER BY refund_version) INTO versions FROM public.observe_payment_refund(
        'e5100000-0000-4000-a000-000000000002','${partial.data[0].id}',${partial.data[0].amount},'${partial.data[0].currency}','${partial.data[0].status}','${pending.status}');
      IF versions<>ARRAY[1,2] THEN RAISE EXCEPTION 'Initial and current observations must both survive'; END IF;
      PERFORM public.confirm_refund_notification('${partial.data[0].id}',2);
      SELECT * INTO r FROM public.observe_payment_refund('e5100000-0000-4000-a000-000000000002','${partial.data[0].id}',${partial.data[0].amount},'${partial.data[0].currency}','${partial.data[0].status}');
      IF r.refund_version<>1 OR r.refund_status<>'pending' THEN RAISE EXCEPTION 'An older pending notification was lost'; END IF;
    END $test$;
    INSERT INTO public.webhook_endpoints(id,url,secret,events,is_active) VALUES
      ('e5100000-0000-4000-a000-000000000003','https://example.com/refund-contract','fixture-secret',ARRAY['refund.issued','refund.updated'],true);
    SELECT public.enqueue_webhook_delivery('e5100000-0000-4000-a000-000000000004','e5100000-0000-4000-a000-000000000003','refund.issued','{}',
      '${deriveDeliveryReference('refund.issued', { refund: { stripeRefundId: refund.id, statusVersion: 1 } })}',5);
    SELECT public.enqueue_webhook_delivery('e5100000-0000-4000-a000-000000000005','e5100000-0000-4000-a000-000000000003','refund.issued','{}',
      '${deriveDeliveryReference('refund.issued', { refund: { stripeRefundId: refund.id, statusVersion: 1 } })}',5);
    DO $test$ BEGIN
      IF (SELECT count(*) FROM public.webhook_logs WHERE endpoint_id='e5100000-0000-4000-a000-000000000003')<>1 THEN RAISE EXCEPTION 'A refund was enqueued twice'; END IF;
    END $test$;
    SET LOCAL ROLE authenticated;
    DO $test$ BEGIN
      IF has_function_privilege(current_user,'public.observe_payment_refund(uuid,text,integer,text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Unexpected refund function privilege'; END IF;
      IF has_table_privilege(current_user,'public.payment_refunds','SELECT') THEN RAISE EXCEPTION 'Unexpected refund table privilege'; END IF;
    END $test$;
    ROLLBACK;`;
  expect(() => execFileSync('docker', ['exec','-i',getTestDatabaseContainer(),'psql','-U','postgres','-v','ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' })).not.toThrow();
});
