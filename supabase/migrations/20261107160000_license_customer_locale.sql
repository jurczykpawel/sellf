ALTER TABLE public.issued_licenses ADD COLUMN customer_locale text CHECK (customer_locale IN ('pl','en'));

CREATE OR REPLACE FUNCTION public.license_event_snapshot(p_license public.issued_licenses) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE claims jsonb; encoded text; tier text; product jsonb; tx record;
BEGIN
  BEGIN
    encoded:=translate(split_part(p_license.license_key,'.',1),'-_','+/');
    encoded:=encoded||repeat('=',(4-length(encoded)%4)%4);
    claims:=convert_from(decode(encoded,'base64'),'UTF8')::jsonb;
    tier:=CASE WHEN jsonb_typeof(claims->'tier')='string' THEN claims->>'tier' ELSE NULL END;
  EXCEPTION WHEN OTHERS THEN tier:=NULL;
  END;
  SELECT jsonb_build_object('name',p.name,'slug',p.slug,'license_tier',tier) INTO product
    FROM public.products p WHERE p.id=p_license.product_id;
  -- order_id is the payment intent, checkout session, renewal invoice or offline order id.
  SELECT t.id,t.order_number INTO tx FROM public.payment_transactions t
    WHERE t.stripe_payment_intent_id=p_license.order_id OR t.session_id=p_license.order_id
      OR t.stripe_invoice_id=p_license.order_id OR t.id::text=p_license.order_id
    ORDER BY (t.product_id=p_license.product_id) DESC,t.created_at LIMIT 1;
  RETURN jsonb_build_object('id',p_license.id,'product_id',p_license.product_id,'email',p_license.email,'user_id',p_license.user_id,
    'order_id',p_license.order_id,'seller_id',p_license.seller_id,'original_seller_id',p_license.original_seller_id,
    'license_domain',p_license.license_domain,'issuance_source',p_license.issuance_source,
    'issued_at',p_license.issued_at,'expires_at',p_license.expires_at,'revoked_at',p_license.revoked_at,'products',product,
    'customer_locale',p_license.customer_locale,'sellf_order_id',tx.id,'order_number',tx.order_number,
    'revocation_reason',CASE WHEN p_license.revoked_at IS NULL THEN NULL
      WHEN p_license.revoked_by_dispute_id IS NOT NULL THEN 'dispute'
      ELSE p_license.revocation_reason END);
END $$;
