-- prepare_event_mail keeps every sender's fields at once and rejects malformed ones.
BEGIN;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$
DECLARE meta jsonb; token text := repeat('A',43);
BEGIN
  INSERT INTO auth.users(id,email,email_confirmed_at) VALUES (gen_random_uuid(),'mail-context@example.com',now());
  PERFORM public.prepare_event_mail('mail-context@example.com', jsonb_build_object(
    'locale','pl','mail_kind','transfer_placed','purchase_product','Warsztat','purchase_amount','123 zł',
    'pay_url','https://shop.example.com/pl/order/00000000-0000-4000-8000-000000000001/transfer?token=1700000000.'||token,
    'participants_url','https://shop.example.com/pl/order/00000000-0000-4000-8000-000000000001/participants?token=1700000000.'||token,
    'release_text','Termin','license_key','payload.signature','payment_received','true',
    'transfer',jsonb_build_object('holder','Sklep','account','PL61 1090 1014 0000 0712 1981 2874','bank','Bank','title','Zamówienie 1','amount','123 zł','due','10 grudnia 2026'),
    'event_date','10 gru','event_online_url','https://example.com/live'));
  SELECT raw_user_meta_data INTO meta FROM auth.users WHERE email='mail-context@example.com';
  IF NOT (meta ?& ARRAY['locale','mail_kind','purchase_product','purchase_amount','pay_url','participants_url','release_text','license_key','payment_received','transfer','event_date','event_online_url']) THEN
    RAISE EXCEPTION 'missing mail field: %', meta;
  END IF;
  IF meta#>>'{transfer,account}' <> 'PL61 1090 1014 0000 0712 1981 2874' THEN RAISE EXCEPTION 'transfer details'; END IF;
  -- A later call replaces the whole context instead of leaking the previous one.
  PERFORM public.prepare_event_mail('mail-context@example.com', jsonb_build_object('locale','en'));
  SELECT raw_user_meta_data INTO meta FROM auth.users WHERE email='mail-context@example.com';
  IF meta ?| ARRAY['transfer','license_key','payment_received','pay_url','mail_kind','purchase_product'] THEN RAISE EXCEPTION 'stale mail field: %', meta; END IF;
  BEGIN PERFORM public.prepare_event_mail('mail-context@example.com','{"locale":"en","transfer":{"holder":"x","evil":"y"}}'); RAISE EXCEPTION 'unknown transfer key accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.prepare_event_mail('mail-context@example.com','{"locale":"en","transfer":"text"}'); RAISE EXCEPTION 'non-object transfer accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.prepare_event_mail('mail-context@example.com','{"locale":"en","payment_received":"no"}'); RAISE EXCEPTION 'bad flag accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.prepare_event_mail('mail-context@example.com', jsonb_build_object('locale','en','license_key','a.'||repeat('k',4100))); RAISE EXCEPTION 'oversized key accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.prepare_event_mail('mail-context@example.com','{"locale":"en","license_key":"not a key"}'); RAISE EXCEPTION 'malformed key accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  IF has_function_privilege('anon','public.prepare_event_mail(text,jsonb)','execute') OR has_function_privilege('authenticated','public.prepare_event_mail(text,jsonb)','execute') THEN RAISE EXCEPTION 'public mail context'; END IF;
END $$;
ROLLBACK;
