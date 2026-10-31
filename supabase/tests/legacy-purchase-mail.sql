BEGIN;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$
DECLARE p uuid; first_order uuid; second_order uuid;
BEGIN
  INSERT INTO public.products(name,slug,price,currency) VALUES('Recorded course','legacy-mail-course',10,'USD') RETURNING id INTO p;
  INSERT INTO public.payment_transactions(product_id,customer_email,session_id,amount,currency,status)
    VALUES(p,'legacy-mail@example.com','cs_legacy_mail',1000,'USD','completed') RETURNING id INTO first_order;
  INSERT INTO public.payment_transactions(product_id,customer_email,session_id,amount,currency,status)
    VALUES(p,'legacy-mail@example.com','cs_other_mail',1000,'USD','completed') RETURNING id INTO second_order;
  INSERT INTO public.guest_purchases(product_id,customer_email,session_id,transaction_amount)
    VALUES(p,'legacy-mail@example.com','cs_legacy_mail',1000);
  ASSERT public.event_mail_access('legacy-mail@example.com',p,first_order), 'Historical guest purchase must compose its first email';
  ASSERT NOT public.event_mail_access('legacy-mail@example.com',p,second_order), 'A different order has no guest entitlement';
  ASSERT NOT public.event_mail_access('other-mail@example.com',p,first_order), 'The purchase belongs to its buyer';
  UPDATE public.guest_purchases SET transaction_id=first_order WHERE product_id=p;
  ASSERT public.event_mail_access('legacy-mail@example.com',p,first_order), 'Transaction-linked entitlement remains available';
  ASSERT NOT has_function_privilege('authenticated','public.event_mail_access(text,uuid,uuid)','execute');
END $$;
ROLLBACK;
