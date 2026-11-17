import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../helpers/database-container';

const sql = (body: string) => execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { input: `BEGIN; ${body} ROLLBACK;`, encoding: 'utf8' });
const check = (condition: string) => `IF (${condition}) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Delivery target contract failed'; END IF;`;

it('retains URL history and closes old scheduled deliveries across changes', () => {
  expect(sql(`DO $$ DECLARE e uuid; d uuid; changed timestamptz; BEGIN
    INSERT INTO public.webhook_endpoints(url,secret,events) VALUES('https://example.com/one','test',ARRAY['test.event']) RETURNING id INTO e;
    INSERT INTO public.webhook_logs(endpoint_id,event_type,payload,status,next_retry_at,created_at)
      VALUES(e,'test.event','{}','pending_retry',now(),clock_timestamp()-interval '1 hour') RETURNING id INTO d;
    UPDATE public.webhook_endpoints SET url='https://example.com/two' WHERE id=e;
    ${check(`SELECT status='permanently_failed' AND next_retry_at IS NULL AND error_message='Endpoint URL changed' FROM public.webhook_logs WHERE id=d`)}
    SELECT url_changed_at INTO changed FROM public.webhook_endpoints WHERE id=e;
    ${check('changed IS NOT NULL')}
    ${check(`NOT EXISTS(SELECT 1 FROM public.webhook_delivery_target(d))`)}
    BEGIN
      UPDATE public.webhook_logs SET status='pending_retry',next_retry_at=now() WHERE id=d;
      RAISE EXCEPTION 'Old delivery accepted';
    EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
    UPDATE public.webhook_endpoints SET url=url,url_changed_at=NULL WHERE id=e;
    ${check(`SELECT url_changed_at=changed FROM public.webhook_endpoints WHERE id=e`)}
    UPDATE public.webhook_endpoints SET url='https://example.com/one' WHERE id=e;
    ${check(`NOT EXISTS(SELECT 1 FROM public.webhook_delivery_target(d))`)}
    INSERT INTO public.webhook_logs(endpoint_id,event_type,payload,status,created_at)
      VALUES(e,'test.event','{}','permanently_failed',clock_timestamp()) RETURNING id INTO d;
    UPDATE public.webhook_logs SET status='pending_retry',attempt_count=0,next_retry_at=now() WHERE id=d;
    ${check(`SELECT count(*)=1 FROM public.webhook_delivery_target(d)`)}
    ${check(`NOT has_function_privilege('anon','public.webhook_delivery_target(uuid)','EXECUTE')`)}
    ${check(`NOT has_function_privilege('authenticated','public.webhook_delivery_target(uuid)','EXECUTE')`)}
    END $$; SELECT 'passed';`)).toContain('passed');
});

it('keeps the original business event date when its delivery is prepared later', () => {
  expect(sql(`DO $$ DECLARE e uuid; b uuid; d uuid := gen_random_uuid(); BEGIN
    INSERT INTO public.webhook_endpoints(url,secret,events) VALUES('https://example.com/one','test',ARRAY['access.granted']) RETURNING id INTO e;
    INSERT INTO public.business_events(event_type,payload,deduplication_key,created_at)
      VALUES('access.granted','{}',gen_random_uuid()::text,clock_timestamp()-interval '1 hour') RETURNING id INTO b;
    UPDATE public.webhook_endpoints SET url='https://example.com/two' WHERE id=e;
    PERFORM public.enqueue_webhook_delivery(d,e,'access.granted','{}',e||':access.granted:business_'||b);
    ${check(`SELECT status='permanently_failed' AND error_message='Endpoint URL changed' FROM public.webhook_logs WHERE id=d`)}
    ${check(`NOT EXISTS(SELECT 1 FROM public.webhook_delivery_target(d))`)}
    END $$; SELECT 'passed';`)).toContain('passed');
});
