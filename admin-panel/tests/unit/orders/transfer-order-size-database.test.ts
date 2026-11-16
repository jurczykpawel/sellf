/**
 * DB TEST: transferOrderPayloadByteLength measures the order payload exactly as place_order does after
 * bank_transfer_order enriched it. A payload the helper puts at the limit is placed; one byte more is
 * refused by place_order. Runs in one transaction that is rolled back.
 *
 * REQUIRES: the local Supabase stack (direct SQL through the database container).
 * @see admin-panel/src/lib/checkout-modules/order-details.ts
 * @see admin-panel/src/app/api/orders/bank-transfer/route.ts
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ORDER_PAYLOAD_MAX_BYTES, transferOrderPayloadByteLength } from '@/lib/checkout-modules/order-details';
import { getTestDatabaseContainer } from '../../helpers/database-container';

const plainProduct = crypto.randomUUID();
const eventProduct = crypto.randomUUID();
const eventSession = crypto.randomUUID();
const profile = '{"v":1,"modules":[{"id":"buyer","types":["organization"],"gus":false,"bank_transfer_for":["organization"]}]}';

/** An order the route would send, padded so the enriched payload has exactly `target` bytes. */
function paddedOrder(productId: string, email: string, target: number, context: { grantAccessOnPlacement: boolean; eventMode: boolean }) {
  const build = (pad: string) => ({
    product_id: productId, currency: 'PLN', customer_email: email, user_id: null, terms_required: true,
    order_details: { v: 1, buyer: { type: 'organization', company_name: 'Zażółć gęślą jaźń', terms_accepted: true }, pad },
    custom_field_values: {}, coupon_id: null,
    metadata: { event_ip: '203.0.113.7', locale: 'pl', attribution_ref: crypto.randomUUID() },
  });
  const base = transferOrderPayloadByteLength(build(''), context);
  const order = build('x'.repeat(target - base));
  expect(transferOrderPayloadByteLength(order, context)).toBe(target);
  return JSON.stringify(order);
}

const line = (productId: string, session?: string) => JSON.stringify([{
  product_id: productId, item_type: 'main_product', quantity: 1, unit_price: 47, total_price: 47, discounted_total: 47, currency: 'PLN',
  ...(session ? { session_id: session } : {}),
}]);

function placementCase(label: string, order: string, lines: string, refused: boolean): string {
  return `
  BEGIN
    PERFORM public.bank_transfer_order($order$${order}$order$::jsonb, $lines$${lines}$lines$::jsonb);
    ${refused ? `RAISE EXCEPTION '${label}: placed over the limit';` : ''}
  EXCEPTION WHEN invalid_parameter_value THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF ${refused ? 'msg <> \'Invalid order payload\'' : 'true'} THEN RAISE EXCEPTION '${label}: %', msg; END IF;
  END;`;
}

describe('transfer order payload size', () => {
  it('matches place_order to the byte, with and without an event, access on placement on and off', () => {
    const plain = { grantAccessOnPlacement: true, eventMode: false };
    const event = { grantAccessOnPlacement: false, eventMode: true };
    const sql = `BEGIN;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
UPDATE public.bank_transfer_config SET bank_transfer_enabled=true, bank_account_holder='Example', bank_account_number='PL61109010140000071219812874',
  bank_transfer_max_unpaid_per_email=10, reservation_enabled=false;
INSERT INTO public.products(id,name,slug,price,currency,checkout_profile) VALUES ('${plainProduct}','Size plain','size-plain-${plainProduct}',47,'PLN','${profile}');
INSERT INTO public.products(id,name,slug,price,currency,event_mode,checkout_profile) VALUES ('${eventProduct}','Size event','size-event-${eventProduct}',47,'PLN',true,'${profile}');
INSERT INTO public.product_sessions(id,product_id,starts_at,capacity) VALUES ('${eventSession}','${eventProduct}','2099-01-01',50);
INSERT INTO public.product_price_tiers(session_id,price,seats,sort) VALUES ('${eventSession}',47,50,0);
DO $test$
DECLARE msg text;
BEGIN
  UPDATE public.bank_transfer_config SET bank_transfer_grant_access_on_placement=true;
  ${placementCase('plain at limit', paddedOrder(plainProduct, 'size-a@example.com', ORDER_PAYLOAD_MAX_BYTES, plain), line(plainProduct), false)}
  ${placementCase('plain over limit', paddedOrder(plainProduct, 'size-b@example.com', ORDER_PAYLOAD_MAX_BYTES + 1, plain), line(plainProduct), true)}
  IF (SELECT count(*) FROM public.payment_transactions WHERE product_id='${plainProduct}') <> 1 THEN RAISE EXCEPTION 'plain: expected one placed order'; END IF;
  UPDATE public.bank_transfer_config SET bank_transfer_grant_access_on_placement=false;
  ${placementCase('event at limit', paddedOrder(eventProduct, 'size-c@example.com', ORDER_PAYLOAD_MAX_BYTES, event), line(eventProduct, eventSession), false)}
  ${placementCase('event over limit', paddedOrder(eventProduct, 'size-d@example.com', ORDER_PAYLOAD_MAX_BYTES + 1, event), line(eventProduct, eventSession), true)}
  IF (SELECT count(*) FROM public.payment_transactions WHERE product_id='${eventProduct}') <> 1 THEN RAISE EXCEPTION 'event: expected one placed order'; END IF;
END $test$;
ROLLBACK;
`;
    const output = execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
      input: sql, encoding: 'utf8',
    });
    expect(output).toContain('ROLLBACK');
  });
});
