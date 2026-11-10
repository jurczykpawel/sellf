/** Product lifecycle contract at the transactional source of all product writes. */
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { WEBHOOK_MOCK_PAYLOADS } from '@/lib/webhooks/mock-payloads';
import { getTestDatabaseContainer } from '../helpers/database-container';

function sql(body: string): string {
  return execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], {
    input: `BEGIN; ${body} ROLLBACK;`, encoding: 'utf8',
  });
}
const assert = (condition: string, message: string) => `DO $$ BEGIN IF (${condition}) IS DISTINCT FROM true THEN RAISE EXCEPTION '${message}'; END IF; END $$;`;
const events = `(SELECT count(*) FROM public.business_events WHERE product_id=p.id AND event_type IN ('product.created','product.updated','product.deleted'))`;

it.each([
  ['ordinary', 'one_time', false, false, false, 15],
  ['subscription', 'subscription', false, false, false, 15],
  ['bundle', 'one_time', true, false, false, 15],
  ['event', 'one_time', false, true, false, 15],
  ['free', 'one_time', false, false, false, 0],
  ['pwyw', 'one_time', false, false, true, 15],
] as const)('%s has one public snapshot per CRUD mutation and none for internal/no-op writes', (kind, type, bundle, event, pwyw, price) => {
  const output = sql(`
    CREATE TEMP TABLE p AS SELECT gen_random_uuid() AS id;
    INSERT INTO public.products(id,name,slug,price,currency,product_type,is_bundle,event_mode,allow_custom_price,billing_interval,billing_interval_count,recurring_price,content_config)
      SELECT id,'Lifecycle ${kind}','w216-'||id,${price},'PLN','${type}',${bundle},${event},${pwyw},'month',1,15,'{"secret":"paid-content"}' FROM p;
    ${assert(`SELECT ${events}=1 FROM p`, 'created must be recorded once')}
    ${assert(`(SELECT payload->'product'->>'price'='${price * 100}' AND payload->>'amountUnit'='minor'
      AND payload->>'revision'='1' AND payload->'product'->>'productType'='${type}'
      AND payload->'product'->>'isBundle'='${bundle}' AND payload->'product'->>'eventMode'='${event}'
      AND payload->'product'->>'allowCustomPrice'='${pwyw}'
      FROM public.business_events,p WHERE product_id=p.id AND event_type='product.created')`, 'created snapshot contract')}
    UPDATE public.products SET name=name,updated_at=clock_timestamp(),stripe_product_id='internal',content_config='{"secret":"new-paid-content"}' WHERE id=(SELECT id FROM p);
    ${assert(`SELECT ${events}=1 FROM p`, 'no event for unchanged public fields')}
    UPDATE public.products SET name='Changed ${kind}',price=21.35,is_listed=false WHERE id=(SELECT id FROM p);
    ${assert(`SELECT ${events}=2 FROM p`, 'one updated event for a multi-field save')}
    ${assert(`(SELECT payload->'changedFields'='["isListed","name","price"]'::jsonb AND payload->>'revision'='2'
      AND payload->'product'->>'name'='Changed ${kind}' AND payload->'product'->>'price'='2135'
      FROM public.business_events,p WHERE product_id=p.id AND event_type='product.updated')`, 'updated public fields and revision')}
    SAVEPOINT cancelled;
    UPDATE public.products SET name='Rolled back' WHERE id=(SELECT id FROM p);
    ROLLBACK TO cancelled;
    ${assert(`SELECT ${events}=2 FROM p`, 'rollback leaves no event')}
    DELETE FROM public.products WHERE id=(SELECT id FROM p);
    ${assert(`SELECT ${events}=3 FROM p`, 'deleted must be recorded once')}
    ${assert(`(SELECT payload->>'revision'='3' AND payload->'product'->>'name'='Changed ${kind}'
      AND payload->'product'->>'price'='2135' AND payload->'product'->>'isActive'='true'
      FROM public.business_events,p WHERE product_id=p.id AND event_type='product.deleted')`, 'deleted retains pre-delete snapshot')}
    ${assert(`NOT EXISTS(SELECT 1 FROM public.business_events,p WHERE product_id=p.id
      AND event_type IN ('product.created','product.updated','product.deleted') AND payload::text LIKE '%paid-content%')`, 'snapshot excludes protected content')}
    ${assert(`(SELECT count(DISTINCT deduplication_key)=3 FROM public.business_events,p WHERE product_id=p.id
      AND event_type IN ('product.created','product.updated','product.deleted'))`, 'stable distinct mutation keys')}
    SELECT 'contract passed';`);
  expect(output).toContain('contract passed');
});

it('uses currency precision, database-owned revisions and an immutable deletion routing snapshot', () => {
  expect(sql(`
    CREATE TEMP TABLE p AS SELECT gen_random_uuid() AS id;
    CREATE TEMP TABLE e AS SELECT gen_random_uuid() AS id;
    INSERT INTO public.products(id,name,slug,price,currency,webhook_revision)
      SELECT id,'Precision','w216-'||id,123,'JPY',999 FROM p;
    ${assert(`(SELECT webhook_revision=1 FROM public.products,p WHERE products.id=p.id)`, 'insert revision belongs to database')}
    INSERT INTO public.webhook_endpoints(id,url,secret,events,product_filter_mode)
      SELECT id,'https://example.com/w216','local-test-secret',ARRAY['product.deleted'],'selected' FROM e;
    INSERT INTO public.webhook_endpoint_products SELECT e.id,p.id,now() FROM e,p;
    UPDATE public.products SET price=1.23,currency='PLN',webhook_revision=999 WHERE id=(SELECT id FROM p);
    ${assert(`(SELECT payload->'product'->>'price'='123' AND payload->>'revision'='2' FROM public.business_events,p
      WHERE product_id=p.id AND event_type='product.updated')`, 'PLN has two decimal places')}
    ${assert(`(SELECT payload->'product'->>'price'='123' FROM public.business_events,p
      WHERE product_id=p.id AND event_type='product.created')`, 'JPY has no fractional unit and created snapshot stays unchanged')}
    DELETE FROM public.products WHERE id=(SELECT id FROM p);
    ${assert(`(SELECT count(*)=0 FROM public.webhook_endpoint_products,p WHERE product_id=p.id)`, 'real delete cascade ran')}
    ${assert(`(SELECT payload->'_selectedEndpointIds'=jsonb_build_array(e.id) FROM public.business_events,p,e
      WHERE product_id=p.id AND event_type='product.deleted')`, 'delete keeps selected endpoints')}
    INSERT INTO public.business_events(event_type,product_id,payload,deduplication_key)
      SELECT event_type,product_id,payload,deduplication_key FROM public.business_events,p
      WHERE product_id=p.id AND event_type='product.deleted' ON CONFLICT(deduplication_key) DO NOTHING;
    ${assert(`SELECT ${events}=3 FROM p`, 'duplicate mutation key is ignored')}
    SELECT 'contract passed';`)).toContain('contract passed');
});

it('keeps outbox and snapshot helpers private', () => {
  expect(sql(`
    SET LOCAL ROLE anon;
    ${assert(`NOT has_function_privilege(current_user,'public.product_catalogue_snapshot(public.products)','EXECUTE')`, 'anon snapshot denied')}
    ${assert(`NOT has_table_privilege(current_user,'public.business_events','SELECT')`, 'anon outbox denied')}
    RESET ROLE;
    SET LOCAL ROLE authenticated;
    ${assert(`NOT has_function_privilege(current_user,'public.capture_product_lifecycle_event()','EXECUTE')`, 'buyer trigger denied')}
    ${assert(`NOT has_function_privilege(current_user,'public.set_product_webhook_revision()','EXECUTE')`, 'buyer revision denied')}
    SELECT 'contract passed';`)).toContain('contract passed');
});

it('dashboard examples expose exactly the public database snapshot fields', () => {
  const output = sql(`
    CREATE TEMP TABLE p AS SELECT gen_random_uuid() AS id;
    INSERT INTO public.products(id,name,slug,price,currency) SELECT id,'Preview','w216-'||id,12.34,'PLN' FROM p;
    SELECT payload FROM public.business_events,p WHERE product_id=p.id AND event_type='product.created';`);
  const payload = JSON.parse(output.split('\n').find(line => line.startsWith('{'))!);
  for (const event of ['product.created', 'product.updated', 'product.deleted']) {
    expect(Object.keys(WEBHOOK_MOCK_PAYLOADS[event].product).sort()).toEqual(Object.keys(payload.product).sort());
  }
  expect(payload.product).not.toHaveProperty('content_config');
  expect(payload.product).not.toHaveProperty('license_key');
  expect(payload).not.toHaveProperty('customer');
});
