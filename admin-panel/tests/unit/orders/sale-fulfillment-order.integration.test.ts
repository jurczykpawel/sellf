/** Sale counters follow product identity regardless of cart insertion order. */
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../../helpers/database-container';
it('updates sale counters in product order @J34', () => {
  const low = 'e2971000-0000-4000-a000-000000000001', high = 'e2971000-0000-4000-a000-000000000002';
  const tx = 'e2971000-0000-4000-a000-000000000003';
  const sql = `BEGIN; SET LOCAL request.jwt.claims='{"role":"service_role"}';
    CREATE TEMP TABLE sale_trace(position serial, product_id uuid);
    CREATE FUNCTION pg_temp.trace_sale() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN
      INSERT INTO pg_temp.sale_trace(product_id) VALUES(NEW.id); RETURN NULL; END $body$;
    CREATE TRIGGER trace_sale AFTER UPDATE OF sale_quantity_sold ON public.products FOR EACH ROW
      WHEN (NEW.sale_quantity_sold IS DISTINCT FROM OLD.sale_quantity_sold) EXECUTE FUNCTION pg_temp.trace_sale();
    INSERT INTO public.products(id,name,slug,price,currency,sale_price) VALUES
      ('${low}','First course','sale-order-first',40,'PLN',20),('${high}','Second course','sale-order-second',40,'PLN',20);
    INSERT INTO public.payment_transactions(id,product_id,customer_email,session_id,amount,currency,status,pricing_snapshot_version)
      VALUES('${tx}','${low}','sale-order@example.com','cs_sale_order',4000,'PLN','completed',1);
    INSERT INTO public.payment_line_items(transaction_id,product_id,item_type,quantity,unit_price,total_price,currency) VALUES
      ('${tx}','${high}','order_bump',1,20,20,'PLN'),('${tx}','${low}','main_product',1,20,20,'PLN');
    SELECT public._order_grant_and_record('${tx}',NULL,NULL,NULL,NULL,'none');
    DO $test$ BEGIN
      IF (SELECT array_agg(product_id ORDER BY position) FROM pg_temp.sale_trace) IS DISTINCT FROM ARRAY['${low}'::uuid,'${high}'::uuid]
        THEN RAISE EXCEPTION 'Sale counter order differs'; END IF;
    END $test$; ROLLBACK;`;
  expect(() => execFileSync('docker', ['exec','-i',getTestDatabaseContainer(),'psql','-X','-U','postgres','-v','ON_ERROR_STOP=1'], {
    input: sql, encoding: 'utf8', stdio: ['pipe','pipe','pipe'],
  })).not.toThrow();
});
