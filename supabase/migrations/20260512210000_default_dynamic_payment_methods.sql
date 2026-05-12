-- Default to Stripe Dynamic Payment Methods for Checkout Sessions Elements.
--
-- This preserves explicit admin customizations. It only migrates the previous
-- seeded default row that forced BLIK -> P24 -> card in code.

UPDATE seller_main.payment_method_config
SET
  config_mode = 'automatic',
  custom_payment_methods = '[]'::jsonb,
  payment_method_order = '[]'::jsonb,
  updated_at = NOW()
WHERE id = 1
  AND config_mode = 'custom'
  AND custom_payment_methods = '[
    {"type": "blik", "enabled": true, "display_order": 0, "currency_restrictions": ["PLN"], "label": "BLIK"},
    {"type": "p24", "enabled": true, "display_order": 1, "currency_restrictions": ["PLN", "EUR"], "label": "Przelewy24"},
    {"type": "card", "enabled": true, "display_order": 2, "currency_restrictions": [], "label": "Card"}
  ]'::jsonb
  AND payment_method_order = '["blik", "p24", "card"]'::jsonb;
