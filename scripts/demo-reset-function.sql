-- =============================================================================
-- Sellf Demo Reset — RPC Function
-- =============================================================================
--
-- Creates a PostgreSQL function that resets the demo database to seed data.
-- No Supabase CLI or psql needed — called via REST API with service_role key.
--
-- SETUP (one-time):
--   1. Open Supabase Dashboard → SQL Editor
--   2. Paste this entire file and click "Run"
--
-- USAGE (from cron via demo-reset.sh):
--   curl -X POST "$SUPABASE_URL/rest/v1/rpc/demo_reset_data" \
--     -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
--     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
--     -H "Content-Type: application/json" -d '{}'
--

CREATE OR REPLACE FUNCTION public.demo_reset_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $func$
DECLARE
  r RECORD;
  demo_user_id UUID := 'dddddddd-0000-4000-a000-000000000000';
  user1_id UUID := 'aaaaaaaa-1111-4111-a111-111111111111';
  user2_id UUID := 'bbbbbbbb-2222-4222-a222-222222222222';
  user3_id UUID := 'cccccccc-3333-4333-a333-333333333333';
  user4_id UUID := 'f4f4f4f4-4444-4444-a444-444444444444';
  user5_id UUID := 'f5f5f5f5-5555-4555-a555-555555555555';
  user6_id UUID := 'f6f6f6f6-6666-4666-a666-666666666666';
  user7_id UUID := 'f7f7f7f7-7777-4777-a777-777777777777';
  user8_id UUID := 'f8f8f8f8-8888-4888-a888-888888888888';
  premium_product_id UUID;
  pro_toolkit_id UUID;
  vip_masterclass_id UUID;
BEGIN

  -- =========================================================
  -- STEP 1: TRUNCATE ALL DATA
  -- =========================================================

  -- Truncate all public tables dynamically
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
    EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' CASCADE';
  END LOOP;

  -- Truncate auth tables
  TRUNCATE auth.sessions CASCADE;
  TRUNCATE auth.refresh_tokens CASCADE;
  TRUNCATE auth.mfa_factors CASCADE;
  TRUNCATE auth.identities CASCADE;
  TRUNCATE auth.users CASCADE;

  -- =========================================================
  -- STEP 2: SEED — DEMO ADMIN USER
  -- =========================================================
  -- Credentials: demo@sellf.app / demo123

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    demo_user_id,
    'authenticated', 'authenticated',
    'demo@sellf.app',
    extensions.crypt('demo123', extensions.gen_salt('bf')),
    NOW(), '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Demo Admin"}'::jsonb,
    NOW(), NOW()
  );

  INSERT INTO auth.identities (
    provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) VALUES (
    demo_user_id::text, demo_user_id,
    jsonb_build_object('sub', demo_user_id::text, 'email', 'demo@sellf.app'),
    'email', NOW(), NOW(), NOW()
  );

  INSERT INTO admin_users (user_id) VALUES (demo_user_id) ON CONFLICT DO NOTHING;

  -- =========================================================
  -- STEP 3: SEED — SHOP CONFIG
  -- =========================================================

  INSERT INTO shop_config (
    default_currency, shop_name, logo_url,
    primary_color, secondary_color, accent_color,
    font_family, custom_settings
  ) VALUES (
    'USD', 'Sellf Demo Shop', NULL,
    '#9333ea', '#ec4899', '#8b5cf6',
    'system', '{}'::jsonb
  );

  -- =========================================================
  -- STEP 4: SEED — PRODUCTS
  -- =========================================================

  INSERT INTO products (
    name, slug, description, long_description, icon, image_url, thumbnail_url,
    price, currency, vat_rate, price_includes_vat, features,
    is_active, is_featured, auto_grant_duration_days,
    success_redirect_url, pass_params_to_redirect
  ) VALUES
  (
    'Free Tutorial', 'free-tutorial',
    'Free introductory tutorial - accessible to everyone.',
    'Complete introduction to our platform with step-by-step guidance. Perfect for beginners who want to get started quickly.',
    '📚', NULL, NULL,
    0, 'USD', 23.00, true,
    '[{"title": "What you''ll get", "items": ["30-minute video tutorial", "PDF guide", "Starter templates"]}]'::jsonb,
    true, true, NULL,
    '/checkout/premium-course', true
  ),
  (
    'Premium Course', 'premium-course',
    'Advanced JavaScript course with exclusive content.',
    E'## Master Modern JavaScript\n\nDeep dive into **modern JavaScript** with real-world projects. Learn advanced patterns, async programming, and build production-ready applications.\n\n### What makes this course special?\n\n- 🎯 **Project-based learning** - Build 3 real apps\n- 💡 **Advanced concepts** - Closures, async/await, modules\n- 🚀 **Production-ready** - Deploy to cloud platforms\n\n> "Best JavaScript course I''ve taken. The projects are incredibly practical!" - Sarah K.\n\n### Prerequisites\n\nBasic JavaScript knowledge required. Familiarity with HTML/CSS recommended.',
    '🚀', NULL, NULL,
    49.99, 'USD', 23.00, true,
    '[{"title": "Course content", "items": ["12 hours of video", "20+ coding exercises", "Final capstone project", "Certificate of completion"]}, {"title": "Bonuses", "items": ["Source code access", "Private Discord community", "Monthly live Q&A"]}]'::jsonb,
    true, true, NULL,
    NULL, false
  ),
  (
    'Pro Toolkit', 'pro-toolkit',
    'Professional development tools and templates.',
    'Complete collection of production-ready templates, UI components, and development tools to accelerate your workflow.',
    '🛠️', NULL, NULL,
    99.99, 'USD', 23.00, true,
    '[{"title": "What''s included", "items": ["50+ React components", "10 complete templates", "Figma design system", "VS Code snippets"]}, {"title": "Updates", "items": ["Lifetime access", "Free future updates", "Priority support"]}]'::jsonb,
    true, false, NULL,
    NULL, false
  ),
  (
    'VIP Masterclass', 'vip-masterclass',
    'Exclusive masterclass with live Q&A sessions.',
    'Join elite developers in this intensive 6-week program. Direct mentorship, code reviews, and career guidance from industry experts.',
    '👨‍🏫', NULL, NULL,
    199.99, 'USD', 23.00, true,
    '[{"title": "Program details", "items": ["6 live sessions (2h each)", "Personal code reviews", "Career coaching", "Small group (max 10 people)"]}, {"title": "Bonus access", "items": ["All course materials", "Pro toolkit included", "Alumni network", "Job board access"]}]'::jsonb,
    true, true, NULL,
    NULL, false
  ),
  (
    'Enterprise Package', 'enterprise-package',
    'Full enterprise solution with priority support.',
    'Complete white-label solution with dedicated support, custom integrations, and SLA guarantees for large organizations.',
    '🏢', NULL, NULL,
    499.99, 'USD', 23.00, true,
    '[{"title": "Enterprise features", "items": ["Unlimited team seats", "Custom branding", "SSO integration", "Dedicated account manager"]}, {"title": "Support & SLA", "items": ["24/7 priority support", "99.9% uptime guarantee", "Custom integrations", "Quarterly business reviews"]}]'::jsonb,
    true, false, 3,
    NULL, false
  );

  -- =========================================================
  -- STEP 5: SEED — ORDER BUMPS
  -- =========================================================

  INSERT INTO order_bumps (main_product_id, bump_product_id, bump_price, bump_title, bump_description, is_active)
  VALUES (
    (SELECT id FROM products WHERE slug = 'premium-course'),
    (SELECT id FROM products WHERE slug = 'pro-toolkit'),
    29.99,
    '🚀 Add the Pro Toolkit for just $29.99!',
    'Get professional development templates and tools worth $99.99. One-time offer!',
    true
  );

  INSERT INTO order_bumps (main_product_id, bump_product_id, bump_price, bump_title, bump_description, is_active, access_duration_days)
  VALUES (
    (SELECT id FROM products WHERE slug = 'vip-masterclass'),
    (SELECT id FROM products WHERE slug = 'enterprise-package'),
    199.99,
    '🏢 Upgrade to Enterprise Status',
    'Add priority support and full enterprise solutions. Save $300 instanly! (Special 7-day access)',
    true,
    7
  );

  -- =========================================================
  -- STEP 6: SEED — COUPONS
  -- =========================================================

  INSERT INTO coupons (code, name, discount_type, discount_value, usage_limit_global, is_active)
  VALUES ('WELCOME10', 'Welcome 10% Off', 'percentage', 10, 1000, true);

  INSERT INTO coupons (code, name, discount_type, discount_value, currency, is_active)
  VALUES ('SAVE50', '$50 Savings', 'fixed', 50, 'USD', true);

  INSERT INTO coupons (code, name, discount_type, discount_value, allowed_emails, is_active)
  VALUES ('EXCLUSIVE90', 'VIP 90% Discount', 'percentage', 90, '["vip@example.com", "admin@example.com"]'::jsonb, true);

  INSERT INTO coupons (code, name, discount_type, discount_value, allowed_product_ids, is_active)
  VALUES ('COURSE20', 'Course Special 20%', 'percentage', 20, (SELECT jsonb_build_array(id) FROM products WHERE slug = 'premium-course'), true);

  -- =========================================================
  -- STEP 7: SEED — WEBHOOKS
  -- =========================================================

  INSERT INTO webhook_endpoints (id, url, events, description, is_active, secret)
  VALUES (
    '88888888-8888-4888-a888-888888888888',
    'https://webhook.site/sellf-test-endpoint',
    ARRAY['purchase.completed', 'lead.captured'],
    'Zapier CRM Integration',
    true,
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
  );

  INSERT INTO webhook_logs (endpoint_id, event_type, payload, status, http_status, response_body, duration_ms, created_at)
  VALUES (
    '88888888-8888-4888-a888-888888888888',
    'purchase.completed',
    '{"event": "purchase.completed", "data": {"email": "success@example.com", "amount": 4900}}'::jsonb,
    'success', 200,
    '{"status": "ok", "message": "Received"}',
    150, NOW() - INTERVAL '1 hour'
  );

  INSERT INTO webhook_logs (endpoint_id, event_type, payload, status, http_status, response_body, error_message, duration_ms, created_at)
  VALUES (
    '88888888-8888-4888-a888-888888888888',
    'purchase.completed',
    '{"event": "purchase.completed", "data": {"email": "error@example.com", "amount": 9900}}'::jsonb,
    'failed', 500,
    'Internal Server Error',
    'HTTP 500', 2500, NOW() - INTERVAL '30 minutes'
  );

  INSERT INTO webhook_logs (endpoint_id, event_type, payload, status, http_status, response_body, error_message, duration_ms, created_at)
  VALUES (
    '88888888-8888-4888-a888-888888888888',
    'lead.captured',
    '{"event": "lead.captured", "data": {"email": "lead@example.com"}}'::jsonb,
    'failed', 0, NULL,
    'Request timed out (5s)', 5001, NOW() - INTERVAL '5 minutes'
  );

  -- =========================================================
  -- STEP 8: SEED — CATEGORIES & TAGS
  -- =========================================================

  INSERT INTO categories (name, slug, description) VALUES
  ('Courses', 'courses', 'Educational video courses and tutorials'),
  ('Tools', 'tools', 'Software tools and utilities'),
  ('Templates', 'templates', 'Ready-to-use templates for developers'),
  ('Bundles', 'bundles', 'Value packages with multiple products');

  INSERT INTO tags (name, slug) VALUES
  ('JavaScript', 'javascript'),
  ('React', 'react'),
  ('Bestseller', 'bestseller'),
  ('New', 'new'),
  ('Free', 'free');

  INSERT INTO product_categories (product_id, category_id) VALUES
  ((SELECT id FROM products WHERE slug = 'free-tutorial'), (SELECT id FROM categories WHERE slug = 'courses')),
  ((SELECT id FROM products WHERE slug = 'premium-course'), (SELECT id FROM categories WHERE slug = 'courses')),
  ((SELECT id FROM products WHERE slug = 'vip-masterclass'), (SELECT id FROM categories WHERE slug = 'courses')),
  ((SELECT id FROM products WHERE slug = 'pro-toolkit'), (SELECT id FROM categories WHERE slug = 'tools')),
  ((SELECT id FROM products WHERE slug = 'pro-toolkit'), (SELECT id FROM categories WHERE slug = 'templates')),
  ((SELECT id FROM products WHERE slug = 'enterprise-package'), (SELECT id FROM categories WHERE slug = 'bundles'));

  INSERT INTO product_tags (product_id, tag_id) VALUES
  ((SELECT id FROM products WHERE slug = 'free-tutorial'), (SELECT id FROM tags WHERE slug = 'free')),
  ((SELECT id FROM products WHERE slug = 'free-tutorial'), (SELECT id FROM tags WHERE slug = 'javascript')),
  ((SELECT id FROM products WHERE slug = 'premium-course'), (SELECT id FROM tags WHERE slug = 'javascript')),
  ((SELECT id FROM products WHERE slug = 'premium-course'), (SELECT id FROM tags WHERE slug = 'react')),
  ((SELECT id FROM products WHERE slug = 'premium-course'), (SELECT id FROM tags WHERE slug = 'bestseller')),
  ((SELECT id FROM products WHERE slug = 'pro-toolkit'), (SELECT id FROM tags WHERE slug = 'new')),
  ((SELECT id FROM products WHERE slug = 'vip-masterclass'), (SELECT id FROM tags WHERE slug = 'bestseller'));

  -- =========================================================
  -- STEP 9: SEED — SAMPLE USERS & TRANSACTIONS
  -- =========================================================
  -- 9 users total (demo admin + 8 customers)
  -- ~83 transactions over 30 days: EUR ~€4,500 + PLN ~PLN 24,000
  -- Amounts stored in cents (Stripe convention): 4999 = €49.99, 69999 = PLN 699.99
  -- Pattern: low base weeks 1-2, acceleration weeks 3-4, strong close

  -- User 1: john.doe@example.com (OTO test user, owns test-oto-target)
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', user1_id,
    'authenticated', 'authenticated', 'john.doe@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    NOW() - INTERVAL '28 days', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"John Doe"}'::jsonb,
    NOW() - INTERVAL '28 days', NOW() - INTERVAL '28 days'
  );
  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at) VALUES
  (user1_id::text, user1_id, jsonb_build_object('sub', user1_id::text, 'email', 'john.doe@example.com'),
   'email', NOW() - INTERVAL '28 days', NOW() - INTERVAL '28 days', NOW() - INTERVAL '28 days');

  -- User 2: maria.schmidt@example.com (EUR repeat buyer)
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', user2_id,
    'authenticated', 'authenticated', 'maria.schmidt@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    NOW() - INTERVAL '22 days', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Maria Schmidt"}'::jsonb,
    NOW() - INTERVAL '22 days', NOW() - INTERVAL '1 day'
  );
  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at) VALUES
  (user2_id::text, user2_id, jsonb_build_object('sub', user2_id::text, 'email', 'maria.schmidt@example.com'),
   'email', NOW() - INTERVAL '1 day', NOW() - INTERVAL '22 days', NOW() - INTERVAL '1 day');

  -- User 3: anna.kowalska@example.com (PLN repeat buyer)
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', user3_id,
    'authenticated', 'authenticated', 'anna.kowalska@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    NOW() - INTERVAL '25 days', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Anna Kowalska"}'::jsonb,
    NOW() - INTERVAL '25 days', NOW() - INTERVAL '3 hours'
  );
  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at) VALUES
  (user3_id::text, user3_id, jsonb_build_object('sub', user3_id::text, 'email', 'anna.kowalska@example.com'),
   'email', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '25 days', NOW() - INTERVAL '3 hours');

  -- User 4: james.wilson@example.com
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', user4_id,
    'authenticated', 'authenticated', 'james.wilson@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    NOW() - INTERVAL '23 days', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"James Wilson"}'::jsonb,
    NOW() - INTERVAL '23 days', NOW() - INTERVAL '5 days'
  );
  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at) VALUES
  (user4_id::text, user4_id, jsonb_build_object('sub', user4_id::text, 'email', 'james.wilson@example.com'),
   'email', NOW() - INTERVAL '5 days', NOW() - INTERVAL '23 days', NOW() - INTERVAL '5 days');

  -- User 5: sarah.jones@example.com
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', user5_id,
    'authenticated', 'authenticated', 'sarah.jones@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    NOW() - INTERVAL '20 days', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Sarah Jones"}'::jsonb,
    NOW() - INTERVAL '20 days', NOW() - INTERVAL '4 days'
  );
  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at) VALUES
  (user5_id::text, user5_id, jsonb_build_object('sub', user5_id::text, 'email', 'sarah.jones@example.com'),
   'email', NOW() - INTERVAL '4 days', NOW() - INTERVAL '20 days', NOW() - INTERVAL '4 days');

  -- User 6: carlos.garcia@example.com
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', user6_id,
    'authenticated', 'authenticated', 'carlos.garcia@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    NOW() - INTERVAL '18 days', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Carlos Garcia"}'::jsonb,
    NOW() - INTERVAL '18 days', NOW() - INTERVAL '2 days'
  );
  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at) VALUES
  (user6_id::text, user6_id, jsonb_build_object('sub', user6_id::text, 'email', 'carlos.garcia@example.com'),
   'email', NOW() - INTERVAL '2 days', NOW() - INTERVAL '18 days', NOW() - INTERVAL '2 days');

  -- User 7: emma.brown@example.com
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', user7_id,
    'authenticated', 'authenticated', 'emma.brown@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    NOW() - INTERVAL '14 days', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Emma Brown"}'::jsonb,
    NOW() - INTERVAL '14 days', NOW() - INTERVAL '6 days'
  );
  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at) VALUES
  (user7_id::text, user7_id, jsonb_build_object('sub', user7_id::text, 'email', 'emma.brown@example.com'),
   'email', NOW() - INTERVAL '6 days', NOW() - INTERVAL '14 days', NOW() - INTERVAL '6 days');

  -- User 8: luca.ferrari@example.com
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', user8_id,
    'authenticated', 'authenticated', 'luca.ferrari@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    NOW() - INTERVAL '11 days', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Luca Ferrari"}'::jsonb,
    NOW() - INTERVAL '11 days', NOW() - INTERVAL '3 days'
  );
  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at) VALUES
  (user8_id::text, user8_id, jsonb_build_object('sub', user8_id::text, 'email', 'luca.ferrari@example.com'),
   'email', NOW() - INTERVAL '3 days', NOW() - INTERVAL '11 days', NOW() - INTERVAL '3 days');

  -- Get product IDs for transactions
  SELECT id INTO premium_product_id FROM products WHERE slug = 'premium-course';
  SELECT id INTO pro_toolkit_id FROM products WHERE slug = 'pro-toolkit';
  SELECT id INTO vip_masterclass_id FROM products WHERE slug = 'vip-masterclass';

  -- -------------------------------------------------------
  -- PAYMENT TRANSACTIONS — EUR (~€4,500 over 30 days)
  -- Week 1-2: slow start | Week 3-4: acceleration | Today: strong close
  -- -------------------------------------------------------
  INSERT INTO payment_transactions (session_id, user_id, product_id, customer_email, amount, currency, status, stripe_payment_intent_id, created_at) VALUES
  ('cs_e01', NULL,     premium_product_id, 'b01@demo.test', 4999, 'EUR', 'completed', 'pi_e01', NOW() - INTERVAL '29 days'),
  ('cs_e02', NULL,     premium_product_id, 'b02@demo.test', 4999, 'EUR', 'completed', 'pi_e02', NOW() - INTERVAL '28 days'),
  ('cs_e03', NULL,     pro_toolkit_id,     'b03@demo.test', 9999, 'EUR', 'completed', 'pi_e03', NOW() - INTERVAL '26 days'),
  ('cs_e04', NULL,     premium_product_id, 'b04@demo.test', 4999, 'EUR', 'completed', 'pi_e04', NOW() - INTERVAL '24 days'),
  ('cs_e05', user4_id, pro_toolkit_id,     'james.wilson@example.com', 9999, 'EUR', 'completed', 'pi_e05', NOW() - INTERVAL '23 days'),
  ('cs_e06', NULL,     premium_product_id, 'b05@demo.test', 4999, 'EUR', 'completed', 'pi_e06', NOW() - INTERVAL '22 days'),
  ('cs_e07', user5_id, vip_masterclass_id, 'sarah.jones@example.com', 17999, 'EUR', 'completed', 'pi_e07', NOW() - INTERVAL '20 days'),
  ('cs_e08', NULL,     premium_product_id, 'b06@demo.test', 4999, 'EUR', 'completed', 'pi_e08', NOW() - INTERVAL '19 days'),
  ('cs_e09', NULL,     pro_toolkit_id,     'b07@demo.test', 9999, 'EUR', 'completed', 'pi_e09', NOW() - INTERVAL '18 days'),
  ('cs_e10', NULL,     premium_product_id, 'b08@demo.test', 4999, 'EUR', 'completed', 'pi_e10', NOW() - INTERVAL '17 days'),
  ('cs_e11', NULL,     vip_masterclass_id, 'b09@demo.test', 17999, 'EUR', 'completed', 'pi_e11', NOW() - INTERVAL '16 days'),
  ('cs_e12', NULL,     pro_toolkit_id,     'b10@demo.test', 9999, 'EUR', 'completed', 'pi_e12', NOW() - INTERVAL '15 days'),
  ('cs_e13', NULL,     premium_product_id, 'b11@demo.test', 4999, 'EUR', 'completed', 'pi_e13', NOW() - INTERVAL '14 days'),
  ('cs_e14', NULL,     vip_masterclass_id, 'b12@demo.test', 17999, 'EUR', 'completed', 'pi_e14', NOW() - INTERVAL '13 days'),
  ('cs_e15', NULL,     pro_toolkit_id,     'b13@demo.test', 9999, 'EUR', 'completed', 'pi_e15', NOW() - INTERVAL '12 days'),
  ('cs_e16', NULL,     vip_masterclass_id, 'b14@demo.test', 17999, 'EUR', 'completed', 'pi_e16', NOW() - INTERVAL '11 days'),
  ('cs_e17', user8_id, premium_product_id, 'luca.ferrari@example.com', 4999, 'EUR', 'completed', 'pi_e17', NOW() - INTERVAL '11 days'),
  ('cs_e18', NULL,     pro_toolkit_id,     'b15@demo.test', 9999, 'EUR', 'completed', 'pi_e18', NOW() - INTERVAL '10 days'),
  ('cs_e19', NULL,     vip_masterclass_id, 'b16@demo.test', 17999, 'EUR', 'completed', 'pi_e19', NOW() - INTERVAL '9 days'),
  ('cs_e20', NULL,     vip_masterclass_id, 'b17@demo.test', 17999, 'EUR', 'completed', 'pi_e20', NOW() - INTERVAL '8 days'),
  ('cs_e21', NULL,     pro_toolkit_id,     'b18@demo.test', 9999, 'EUR', 'completed', 'pi_e21', NOW() - INTERVAL '7 days'),
  ('cs_e22', NULL,     vip_masterclass_id, 'b19@demo.test', 17999, 'EUR', 'completed', 'pi_e22', NOW() - INTERVAL '7 days'),
  ('cs_e23', user2_id, premium_product_id, 'maria.schmidt@example.com', 4599, 'EUR', 'completed', 'pi_e23', NOW() - INTERVAL '6 days'),
  ('cs_e24', NULL,     pro_toolkit_id,     'b20@demo.test', 9999, 'EUR', 'completed', 'pi_e24', NOW() - INTERVAL '6 days'),
  ('cs_e25', NULL,     vip_masterclass_id, 'b21@demo.test', 17999, 'EUR', 'completed', 'pi_e25', NOW() - INTERVAL '5 days'),
  ('cs_e26', NULL,     pro_toolkit_id,     'b22@demo.test', 9999, 'EUR', 'completed', 'pi_e26', NOW() - INTERVAL '5 days'),
  ('cs_e27', user2_id, pro_toolkit_id,     'maria.schmidt@example.com', 8999, 'EUR', 'completed', 'pi_e27', NOW() - INTERVAL '4 days'),
  ('cs_e28', NULL,     pro_toolkit_id,     'b23@demo.test', 9999, 'EUR', 'completed', 'pi_e28', NOW() - INTERVAL '4 days'),
  ('cs_e29', NULL,     vip_masterclass_id, 'b24@demo.test', 17999, 'EUR', 'completed', 'pi_e29', NOW() - INTERVAL '4 days'),
  ('cs_e30', NULL,     vip_masterclass_id, 'b25@demo.test', 17999, 'EUR', 'completed', 'pi_e30', NOW() - INTERVAL '3 days'),
  ('cs_e31', NULL,     pro_toolkit_id,     'b26@demo.test', 9999, 'EUR', 'completed', 'pi_e31', NOW() - INTERVAL '3 days'),
  ('cs_e32', NULL,     vip_masterclass_id, 'b27@demo.test', 17999, 'EUR', 'completed', 'pi_e32', NOW() - INTERVAL '2 days'),
  ('cs_e33', NULL,     pro_toolkit_id,     'b28@demo.test', 9999, 'EUR', 'completed', 'pi_e33', NOW() - INTERVAL '2 days'),
  ('cs_e34', user2_id, vip_masterclass_id, 'maria.schmidt@example.com', 17999, 'EUR', 'completed', 'pi_e34', NOW() - INTERVAL '1 day'),
  ('cs_e35', NULL,     premium_product_id, 'b29@demo.test', 4999, 'EUR', 'completed', 'pi_e35', NOW() - INTERVAL '1 day'),
  ('cs_e36', NULL,     vip_masterclass_id, 'b30@demo.test', 17999, 'EUR', 'completed', 'pi_e36', NOW() - INTERVAL '1 day'),
  ('cs_e37', NULL,     vip_masterclass_id, 'b31@demo.test', 17999, 'EUR', 'completed', 'pi_e37', NOW() - INTERVAL '2 hours'),
  ('cs_e38', NULL,     pro_toolkit_id,     'b32@demo.test', 9999, 'EUR', 'completed', 'pi_e38', NOW() - INTERVAL '1 hour'),
  ('cs_e39', NULL,     vip_masterclass_id, 'b33@demo.test', 17999, 'EUR', 'completed', 'pi_e39', NOW() - INTERVAL '15 minutes');

  -- -------------------------------------------------------
  -- PAYMENT TRANSACTIONS — PLN (~PLN 24,000 over 30 days)
  -- Enterprise closes appear in final week for dramatic chart spike
  -- -------------------------------------------------------
  INSERT INTO payment_transactions (session_id, user_id, product_id, customer_email, amount, currency, status, stripe_payment_intent_id, created_at) VALUES
  ('cs_p01', NULL,     premium_product_id,  'k01@demo.test', 19999, 'PLN', 'completed', 'pi_p01', NOW() - INTERVAL '30 days'),
  ('cs_p02', NULL,     premium_product_id,  'k02@demo.test', 19999, 'PLN', 'completed', 'pi_p02', NOW() - INTERVAL '29 days'),
  ('cs_p03', NULL,     pro_toolkit_id,      'k03@demo.test', 39999, 'PLN', 'completed', 'pi_p03', NOW() - INTERVAL '27 days'),
  ('cs_p04', NULL,     premium_product_id,  'k04@demo.test', 19999, 'PLN', 'completed', 'pi_p04', NOW() - INTERVAL '25 days'),
  ('cs_p05', NULL,     pro_toolkit_id,      'k05@demo.test', 39999, 'PLN', 'completed', 'pi_p05', NOW() - INTERVAL '24 days'),
  ('cs_p06', NULL,     pro_toolkit_id,      'k06@demo.test', 39999, 'PLN', 'completed', 'pi_p06', NOW() - INTERVAL '22 days'),
  ('cs_p07', NULL,     premium_product_id,  'k07@demo.test', 19999, 'PLN', 'completed', 'pi_p07', NOW() - INTERVAL '21 days'),
  ('cs_p08', NULL,     vip_masterclass_id,  'k08@demo.test', 69999, 'PLN', 'completed', 'pi_p08', NOW() - INTERVAL '21 days'),
  ('cs_p09', NULL,     pro_toolkit_id,      'k09@demo.test', 39999, 'PLN', 'completed', 'pi_p09', NOW() - INTERVAL '20 days'),
  ('cs_p10', NULL,     vip_masterclass_id,  'k10@demo.test', 69999, 'PLN', 'completed', 'pi_p10', NOW() - INTERVAL '19 days'),
  ('cs_p11', NULL,     premium_product_id,  'k11@demo.test', 19999, 'PLN', 'completed', 'pi_p11', NOW() - INTERVAL '18 days'),
  ('cs_p12', user6_id, pro_toolkit_id,      'carlos.garcia@example.com', 39999, 'PLN', 'completed', 'pi_p12', NOW() - INTERVAL '18 days'),
  ('cs_p13', NULL,     vip_masterclass_id,  'k12@demo.test', 69999, 'PLN', 'completed', 'pi_p13', NOW() - INTERVAL '17 days'),
  ('cs_p14', NULL,     premium_product_id,  'k13@demo.test', 19999, 'PLN', 'completed', 'pi_p14', NOW() - INTERVAL '16 days'),
  ('cs_p15', NULL,     pro_toolkit_id,      'k14@demo.test', 39999, 'PLN', 'completed', 'pi_p15', NOW() - INTERVAL '16 days'),
  ('cs_p16', NULL,     vip_masterclass_id,  'k15@demo.test', 69999, 'PLN', 'completed', 'pi_p16', NOW() - INTERVAL '15 days'),
  ('cs_p17', NULL,     vip_masterclass_id,  'k16@demo.test', 69999, 'PLN', 'completed', 'pi_p17', NOW() - INTERVAL '14 days'),
  ('cs_p18', user7_id, pro_toolkit_id,      'emma.brown@example.com', 39999, 'PLN', 'completed', 'pi_p18', NOW() - INTERVAL '14 days'),
  ('cs_p19', NULL,     premium_product_id,  'k17@demo.test', 19999, 'PLN', 'completed', 'pi_p19', NOW() - INTERVAL '13 days'),
  ('cs_p20', NULL,     pro_toolkit_id,      'k18@demo.test', 39999, 'PLN', 'completed', 'pi_p20', NOW() - INTERVAL '13 days'),
  ('cs_p21', NULL,     vip_masterclass_id,  'k19@demo.test', 69999, 'PLN', 'completed', 'pi_p21', NOW() - INTERVAL '12 days'),
  ('cs_p22', NULL,     pro_toolkit_id,      'k20@demo.test', 39999, 'PLN', 'completed', 'pi_p22', NOW() - INTERVAL '11 days'),
  ('cs_p23', NULL,     vip_masterclass_id,  'k21@demo.test', 69999, 'PLN', 'completed', 'pi_p23', NOW() - INTERVAL '10 days'),
  ('cs_p24', NULL,     pro_toolkit_id,      'k22@demo.test', 39999, 'PLN', 'completed', 'pi_p24', NOW() - INTERVAL '9 days'),
  ('cs_p25', NULL,     vip_masterclass_id,  'k23@demo.test', 69999, 'PLN', 'completed', 'pi_p25', NOW() - INTERVAL '9 days'),
  ('cs_p26', user3_id, premium_product_id,  'anna.kowalska@example.com', 19999, 'PLN', 'completed', 'pi_p26', NOW() - INTERVAL '8 days'),
  ('cs_p27', NULL,     vip_masterclass_id,  'k24@demo.test', 69999, 'PLN', 'completed', 'pi_p27', NOW() - INTERVAL '8 days'),
  ('cs_p28', NULL,     pro_toolkit_id,      'k25@demo.test', 39999, 'PLN', 'completed', 'pi_p28', NOW() - INTERVAL '7 days'),
  ('cs_p29', NULL,     vip_masterclass_id,  'k26@demo.test', 69999, 'PLN', 'completed', 'pi_p29', NOW() - INTERVAL '7 days'),
  ('cs_p30', NULL,     vip_masterclass_id,  'k27@demo.test', 69999, 'PLN', 'completed', 'pi_p30', NOW() - INTERVAL '6 days'),
  ('cs_p31', NULL,     pro_toolkit_id,      'k28@demo.test', 39999, 'PLN', 'completed', 'pi_p31', NOW() - INTERVAL '5 days'),
  ('cs_p32', NULL,     vip_masterclass_id,  'k29@demo.test', 69999, 'PLN', 'completed', 'pi_p32', NOW() - INTERVAL '5 days'),
  ('cs_p33', NULL,     pro_toolkit_id,      'k30@demo.test', 39999, 'PLN', 'completed', 'pi_p33', NOW() - INTERVAL '4 days'),
  ('cs_p34', NULL,     vip_masterclass_id,  'k31@demo.test', 69999, 'PLN', 'completed', 'pi_p34', NOW() - INTERVAL '4 days'),
  ('cs_p35', user3_id, pro_toolkit_id,      'anna.kowalska@example.com', 39999, 'PLN', 'completed', 'pi_p35', NOW() - INTERVAL '3 days'),
  ('cs_p36', NULL,     vip_masterclass_id,  'k32@demo.test', 69999, 'PLN', 'completed', 'pi_p36', NOW() - INTERVAL '3 days'),
  ('cs_p37', NULL,     (SELECT id FROM products WHERE slug = 'enterprise-package'), 'k33@demo.test', 179999, 'PLN', 'completed', 'pi_p37', NOW() - INTERVAL '3 days'),
  ('cs_p38', NULL,     pro_toolkit_id,      'k34@demo.test', 39999, 'PLN', 'completed', 'pi_p38', NOW() - INTERVAL '2 days'),
  ('cs_p39', NULL,     vip_masterclass_id,  'k35@demo.test', 69999, 'PLN', 'completed', 'pi_p39', NOW() - INTERVAL '2 days'),
  ('cs_p40', NULL,     pro_toolkit_id,      'k36@demo.test', 39999, 'PLN', 'completed', 'pi_p40', NOW() - INTERVAL '1 day'),
  ('cs_p41', NULL,     vip_masterclass_id,  'k37@demo.test', 69999, 'PLN', 'completed', 'pi_p41', NOW() - INTERVAL '1 day'),
  ('cs_p42', user3_id, vip_masterclass_id,  'anna.kowalska@example.com', 69999, 'PLN', 'completed', 'pi_p42', NOW() - INTERVAL '3 hours'),
  ('cs_p43', NULL,     pro_toolkit_id,      'k38@demo.test', 39999, 'PLN', 'completed', 'pi_p43', NOW() - INTERVAL '90 minutes'),
  ('cs_p44', NULL,     (SELECT id FROM products WHERE slug = 'enterprise-package'), 'k39@demo.test', 179999, 'PLN', 'completed', 'pi_p44', NOW() - INTERVAL '20 minutes');

  -- Grant product access to all registered users
  INSERT INTO user_product_access (user_id, product_id, access_granted_at) VALUES
  (user2_id, premium_product_id,  NOW() - INTERVAL '6 days'),
  (user2_id, pro_toolkit_id,      NOW() - INTERVAL '4 days'),
  (user2_id, vip_masterclass_id,  NOW() - INTERVAL '1 day'),
  (user3_id, premium_product_id,  NOW() - INTERVAL '8 days'),
  (user3_id, pro_toolkit_id,      NOW() - INTERVAL '3 days'),
  (user3_id, vip_masterclass_id,  NOW() - INTERVAL '3 hours'),
  (user4_id, pro_toolkit_id,      NOW() - INTERVAL '23 days'),
  (user5_id, vip_masterclass_id,  NOW() - INTERVAL '20 days'),
  (user6_id, pro_toolkit_id,      NOW() - INTERVAL '18 days'),
  (user7_id, pro_toolkit_id,      NOW() - INTERVAL '14 days'),
  (user8_id, premium_product_id,  NOW() - INTERVAL '11 days');

  -- =========================================================
  -- STEP 10: SEED — OTO OFFERS
  -- =========================================================

  INSERT INTO oto_offers (source_product_id, oto_product_id, discount_type, discount_value, duration_minutes, is_active, display_order)
  VALUES (
    (SELECT id FROM products WHERE slug = 'premium-course'),
    (SELECT id FROM products WHERE slug = 'pro-toolkit'),
    'percentage', 30, 15, true, 1
  );

  INSERT INTO oto_offers (source_product_id, oto_product_id, discount_type, discount_value, duration_minutes, is_active, display_order)
  VALUES (
    (SELECT id FROM products WHERE slug = 'pro-toolkit'),
    (SELECT id FROM products WHERE slug = 'vip-masterclass'),
    'fixed', 50, 30, true, 1
  );

  INSERT INTO oto_offers (source_product_id, oto_product_id, discount_type, discount_value, duration_minutes, is_active, display_order)
  VALUES (
    (SELECT id FROM products WHERE slug = 'vip-masterclass'),
    (SELECT id FROM products WHERE slug = 'enterprise-package'),
    'percentage', 40, 10, true, 1
  );

  -- =========================================================
  -- STEP 11: SEED — TEST PRODUCTS (redirect scenarios)
  -- =========================================================

  INSERT INTO products (
    name, slug, description, icon, price, currency, vat_rate, price_includes_vat,
    features, is_active, success_redirect_url, pass_params_to_redirect
  ) VALUES
  (
    'Test OTO Active', 'test-oto-active',
    'Product with active OTO offer. After purchase, shows OTO for Test OTO Target product.',
    '🎯', 19.99, 'USD', 23.00, true,
    '[{"title": "Test scenario", "items": ["OTO enabled", "No redirect URL", "Shows OTO offer after purchase"]}]'::jsonb,
    true, NULL, false
  ),
  (
    'Test Product Redirect', 'test-product-redirect',
    'Product that redirects to another product page after purchase.',
    '🔄', 29.99, 'USD', 23.00, true,
    '[{"title": "Test scenario", "items": ["No OTO", "Redirects to /p/premium-course", "Internal redirect"]}]'::jsonb,
    true, '/p/premium-course', true
  ),
  (
    'Test Custom Redirect', 'test-custom-redirect',
    'Product that redirects to external URL after purchase.',
    '🌐', 39.99, 'USD', 23.00, true,
    '[{"title": "Test scenario", "items": ["No OTO", "Redirects to https://google.com", "External redirect with params"]}]'::jsonb,
    true, 'https://google.com', true
  ),
  (
    'Test OTO Owned', 'test-oto-owned',
    'Product with OTO, but john.doe already owns the OTO target. OTO should be skipped.',
    '✅', 24.99, 'USD', 23.00, true,
    '[{"title": "Test scenario", "items": ["OTO configured", "john.doe owns OTO product", "OTO should be SKIPPED", "No redirect"]}]'::jsonb,
    true, NULL, false
  ),
  (
    'Test No Redirect', 'test-no-redirect',
    'Plain product without any OTO or redirect. Shows success page and redirects to product page.',
    '📦', 14.99, 'USD', 23.00, true,
    '[{"title": "Test scenario", "items": ["No OTO", "No redirect URL", "Stays on success page", "Countdown to product page"]}]'::jsonb,
    true, NULL, false
  ),
  (
    'Test OTO Target', 'test-oto-target',
    'This product is offered as OTO for other test products.',
    '🎁', 9.99, 'USD', 23.00, true,
    '[{"title": "OTO Target", "items": ["Used as OTO offer", "Discounted in OTO flow"]}]'::jsonb,
    true, NULL, false
  );

  -- OTO for test products
  INSERT INTO oto_offers (source_product_id, oto_product_id, discount_type, discount_value, duration_minutes, is_active, display_order)
  VALUES (
    (SELECT id FROM products WHERE slug = 'test-oto-active'),
    (SELECT id FROM products WHERE slug = 'test-oto-target'),
    'percentage', 20, 15, true, 1
  );

  INSERT INTO oto_offers (source_product_id, oto_product_id, discount_type, discount_value, duration_minutes, is_active, display_order)
  VALUES (
    (SELECT id FROM products WHERE slug = 'test-oto-owned'),
    (SELECT id FROM products WHERE slug = 'test-oto-target'),
    'percentage', 25, 20, true, 1
  );

  -- john.doe owns test-oto-target (so OTO is skipped for test-oto-owned)
  INSERT INTO user_product_access (user_id, product_id, access_granted_at)
  VALUES (
    user1_id,
    (SELECT id FROM products WHERE slug = 'test-oto-target'),
    NOW() - INTERVAL '7 days'
  );

  -- =========================================================
  -- STEP 12: SEED — VARIANT GROUPS
  -- =========================================================

  -- Group 1: "Learning Path" — tiered progression from course to masterclass
  INSERT INTO variant_groups (name, slug) VALUES
  ('Learning Path', 'learning-path');

  INSERT INTO product_variant_groups (product_id, group_id, variant_name, display_order, is_featured)
  VALUES
  (
    (SELECT id FROM products WHERE slug = 'premium-course'),
    (SELECT id FROM variant_groups WHERE slug = 'learning-path'),
    'Course Only', 0, false
  ),
  (
    (SELECT id FROM products WHERE slug = 'pro-toolkit'),
    (SELECT id FROM variant_groups WHERE slug = 'learning-path'),
    'Course + Toolkit', 1, true
  ),
  (
    (SELECT id FROM products WHERE slug = 'vip-masterclass'),
    (SELECT id FROM variant_groups WHERE slug = 'learning-path'),
    'Full Masterclass', 2, false
  );

  -- Group 2: "Business Tier" — professional vs enterprise
  INSERT INTO variant_groups (name, slug) VALUES
  ('Business Tier', 'business-tier');

  INSERT INTO product_variant_groups (product_id, group_id, variant_name, display_order, is_featured)
  VALUES
  (
    (SELECT id FROM products WHERE slug = 'pro-toolkit'),
    (SELECT id FROM variant_groups WHERE slug = 'business-tier'),
    'Professional', 0, false
  ),
  (
    (SELECT id FROM products WHERE slug = 'vip-masterclass'),
    (SELECT id FROM variant_groups WHERE slug = 'business-tier'),
    'VIP', 1, true
  ),
  (
    (SELECT id FROM products WHERE slug = 'enterprise-package'),
    (SELECT id FROM variant_groups WHERE slug = 'business-tier'),
    'Enterprise', 2, false
  );

END;
$func$;

-- Restrict access: only service_role can call this function
REVOKE ALL ON FUNCTION public.demo_reset_data() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demo_reset_data() FROM anon;
REVOKE ALL ON FUNCTION public.demo_reset_data() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.demo_reset_data() TO service_role;
