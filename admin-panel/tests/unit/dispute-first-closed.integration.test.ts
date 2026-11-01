/** A closing outcome can arrive before the opening notification. */
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import won from '../fixtures/stripe/charge_dispute_closed_won.json';
import { getTestDatabaseContainer } from '../helpers/database-container';
it('keeps an already active entitlement and reports no restoration when won arrives first', () => {
 const d=won.data.object;
 const sql=`BEGIN; SET LOCAL request.jwt.claims='{"role":"service_role"}';
 INSERT INTO public.products(id,name,slug,price,currency) VALUES('e1171000-0000-4000-a000-000000000001','Closing first','closing-first',11,'PLN');
 INSERT INTO auth.users(id,email) VALUES('e1171000-0000-4000-a000-000000000002','closing-first@example.com');
 INSERT INTO public.payment_transactions(id,product_id,user_id,customer_email,session_id,amount,currency,status)
 VALUES('e1171000-0000-4000-a000-000000000003','e1171000-0000-4000-a000-000000000001','e1171000-0000-4000-a000-000000000002','closing-first@example.com','pi_closing_first',1100,'PLN','completed');
 INSERT INTO public.user_product_access(user_id,product_id) VALUES('e1171000-0000-4000-a000-000000000002','e1171000-0000-4000-a000-000000000001');
 SELECT public.apply_payment_dispute('e1171000-0000-4000-a000-000000000003','${d.id}','${d.status}',true,'${d.reason}',${d.amount},'${d.currency}',to_timestamp(${d.created}));
 DO $test$ BEGIN
 IF (SELECT (payload->'dispute'->>'accessRestored')::boolean FROM public.payment_disputes WHERE stripe_dispute_id='${d.id}') THEN RAISE EXCEPTION 'Already active access was not restored'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id='e1171000-0000-4000-a000-000000000002' AND access_expires_at IS NULL) THEN RAISE EXCEPTION 'Active access changed'; END IF;
 END $test$; ROLLBACK;`;
 expect(()=>execFileSync('docker',['exec','-i',getTestDatabaseContainer(),'psql','-U','postgres','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',stdio:['pipe','pipe','pipe']})).not.toThrow();
});
