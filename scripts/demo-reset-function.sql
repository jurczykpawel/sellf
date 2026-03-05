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
  user1_id     UUID := 'aaaaaaaa-1111-4111-a111-111111111111';
  user2_id     UUID := 'bbbbbbbb-2222-4222-a222-222222222222';
  user3_id     UUID := 'cccccccc-3333-4333-a333-333333333333';
  user4_id     UUID := 'f4f4f4f4-4444-4444-a444-444444444444';
  user5_id     UUID := 'f5f5f5f5-5555-4555-a555-555555555555';
  user6_id     UUID := 'f6f6f6f6-6666-4666-a666-666666666666';
  user7_id     UUID := 'f7f7f7f7-7777-4777-a777-777777777777';
  user8_id     UUID := 'f8f8f8f8-8888-4888-a888-888888888888';
  -- Product ID variables (resolved after INSERT)
  fundamentals_id UUID;  -- email-marketing-101
  toolkit_id      UUID;  -- social-media-toolkit
  blueprint_id    UUID;  -- sales-funnel-blueprint (PWYW)
  masterclass_id  UUID;  -- email-masterclass
  bundle_id       UUID;  -- content-creator-bundle
  mentoring_id    UUID;  -- group-coaching
BEGIN

  -- =========================================================
  -- STEP 1: TRUNCATE ALL DATA
  -- =========================================================

  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
    EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' CASCADE';
  END LOOP;

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
    demo_user_id, 'authenticated', 'authenticated',
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
    font_family, custom_settings
  ) VALUES (
    'USD', 'Growth Academy', NULL,
    'inter', '{}'::jsonb
  );

  -- =========================================================
  -- STEP 4: SEED — PRODUCTS
  -- =========================================================
  -- 10 products, each showcasing a distinct Sellf feature:
  --   starter-guide          free product, auto-grant, redirect to paid
  --   email-marketing-101    basic paid, order bump source
  --   social-media-toolkit   templates, order bump target
  --   sales-funnel-blueprint PWYW (allow_custom_price)
  --   email-masterclass      advanced tier, OTO source
  --   content-creator-bundle bundle pricing
  --   live-launch-workshop   available_from = NOW() + 14 days (always upcoming)
  --   annual-academy-pass    auto_grant_duration_days = 365
  --   group-coaching         auto_grant_duration_days = 90, high-ticket OTO target
  --   vip-coaching           is_active = false (coming soon showcase)

  INSERT INTO products (
    name, slug, description, long_description, icon, image_url, thumbnail_url,
    price, currency, vat_rate, price_includes_vat, allow_custom_price, custom_price_min, features,
    is_active, is_featured, auto_grant_duration_days,
    available_from, available_until,
    success_redirect_url, pass_params_to_redirect
  ) VALUES

  -- 1. FREE LEAD MAGNET — freemium, auto-grant, redirect to paid
  (
    'Email Marketing Starter Guide', 'starter-guide',
    'Free step-by-step guide to building your first email list from scratch.',
    '## Start Growing Your List Today

This free starter guide gives you everything you need to launch your first email marketing campaign in under 48 hours.

### What''s inside

- List-building checklist (10 proven tactics)
- Welcome email template (copy & paste ready)
- Subject line formula that gets 40%+ open rates
- Recommended tools comparison chart

> "I grew my first 500 subscribers in 3 weeks using this guide." — Alex M.

### Next step

Ready to go deeper? Check out **Email Marketing 101** — the full course.',
    '📧', NULL, NULL,
    0, 'USD', 0.00, true, false, NULL,
    '[{"title": "What you get", "items": ["List-building checklist", "Welcome email template", "Subject line formula", "Tools comparison chart"]}]'::jsonb,
    true, true, NULL,
    NULL, NULL,
    '/p/email-marketing-101', true
  ),

  -- 2. ENTRY COURSE — basic paid product, page protection, order bump source
  (
    'Email Marketing 101', 'email-marketing-101',
    'Beginner-friendly course covering everything you need to start selling via email.',
    '## From Zero to First Sale via Email

Email Marketing 101 is a structured 4-week program that walks you through building, growing, and monetising an email list — even if you''re starting from scratch.

### Curriculum

**Week 1 — Foundation**
- Choose your platform (Mailchimp, ConvertKit, or Brevo)
- Set up your first opt-in form
- Write your welcome sequence

**Week 2 — Growth**
- Lead magnet creation workshop
- Organic traffic strategies
- First 100 subscribers challenge

**Week 3 — Engagement**
- Newsletter formats that get clicks
- Segmentation basics
- Deliverability essentials

**Week 4 — Monetisation**
- Writing promotional emails that convert
- Launch sequences
- Automated sales funnels intro

### What''s included

- 8 hours of video lessons
- Downloadable workbooks
- Community access (Slack)
- 30-day Q&A support',
    '📬', NULL, NULL,
    49.00, 'USD', 23.00, true, false, NULL,
    '[{"title": "Course content", "items": ["8 hours of video lessons", "4 weekly modules", "Downloadable workbooks", "30-day Q&A support"]}, {"title": "Bonuses", "items": ["Email swipe file (30+ templates)", "Community Slack access", "Certificate of completion"]}]'::jsonb,
    true, true, NULL,
    NULL, NULL,
    NULL, false
  ),

  -- 3. TEMPLATES TOOLKIT — element protection, order bump target
  (
    'Social Media Content Toolkit', 'social-media-toolkit',
    'Ready-to-use content templates for Instagram, LinkedIn, and Facebook.',
    '## 200+ Done-For-You Social Media Templates

Stop staring at a blank screen. The Social Media Content Toolkit gives you a full year''s worth of post ideas, captions, and graphic templates — all customisable in Canva.

### What''s included

- **Instagram:** 80 post templates + 30 Story designs
- **LinkedIn:** 60 thought-leadership post frameworks
- **Facebook:** 40 engagement-driving post templates
- **Bonus:** 12-month content calendar (Notion template)

### Who is this for?

Ideal for solopreneurs and freelancers who want a consistent social media presence without hiring a content manager.

### How it works

1. Download the Canva template pack
2. Customise colours and fonts to your brand
3. Schedule posts using your favourite tool
4. Repeat every week without the blank-page panic',
    '📱', NULL, NULL,
    79.00, 'USD', 23.00, true, false, NULL,
    '[{"title": "What''s included", "items": ["80 Instagram post templates", "60 LinkedIn post frameworks", "40 Facebook post templates", "12-month content calendar"]}, {"title": "Formats", "items": ["Canva-ready files", "Google Docs caption scripts", "Notion content planner", "PDF brand guide template"]}]'::jsonb,
    true, false, NULL,
    NULL, NULL,
    NULL, false
  ),

  -- 4. PWYW PRODUCT — showcases allow_custom_price
  (
    'Sales Funnel Blueprint', 'sales-funnel-blueprint',
    'A pay-what-you-want blueprint for building your first automated sales funnel.',
    '## Build a Funnel That Sells While You Sleep

The Sales Funnel Blueprint is a practical, no-fluff guide to setting up a simple automated funnel — from lead capture to purchase confirmation.

### The 5-stage framework

1. **Attract** — traffic sources that actually convert
2. **Capture** — high-converting opt-in page formula
3. **Nurture** — 7-email welcome sequence structure
4. **Convert** — sales page and checkout optimisation
5. **Ascend** — order bumps and one-time offers

### Pay What You Want

This product uses PWYW pricing. Grab it for free if budget is tight. If it helps you land your first sale, come back and pay what it was worth.

### Format

- 45-page PDF guide
- Funnel map (Whimsical template)
- Email sequence builder spreadsheet',
    '🎯', NULL, NULL,
    97.00, 'USD', 0.00, false, true, 0,
    '[{"title": "What''s inside", "items": ["45-page PDF blueprint", "5-stage funnel framework", "Email sequence templates", "Funnel map (Whimsical)"]}, {"title": "PWYW pricing", "items": ["Pay what you want", "Free if you need it", "No questions asked"]}]'::jsonb,
    true, false, NULL,
    NULL, NULL,
    NULL, false
  ),

  -- 5. ADVANCED COURSE — higher tier in email marketing track
  (
    'Email Marketing Masterclass', 'email-masterclass',
    'Advanced email marketing strategies for creators with an established list.',
    '## Take Your Email Revenue to the Next Level

The Email Marketing Masterclass is for creators who already have a list and want to scale revenue through advanced segmentation, automation, and launch sequences.

### What you''ll master

**Advanced Segmentation**
- Behavioural tagging and engagement scoring
- Dynamic content blocks

**Automation Architecture**
- Evergreen funnel design
- Re-engagement and post-purchase flows

**Launch Strategy**
- 10-day launch sequence blueprint
- Scarcity and urgency (without sleaze)
- Post-launch follow-up system

**Analytics & Optimisation**
- A/B testing framework
- Revenue attribution
- Churn prediction signals

### Includes

- 14 hours of deep-dive video
- Live Q&A recordings (6 sessions)
- Private Slack community (1 year)
- Direct feedback on your first launch sequence',
    '🚀', NULL, NULL,
    149.00, 'USD', 23.00, true, false, NULL,
    '[{"title": "Course content", "items": ["14 hours of video", "Advanced segmentation module", "Automation architecture workshop", "Launch strategy masterclass"]}, {"title": "Community & support", "items": ["Private Slack (1 year)", "6 live Q&A recordings", "Launch sequence review", "Email swipe file (50+ templates)"]}]'::jsonb,
    true, true, NULL,
    NULL, NULL,
    NULL, false
  ),

  -- 6. BUNDLE — combines email course + social toolkit at a discount
  (
    'Content Creator Bundle', 'content-creator-bundle',
    'Email Marketing 101 + Social Media Toolkit bundled at a significant discount.',
    '## Everything You Need to Build and Grow Online

The Content Creator Bundle gives you the complete toolkit for digital creators: email marketing foundation AND social media templates — together for less than buying separately.

### Bundle includes

**Email Marketing 101** (worth $49)
- 8 hours of video lessons
- Full 4-week curriculum
- 30+ email templates

**Social Media Content Toolkit** (worth $79)
- 200+ content templates
- 12-month content calendar
- Canva design files

### Why bundle?

Email and social media work best together. Grow your audience on social, capture them on your list, convert them via email. This bundle teaches you the full loop.

**Save $49 vs buying separately.**',
    '🎁', NULL, NULL,
    179.00, 'USD', 23.00, true, false, NULL,
    '[{"title": "Included products", "items": ["Email Marketing 101 (full course)", "Social Media Content Toolkit (200+ templates)", "Combined Notion workspace", "Priority support access"]}, {"title": "Bundle savings", "items": ["$49 off vs buying separately", "Lifetime access", "All future updates included"]}]'::jsonb,
    true, false, NULL,
    NULL, NULL,
    NULL, false
  ),

  -- 7. PRE-LAUNCH — available_from = NOW() + 14 days (dynamic: always 2 weeks ahead)
  (
    'Live Launch Workshop', 'live-launch-workshop',
    'Intensive live workshop: plan and execute your first digital product launch in 3 days.',
    '## Launch Your First Product Live, With Us

The Live Launch Workshop is a 3-day intensive where you plan, build, and launch a digital product — in real time, with coaching support throughout.

### Workshop format

**Day 1 — Strategy**
- Define your offer and positioning
- Choose your pricing model
- Set up your product page

**Day 2 — Build**
- Create your checkout flow
- Write your launch emails
- Record your intro video

**Day 3 — Launch**
- Go live and promote
- Real-time troubleshooting
- First sale celebration

### What''s included

- 3 live Zoom sessions (4h each)
- Private Discord during the workshop
- 90-day access to recordings
- Pre-workshop prep materials

**Seats are limited to 20 participants.**',
    '🎪', NULL, NULL,
    197.00, 'USD', 0.00, false, false, NULL,
    '[{"title": "Workshop details", "items": ["3 live Zoom sessions (4h each)", "Max 20 participants", "Real-time coaching", "90-day recording access"]}, {"title": "What you walk away with", "items": ["Live product on Sellf", "Launch email sequence", "First customers", "Recording library access"]}]'::jsonb,
    true, false, NULL,
    NOW() + INTERVAL '14 days', NULL,
    NULL, false
  ),

  -- 8. ANNUAL MEMBERSHIP — auto_grant_duration_days = 365
  (
    'Annual Academy Pass', 'annual-academy-pass',
    'Full-year access to all current and future Growth Academy courses and workshops.',
    '## One Price. All Courses. One Full Year.

The Annual Academy Pass gives you unlimited access to the entire Growth Academy library — every course, every toolkit, every live session recording — for 12 months.

### What''s included

- Email Marketing 101 (full course)
- Email Marketing Masterclass
- Social Media Content Toolkit
- Sales Funnel Blueprint
- Content Creator Bundle
- All future courses added this year
- Monthly live Q&A sessions
- Community Slack (all channels)

### Who is this for?

Creators serious about building a content-based business in the next 12 months who want structured learning and accountability.

### Access

Your access starts immediately and expires in 365 days. Renew at a discounted rate.',
    '🏛️', NULL, NULL,
    297.00, 'USD', 23.00, true, false, NULL,
    '[{"title": "Full library access", "items": ["All current courses", "All future courses (1 year)", "Monthly live Q&A sessions", "Community Slack access"]}, {"title": "Pass details", "items": ["365-day access from purchase", "Renewal discount available", "No auto-renewal", "Content download permitted"]}]'::jsonb,
    true, true, 365,
    NULL, NULL,
    NULL, false
  ),

  -- 9. HIGH-TICKET COACHING — 90-day access, OTO target
  (
    'Group Coaching Program', 'group-coaching',
    'Weekly group coaching calls for 90 days with personalised feedback and accountability.',
    '## Accelerate With a Coach in Your Corner

The Group Coaching Program is a 90-day intensive with weekly live calls, structured curriculum, and personal accountability — in a small group of max 8 participants.

### Program structure

**Month 1 — Build Your Foundation**
- Define your niche and offer
- Create your first digital product
- Set up your email list and social presence

**Month 2 — Launch and Learn**
- Execute your first product launch
- Analyse results and iterate
- Add your first upsell or order bump

**Month 3 — Scale and Automate**
- Build automated sales sequences
- Add affiliate partnerships
- Systematise content creation

### Coaching format

- Weekly 90-min group call (Zoom)
- Slack access to coach between calls
- Monthly 1-on-1 session (30 min)
- Peer accountability partners

**Access expires 90 days after purchase.**',
    '👥', NULL, NULL,
    497.00, 'USD', 0.00, false, false, NULL,
    '[{"title": "Program details", "items": ["Weekly 90-min group calls (12 total)", "Monthly 1-on-1 session (3 total)", "Max 8 participants", "90-day structured curriculum"]}, {"title": "Support", "items": ["Direct Slack access to coach", "Peer accountability groups", "Session recordings", "Resource library access"]}]'::jsonb,
    true, false, 90,
    NULL, NULL,
    NULL, false
  ),

  -- 10. INACTIVE / COMING SOON — showcases is_active = false
  (
    '1-on-1 VIP Coaching', 'vip-coaching',
    'Private one-on-one coaching — currently paused, re-opening Q3 2026.',
    '## Private 1-on-1 Coaching (Waitlist Only)

VIP Coaching is currently closed to new clients. Sign up for the waitlist to be notified when spots open.

### What VIP coaching includes

- Weekly 60-min private session
- Unlimited Slack access
- Full course library access
- Custom curriculum built for your goals
- Email and funnel review on demand

### Why it''s paused

To maintain quality, VIP coaching is limited to 5 active clients. Current cohort runs through Q2 2026. New spots open in Q3 2026.',
    '⭐', NULL, NULL,
    997.00, 'USD', 0.00, false, false, NULL,
    '[{"title": "VIP includes", "items": ["Weekly 60-min 1-on-1 session", "Unlimited Slack access", "Full course library access", "Custom curriculum"]}, {"title": "Availability", "items": ["Currently paused (Q3 2026 opening)", "Join waitlist below", "Max 5 active clients", "Rolling 90-day commitment"]}]'::jsonb,
    false, false, NULL,
    NULL, NULL,
    NULL, false
  ),

  -- 11. HIDDEN DRAFT — not published yet, visible only in admin
  (
    'Creator Certification Program', 'creator-certification',
    'Official Growth Academy certification — a 12-week structured program with exam and badge.',
    '## Become a Certified Growth Academy Creator

The Creator Certification Program is our most structured offering: a 12-week curriculum with weekly assignments, peer reviews, and a final exam. Graduates receive an official certificate and a verifiable badge for LinkedIn.

### Program structure

**Weeks 1–3 — Foundations**
- Personal brand positioning
- Niche selection framework
- Content pillar strategy

**Weeks 4–6 — Audience Building**
- List growth systems
- Social media growth engine
- Lead magnet creation sprint

**Weeks 7–9 — Monetisation**
- First digital product creation
- Pricing and positioning workshop
- Launch sequence build

**Weeks 10–12 — Scale & Certify**
- Automation and systems audit
- Growth analytics review
- Final certification exam

### What graduates receive

- Printed certificate (mailed worldwide)
- Verifiable LinkedIn badge
- Alumni community access (lifetime)
- Featured in Growth Academy directory

**Next cohort: Q4 2026. Currently in curriculum development.**',
    '🎓', NULL, NULL,
    697.00, 'USD', 0.00, false, false, NULL,
    '[{"title": "12-week curriculum", "items": ["Weekly live sessions", "Peer review assignments", "Final certification exam", "Printed certificate + LinkedIn badge"]}, {"title": "Alumni benefits", "items": ["Lifetime alumni community", "Featured in public directory", "Cohort accountability groups", "Discounts on all future courses"]}]'::jsonb,
    false, false, NULL,
    NULL, NULL,
    NULL, false
  );

  -- 12. UNLISTED — active, purchasable via direct link, hidden from shop
  INSERT INTO products (
    name, slug, description, long_description, icon,
    price, currency, vat_rate, price_includes_vat, allow_custom_price, custom_price_min, features,
    is_active, is_listed, is_featured, auto_grant_duration_days
  ) VALUES (
    'Subscriber-Only Bundle', 'subscriber-bundle',
    'Exclusive bundle for email subscribers — not listed in the shop.',
    '## Thank You for Being a Subscriber

This offer is only available to Growth Academy newsletter subscribers. It won''t appear in the shop — you got here because someone shared the link with you (or you clicked the link in our email).

### What''s included

- Email Marketing 101 (full course, worth $49)
- Social Media Content Toolkit (200+ templates, worth $79)
- Sales Funnel Blueprint (worth $97)
- Quick-Start Email Templates (worth $9.99)

**Total value: $235 — yours for $97.**

### Why so cheap?

We offer this bundle to subscribers as a thank-you for being part of our community. The price won''t go lower than this anywhere else, and this page isn''t indexed by search engines.

*Offer valid as long as you have this link.*',
    '🎁',
    97.00, 'USD', 0.00, false, false, NULL,
    '[{"title": "Bundle includes", "items": ["Email Marketing 101 (full course)", "Social Media Content Toolkit", "Sales Funnel Blueprint", "Quick-Start Email Templates"]}, {"title": "Subscriber perks", "items": ["Exclusive subscriber pricing", "Not listed in public shop", "Shareable link (send to a friend)", "Instant access after purchase"]}]'::jsonb,
    true, false, false, NULL
  );

  -- Resolve product IDs for use in subsequent steps
  SELECT id INTO fundamentals_id FROM products WHERE slug = 'email-marketing-101';
  SELECT id INTO toolkit_id       FROM products WHERE slug = 'social-media-toolkit';
  SELECT id INTO blueprint_id     FROM products WHERE slug = 'sales-funnel-blueprint';
  SELECT id INTO masterclass_id   FROM products WHERE slug = 'email-masterclass';
  SELECT id INTO bundle_id        FROM products WHERE slug = 'content-creator-bundle';
  SELECT id INTO mentoring_id     FROM products WHERE slug = 'group-coaching';

  -- =========================================================
  -- STEP 4b: SEED — CONTENT DELIVERY (content_config per product)
  -- =========================================================
  -- delivery_type 'content' = show content items after purchase
  -- delivery_type 'redirect' = redirect to URL (handled via success_redirect_url)
  -- Types: video_embed | download_link | hosted_video | hosted_file

  -- starter-guide: 1 free PDF download
  UPDATE products SET
    content_delivery_type = 'content',
    content_config = jsonb_build_object('content_items', jsonb_build_array(
      jsonb_build_object(
        'id', gen_random_uuid(), 'type', 'download_link', 'order', 0, 'is_active', true,
        'title', 'Email Marketing Starter Guide (PDF)',
        'description', 'Your complete step-by-step guide. Download and keep forever.',
        'config', jsonb_build_object(
          'download_url', 'https://assets.growthacademy.example.com/starter-guide-v2.pdf',
          'file_name', 'email-marketing-starter-guide.pdf',
          'file_size', '2.4 MB'
        )
      )
    ))
  WHERE slug = 'starter-guide';

  -- email-marketing-101: 2 video embeds + 2 downloads
  UPDATE products SET
    content_delivery_type = 'content',
    content_config = jsonb_build_object('content_items', jsonb_build_array(
      jsonb_build_object(
        'id', gen_random_uuid(), 'type', 'video_embed', 'order', 0, 'is_active', true,
        'title', 'Course Introduction & Overview',
        'description', 'Welcome to Email Marketing 101. Watch this first to understand how the 4-week program works.',
        'config', jsonb_build_object(
          'embed_url', 'https://www.youtube.com/embed/dQw4w9WgXcQ',
          'controls', true, 'duration', '8:42'
        )
      ),
      jsonb_build_object(
        'id', gen_random_uuid(), 'type', 'video_embed', 'order', 1, 'is_active', true,
        'title', 'Week 1 — Choosing Your Email Platform',
        'description', 'A side-by-side comparison of Mailchimp, ConvertKit, and Brevo to help you pick the right tool.',
        'config', jsonb_build_object(
          'embed_url', 'https://www.youtube.com/embed/dQw4w9WgXcQ',
          'controls', true, 'duration', '24:15'
        )
      ),
      jsonb_build_object(
        'id', gen_random_uuid(), 'type', 'download_link', 'order', 2, 'is_active', true,
        'title', 'Week 1 Workbook (PDF)',
        'description', 'Exercises and templates for Week 1. Print or fill in digitally.',
        'config', jsonb_build_object(
          'download_url', 'https://assets.growthacademy.example.com/em101-week1-workbook.pdf',
          'file_name', 'em101-week1-workbook.pdf',
          'file_size', '1.1 MB'
        )
      ),
      jsonb_build_object(
        'id', gen_random_uuid(), 'type', 'download_link', 'order', 3, 'is_active', true,
        'title', 'Email Swipe File — 30 Templates',
        'description', 'Ready-to-use email templates for welcome, nurture, and promotional sequences.',
        'config', jsonb_build_object(
          'download_url', 'https://assets.growthacademy.example.com/em101-swipe-file.zip',
          'file_name', 'email-swipe-file-30-templates.zip',
          'file_size', '840 KB'
        )
      )
    ))
  WHERE slug = 'email-marketing-101';

  -- social-media-toolkit: 3 download links (Canva, Notion, PDF)
  UPDATE products SET
    content_delivery_type = 'content',
    content_config = jsonb_build_object('content_items', jsonb_build_array(
      jsonb_build_object(
        'id', gen_random_uuid(), 'type', 'download_link', 'order', 0, 'is_active', true,
        'title', 'Canva Template Pack (200+ designs)',
        'description', 'Click the link to copy all templates to your Canva account. Includes Instagram, LinkedIn, and Facebook designs.',
        'config', jsonb_build_object(
          'download_url', 'https://www.canva.com/design/example-template-pack/view',
          'file_name', 'Social Media Canva Templates',
          'file_size', 'Canva link'
        )
      ),
      jsonb_build_object(
        'id', gen_random_uuid(), 'type', 'download_link', 'order', 1, 'is_active', true,
        'title', '12-Month Content Calendar (Notion)',
        'description', 'Duplicate this Notion template to your workspace. Pre-filled with 366 post ideas.',
        'config', jsonb_build_object(
          'download_url', 'https://www.notion.so/example-content-calendar',
          'file_name', '12-Month Content Calendar',
          'file_size', 'Notion link'
        )
      ),
      jsonb_build_object(
        'id', gen_random_uuid(), 'type', 'download_link', 'order', 2, 'is_active', true,
        'title', 'Caption Formula Guide (PDF)',
        'description', '15 caption structures that drive comments and shares — with 3 examples each.',
        'config', jsonb_build_object(
          'download_url', 'https://assets.growthacademy.example.com/caption-formula-guide.pdf',
          'file_name', 'caption-formula-guide.pdf',
          'file_size', '680 KB'
        )
      )
    ))
  WHERE slug = 'social-media-toolkit';

  -- sales-funnel-blueprint: PDF + Whimsical map
  UPDATE products SET
    content_delivery_type = 'content',
    content_config = jsonb_build_object('content_items', jsonb_build_array(
      jsonb_build_object(
        'id', gen_random_uuid(), 'type', 'download_link', 'order', 0, 'is_active', true,
        'title', 'Sales Funnel Blueprint (PDF, 45 pages)',
        'description', 'The complete 5-stage funnel framework with examples and checklists.',
        'config', jsonb_build_object(
          'download_url', 'https://assets.growthacademy.example.com/sales-funnel-blueprint.pdf',
          'file_name', 'sales-funnel-blueprint.pdf',
          'file_size', '3.2 MB'
        )
      ),
      jsonb_build_object(
        'id', gen_random_uuid(), 'type', 'download_link', 'order', 1, 'is_active', true,
        'title', 'Funnel Map Template (Whimsical)',
        'description', 'Interactive funnel diagram. Copy to your Whimsical workspace and customise for your offer.',
        'config', jsonb_build_object(
          'download_url', 'https://whimsical.com/example-funnel-map',
          'file_name', 'Funnel Map — Whimsical',
          'file_size', 'Whimsical link'
        )
      )
    ))
  WHERE slug = 'sales-funnel-blueprint';

  -- subscriber-bundle: intro video + combined download vault
  UPDATE products SET
    content_delivery_type = 'content',
    content_config = jsonb_build_object('content_items', jsonb_build_array(
      jsonb_build_object(
        'id', gen_random_uuid(), 'type', 'video_embed', 'order', 0, 'is_active', true,
        'title', 'Welcome from Growth Academy',
        'description', 'A personal welcome from the team — what''s in your bundle and how to get the most from it.',
        'config', jsonb_build_object(
          'embed_url', 'https://www.youtube.com/embed/dQw4w9WgXcQ',
          'controls', true, 'duration', '3:21'
        )
      ),
      jsonb_build_object(
        'id', gen_random_uuid(), 'type', 'download_link', 'order', 1, 'is_active', true,
        'title', 'Bundle Vault — All Files (ZIP)',
        'description', 'Everything in one archive: Email Marketing 101 workbooks, Social Media templates, Funnel Blueprint, and Email Templates.',
        'config', jsonb_build_object(
          'download_url', 'https://assets.growthacademy.example.com/subscriber-bundle-vault.zip',
          'file_name', 'growth-academy-subscriber-bundle.zip',
          'file_size', '18.4 MB'
        )
      )
    ))
  WHERE slug = 'subscriber-bundle';

  -- enable_waitlist on inactive products
  UPDATE products SET enable_waitlist = true
  WHERE slug IN ('vip-coaching', 'creator-certification');

  -- =========================================================
  -- STEP 5: SEED — ORDER BUMPS
  -- =========================================================

  INSERT INTO order_bumps (main_product_id, bump_product_id, bump_price, bump_title, bump_description, is_active)
  VALUES (
    fundamentals_id, toolkit_id,
    25.00,
    '📱 Add the Social Media Toolkit for just $25!',
    'Get 200+ done-for-you social media templates (worth $79). Complete your content system in one purchase.',
    true
  );

  INSERT INTO order_bumps (main_product_id, bump_product_id, bump_price, bump_title, bump_description, is_active)
  VALUES (
    blueprint_id, masterclass_id,
    49.00,
    '🚀 Add Email Marketing Masterclass for just $49!',
    'Add the advanced masterclass (worth $149) to your Blueprint. Learn the email strategies that power the funnels you''ll build.',
    true
  );

  -- =========================================================
  -- STEP 6: SEED — COUPONS
  -- =========================================================

  INSERT INTO coupons (code, name, discount_type, discount_value, usage_limit_global, is_active)
  VALUES ('WELCOME10', 'Welcome 10% Off', 'percentage', 10, 1000, true);

  INSERT INTO coupons (code, name, discount_type, discount_value, currency, is_active)
  VALUES ('SAVE50', '$50 Fixed Savings', 'fixed', 50, 'USD', true);

  INSERT INTO coupons (code, name, discount_type, discount_value, allowed_emails, is_active)
  VALUES ('VIP90', 'VIP 90% Discount', 'percentage', 90,
    '["vip@example.com", "admin@example.com", "demo@sellf.app"]'::jsonb, true);

  INSERT INTO coupons (code, name, discount_type, discount_value, allowed_product_ids, is_active)
  VALUES ('FUNNEL30', 'Funnel Blueprint 30% Off', 'percentage', 30,
    (SELECT jsonb_build_array(id) FROM products WHERE slug = 'sales-funnel-blueprint'), true);

  -- =========================================================
  -- STEP 7: SEED — WEBHOOKS
  -- =========================================================

  INSERT INTO webhook_endpoints (id, url, events, description, is_active, secret)
  VALUES (
    '88888888-8888-4888-a888-888888888888',
    'https://httpbin.org/post',
    ARRAY['purchase.completed', 'lead.captured'],
    'Zapier → CRM Integration',
    true,
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
  );

  INSERT INTO webhook_logs (endpoint_id, event_type, payload, status, http_status, response_body, duration_ms, created_at)
  VALUES (
    '88888888-8888-4888-a888-888888888888',
    'purchase.completed',
    '{"event": "purchase.completed", "data": {"email": "alex@example.com", "product": "email-marketing-101", "amount": 4900}}'::jsonb,
    'success', 200, '{"status": "ok", "crm_contact_id": "ct_98234"}',
    143, NOW() - INTERVAL '1 hour'
  );

  INSERT INTO webhook_logs (endpoint_id, event_type, payload, status, http_status, response_body, error_message, duration_ms, created_at)
  VALUES (
    '88888888-8888-4888-a888-888888888888',
    'purchase.completed',
    '{"event": "purchase.completed", "data": {"email": "jane@example.com", "product": "group-coaching", "amount": 49700}}'::jsonb,
    'failed', 500, 'Internal Server Error',
    'HTTP 500 from Zapier', 2489, NOW() - INTERVAL '30 minutes'
  );

  INSERT INTO webhook_logs (endpoint_id, event_type, payload, status, http_status, response_body, error_message, duration_ms, created_at)
  VALUES (
    '88888888-8888-4888-a888-888888888888',
    'lead.captured',
    '{"event": "lead.captured", "data": {"email": "new-lead@example.com"}}'::jsonb,
    'failed', 0, NULL,
    'Request timed out after 5s', 5001, NOW() - INTERVAL '5 minutes'
  );

  -- Access expiry webhook → renewal reminder automation
  INSERT INTO webhook_endpoints (id, url, events, description, is_active, secret)
  VALUES (
    'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    'https://httpbin.org/post',
    ARRAY['access.expired'],
    'Make.com → Renewal Reminder Sequence',
    true,
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
  );

  INSERT INTO webhook_logs (endpoint_id, event_type, payload, status, http_status, response_body, duration_ms, created_at)
  VALUES (
    'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    'access.expired',
    '{"event": "access.expired", "data": {"email": "james.wilson@example.com", "product": "annual-academy-pass", "expired_at": "2026-03-01T00:00:00Z"}}'::jsonb,
    'success', 200, '{"accepted": true}',
    198, NOW() - INTERVAL '4 days'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    'access.expired',
    '{"event": "access.expired", "data": {"email": "emma.brown@example.com", "product": "group-coaching", "expired_at": "2026-03-03T00:00:00Z"}}'::jsonb,
    'success', 200, '{"accepted": true}',
    211, NOW() - INTERVAL '2 days'
  );

  -- Waitlist webhook → httpbin (sends to email list on signup)
  INSERT INTO webhook_endpoints (id, url, events, description, is_active, secret)
  VALUES (
    '99999999-9999-4999-a999-999999999999',
    'https://httpbin.org/post',
    ARRAY['waitlist.signup'],
    'Brevo → Waitlist Email List',
    true,
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
  );

  INSERT INTO webhook_logs (endpoint_id, event_type, payload, status, http_status, response_body, duration_ms, created_at)
  VALUES (
    '99999999-9999-4999-a999-999999999999',
    'waitlist.signup',
    '{"event": "waitlist.signup", "data": {"email": "early@example.com", "product": "creator-certification", "signed_up_at": "2026-03-01T10:22:00Z"}}'::jsonb,
    'success', 201, '{"id": 38291}',
    312, NOW() - INTERVAL '3 days'
  ),
  (
    '99999999-9999-4999-a999-999999999999',
    'waitlist.signup',
    '{"event": "waitlist.signup", "data": {"email": "fan@example.com", "product": "vip-coaching", "signed_up_at": "2026-03-02T14:05:00Z"}}'::jsonb,
    'success', 201, '{"id": 38304}',
    287, NOW() - INTERVAL '2 days'
  ),
  (
    '99999999-9999-4999-a999-999999999999',
    'waitlist.signup',
    '{"event": "waitlist.signup", "data": {"email": "eager@example.com", "product": "creator-certification", "signed_up_at": "2026-03-03T09:11:00Z"}}'::jsonb,
    'success', 201, '{"id": 38317}',
    298, NOW() - INTERVAL '1 day'
  );

  -- =========================================================
  -- STEP 8: SEED — CATEGORIES & TAGS
  -- =========================================================

  INSERT INTO categories (name, slug, description) VALUES
  ('Free Resources',  'free-resources',  'Free guides, templates, and starter kits'),
  ('Email Marketing', 'email-marketing', 'Courses and resources for email list growth and monetisation'),
  ('Social Media',    'social-media',    'Content templates and strategies for social platforms'),
  ('Sales & Funnels', 'sales-funnels',   'Funnel blueprints, sales systems, and conversion resources'),
  ('Bundles',         'bundles',         'Value-packed multi-product bundles at a discount'),
  ('Coaching',        'coaching',        'Live coaching programs, workshops, and mentoring');

  INSERT INTO tags (name, slug) VALUES
  ('Bestseller', 'bestseller'),
  ('New',        'new'),
  ('Free',       'free'),
  ('Live',       'live'),
  ('PWYW',       'pwyw'),
  ('Premium',    'premium');

  INSERT INTO product_categories (product_id, category_id) VALUES
  ((SELECT id FROM products WHERE slug = 'starter-guide'),          (SELECT id FROM categories WHERE slug = 'free-resources')),
  ((SELECT id FROM products WHERE slug = 'email-marketing-101'),    (SELECT id FROM categories WHERE slug = 'email-marketing')),
  ((SELECT id FROM products WHERE slug = 'email-masterclass'),      (SELECT id FROM categories WHERE slug = 'email-marketing')),
  ((SELECT id FROM products WHERE slug = 'social-media-toolkit'),   (SELECT id FROM categories WHERE slug = 'social-media')),
  ((SELECT id FROM products WHERE slug = 'sales-funnel-blueprint'), (SELECT id FROM categories WHERE slug = 'sales-funnels')),
  ((SELECT id FROM products WHERE slug = 'content-creator-bundle'), (SELECT id FROM categories WHERE slug = 'bundles')),
  ((SELECT id FROM products WHERE slug = 'annual-academy-pass'),    (SELECT id FROM categories WHERE slug = 'bundles')),
  ((SELECT id FROM products WHERE slug = 'live-launch-workshop'),   (SELECT id FROM categories WHERE slug = 'coaching')),
  ((SELECT id FROM products WHERE slug = 'group-coaching'),         (SELECT id FROM categories WHERE slug = 'coaching')),
  ((SELECT id FROM products WHERE slug = 'vip-coaching'),           (SELECT id FROM categories WHERE slug = 'coaching'));

  INSERT INTO product_tags (product_id, tag_id) VALUES
  ((SELECT id FROM products WHERE slug = 'starter-guide'),          (SELECT id FROM tags WHERE slug = 'free')),
  ((SELECT id FROM products WHERE slug = 'email-marketing-101'),    (SELECT id FROM tags WHERE slug = 'bestseller')),
  ((SELECT id FROM products WHERE slug = 'email-masterclass'),      (SELECT id FROM tags WHERE slug = 'bestseller')),
  ((SELECT id FROM products WHERE slug = 'social-media-toolkit'),   (SELECT id FROM tags WHERE slug = 'new')),
  ((SELECT id FROM products WHERE slug = 'sales-funnel-blueprint'), (SELECT id FROM tags WHERE slug = 'pwyw')),
  ((SELECT id FROM products WHERE slug = 'live-launch-workshop'),   (SELECT id FROM tags WHERE slug = 'live')),
  ((SELECT id FROM products WHERE slug = 'live-launch-workshop'),   (SELECT id FROM tags WHERE slug = 'new')),
  ((SELECT id FROM products WHERE slug = 'annual-academy-pass'),    (SELECT id FROM tags WHERE slug = 'new')),
  ((SELECT id FROM products WHERE slug = 'group-coaching'),         (SELECT id FROM tags WHERE slug = 'premium')),
  ((SELECT id FROM products WHERE slug = 'vip-coaching'),           (SELECT id FROM tags WHERE slug = 'premium'));

  -- =========================================================
  -- STEP 9: SEED — SAMPLE USERS & TRANSACTIONS
  -- =========================================================
  -- 9 users total (demo admin + 8 customers)
  -- ~83 transactions over 30 days with growing trend
  -- Amounts in cents (Stripe convention): 4900 = $49.00, 49900 = $499.00

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
  (
    '00000000-0000-0000-0000-000000000000', user1_id,
    'authenticated', 'authenticated', 'john.doe@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    NOW() - INTERVAL '28 days', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"John Doe"}'::jsonb,
    NOW() - INTERVAL '28 days', NOW() - INTERVAL '28 days'
  ),
  (
    '00000000-0000-0000-0000-000000000000', user2_id,
    'authenticated', 'authenticated', 'maria.schmidt@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    NOW() - INTERVAL '22 days', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Maria Schmidt"}'::jsonb,
    NOW() - INTERVAL '22 days', NOW() - INTERVAL '1 day'
  ),
  (
    '00000000-0000-0000-0000-000000000000', user3_id,
    'authenticated', 'authenticated', 'anna.kowalska@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    NOW() - INTERVAL '25 days', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Anna Kowalska"}'::jsonb,
    NOW() - INTERVAL '25 days', NOW() - INTERVAL '3 hours'
  ),
  (
    '00000000-0000-0000-0000-000000000000', user4_id,
    'authenticated', 'authenticated', 'james.wilson@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    NOW() - INTERVAL '23 days', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"James Wilson"}'::jsonb,
    NOW() - INTERVAL '23 days', NOW() - INTERVAL '5 days'
  ),
  (
    '00000000-0000-0000-0000-000000000000', user5_id,
    'authenticated', 'authenticated', 'sarah.jones@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    NOW() - INTERVAL '20 days', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Sarah Jones"}'::jsonb,
    NOW() - INTERVAL '20 days', NOW() - INTERVAL '4 days'
  ),
  (
    '00000000-0000-0000-0000-000000000000', user6_id,
    'authenticated', 'authenticated', 'carlos.garcia@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    NOW() - INTERVAL '18 days', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Carlos Garcia"}'::jsonb,
    NOW() - INTERVAL '18 days', NOW() - INTERVAL '2 days'
  ),
  (
    '00000000-0000-0000-0000-000000000000', user7_id,
    'authenticated', 'authenticated', 'emma.brown@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    NOW() - INTERVAL '14 days', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Emma Brown"}'::jsonb,
    NOW() - INTERVAL '14 days', NOW() - INTERVAL '6 days'
  ),
  (
    '00000000-0000-0000-0000-000000000000', user8_id,
    'authenticated', 'authenticated', 'luca.ferrari@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    NOW() - INTERVAL '11 days', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Luca Ferrari"}'::jsonb,
    NOW() - INTERVAL '11 days', NOW() - INTERVAL '3 days'
  );

  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at) VALUES
  (user1_id::text, user1_id, jsonb_build_object('sub', user1_id::text, 'email', 'john.doe@example.com'),      'email', NOW() - INTERVAL '28 days', NOW() - INTERVAL '28 days', NOW() - INTERVAL '28 days'),
  (user2_id::text, user2_id, jsonb_build_object('sub', user2_id::text, 'email', 'maria.schmidt@example.com'), 'email', NOW() - INTERVAL '1 day',   NOW() - INTERVAL '22 days', NOW() - INTERVAL '1 day'),
  (user3_id::text, user3_id, jsonb_build_object('sub', user3_id::text, 'email', 'anna.kowalska@example.com'), 'email', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '25 days', NOW() - INTERVAL '3 hours'),
  (user4_id::text, user4_id, jsonb_build_object('sub', user4_id::text, 'email', 'james.wilson@example.com'),  'email', NOW() - INTERVAL '5 days',  NOW() - INTERVAL '23 days', NOW() - INTERVAL '5 days'),
  (user5_id::text, user5_id, jsonb_build_object('sub', user5_id::text, 'email', 'sarah.jones@example.com'),   'email', NOW() - INTERVAL '4 days',  NOW() - INTERVAL '20 days', NOW() - INTERVAL '4 days'),
  (user6_id::text, user6_id, jsonb_build_object('sub', user6_id::text, 'email', 'carlos.garcia@example.com'), 'email', NOW() - INTERVAL '2 days',  NOW() - INTERVAL '18 days', NOW() - INTERVAL '2 days'),
  (user7_id::text, user7_id, jsonb_build_object('sub', user7_id::text, 'email', 'emma.brown@example.com'),    'email', NOW() - INTERVAL '6 days',  NOW() - INTERVAL '14 days', NOW() - INTERVAL '6 days'),
  (user8_id::text, user8_id, jsonb_build_object('sub', user8_id::text, 'email', 'luca.ferrari@example.com'),  'email', NOW() - INTERVAL '3 days',  NOW() - INTERVAL '11 days', NOW() - INTERVAL '3 days');

  -- -------------------------------------------------------
  -- PAYMENT TRANSACTIONS — EUR (~€4,800 over 30 days)
  -- Amounts in cents: 4900=€49, 7900=€79, 14900=€149, 17900=€179
  -- Week 1-2: slow start | Week 3-4: acceleration | today: strong close
  -- -------------------------------------------------------
  INSERT INTO payment_transactions (session_id, user_id, product_id, customer_email, amount, currency, status, stripe_payment_intent_id, created_at) VALUES
  ('cs_e01', NULL,     fundamentals_id, 'b01@demo.test', 4900,  'EUR', 'completed', 'pi_e01', NOW() - INTERVAL '29 days'),
  ('cs_e02', NULL,     fundamentals_id, 'b02@demo.test', 4900,  'EUR', 'completed', 'pi_e02', NOW() - INTERVAL '28 days'),
  ('cs_e03', NULL,     toolkit_id,      'b03@demo.test', 7900,  'EUR', 'completed', 'pi_e03', NOW() - INTERVAL '26 days'),
  ('cs_e04', NULL,     fundamentals_id, 'b04@demo.test', 4900,  'EUR', 'completed', 'pi_e04', NOW() - INTERVAL '24 days'),
  ('cs_e05', user4_id, toolkit_id,      'james.wilson@example.com', 7900,  'EUR', 'completed', 'pi_e05', NOW() - INTERVAL '23 days'),
  ('cs_e06', NULL,     fundamentals_id, 'b05@demo.test', 4900,  'EUR', 'completed', 'pi_e06', NOW() - INTERVAL '22 days'),
  ('cs_e07', user5_id, masterclass_id,  'sarah.jones@example.com',  14900, 'EUR', 'completed', 'pi_e07', NOW() - INTERVAL '20 days'),
  ('cs_e08', NULL,     fundamentals_id, 'b06@demo.test', 4900,  'EUR', 'completed', 'pi_e08', NOW() - INTERVAL '19 days'),
  ('cs_e09', NULL,     toolkit_id,      'b07@demo.test', 7900,  'EUR', 'completed', 'pi_e09', NOW() - INTERVAL '18 days'),
  ('cs_e10', NULL,     fundamentals_id, 'b08@demo.test', 4900,  'EUR', 'completed', 'pi_e10', NOW() - INTERVAL '17 days'),
  ('cs_e11', NULL,     masterclass_id,  'b09@demo.test', 14900, 'EUR', 'completed', 'pi_e11', NOW() - INTERVAL '16 days'),
  ('cs_e12', NULL,     bundle_id,       'b10@demo.test', 17900, 'EUR', 'completed', 'pi_e12', NOW() - INTERVAL '15 days'),
  ('cs_e13', NULL,     fundamentals_id, 'b11@demo.test', 4900,  'EUR', 'completed', 'pi_e13', NOW() - INTERVAL '14 days'),
  ('cs_e14', NULL,     masterclass_id,  'b12@demo.test', 14900, 'EUR', 'completed', 'pi_e14', NOW() - INTERVAL '13 days'),
  ('cs_e15', NULL,     bundle_id,       'b13@demo.test', 17900, 'EUR', 'completed', 'pi_e15', NOW() - INTERVAL '12 days'),
  ('cs_e16', NULL,     masterclass_id,  'b14@demo.test', 14900, 'EUR', 'completed', 'pi_e16', NOW() - INTERVAL '11 days'),
  ('cs_e17', user8_id, fundamentals_id, 'luca.ferrari@example.com', 4900,  'EUR', 'completed', 'pi_e17', NOW() - INTERVAL '11 days'),
  ('cs_e18', NULL,     bundle_id,       'b15@demo.test', 17900, 'EUR', 'completed', 'pi_e18', NOW() - INTERVAL '10 days'),
  ('cs_e19', NULL,     masterclass_id,  'b16@demo.test', 14900, 'EUR', 'completed', 'pi_e19', NOW() - INTERVAL '9 days'),
  ('cs_e20', NULL,     masterclass_id,  'b17@demo.test', 14900, 'EUR', 'completed', 'pi_e20', NOW() - INTERVAL '8 days'),
  ('cs_e21', NULL,     bundle_id,       'b18@demo.test', 17900, 'EUR', 'completed', 'pi_e21', NOW() - INTERVAL '7 days'),
  ('cs_e22', NULL,     masterclass_id,  'b19@demo.test', 14900, 'EUR', 'completed', 'pi_e22', NOW() - INTERVAL '7 days'),
  ('cs_e23', user2_id, fundamentals_id, 'maria.schmidt@example.com', 3920, 'EUR', 'completed', 'pi_e23', NOW() - INTERVAL '6 days'),
  ('cs_e24', NULL,     bundle_id,       'b20@demo.test', 17900, 'EUR', 'completed', 'pi_e24', NOW() - INTERVAL '6 days'),
  ('cs_e25', NULL,     masterclass_id,  'b21@demo.test', 14900, 'EUR', 'completed', 'pi_e25', NOW() - INTERVAL '5 days'),
  ('cs_e26', NULL,     bundle_id,       'b22@demo.test', 17900, 'EUR', 'completed', 'pi_e26', NOW() - INTERVAL '5 days'),
  ('cs_e27', user2_id, toolkit_id,      'maria.schmidt@example.com', 6320, 'EUR', 'completed', 'pi_e27', NOW() - INTERVAL '4 days'),
  ('cs_e28', NULL,     bundle_id,       'b23@demo.test', 17900, 'EUR', 'completed', 'pi_e28', NOW() - INTERVAL '4 days'),
  ('cs_e29', NULL,     masterclass_id,  'b24@demo.test', 14900, 'EUR', 'completed', 'pi_e29', NOW() - INTERVAL '4 days'),
  ('cs_e30', NULL,     masterclass_id,  'b25@demo.test', 14900, 'EUR', 'completed', 'pi_e30', NOW() - INTERVAL '3 days'),
  ('cs_e31', NULL,     bundle_id,       'b26@demo.test', 17900, 'EUR', 'completed', 'pi_e31', NOW() - INTERVAL '3 days'),
  ('cs_e32', NULL,     masterclass_id,  'b27@demo.test', 14900, 'EUR', 'completed', 'pi_e32', NOW() - INTERVAL '2 days'),
  ('cs_e33', NULL,     bundle_id,       'b28@demo.test', 17900, 'EUR', 'completed', 'pi_e33', NOW() - INTERVAL '2 days'),
  ('cs_e34', user2_id, masterclass_id,  'maria.schmidt@example.com', 14900, 'EUR', 'completed', 'pi_e34', NOW() - INTERVAL '1 day'),
  ('cs_e35', NULL,     fundamentals_id, 'b29@demo.test', 4900,  'EUR', 'completed', 'pi_e35', NOW() - INTERVAL '1 day'),
  ('cs_e36', NULL,     masterclass_id,  'b30@demo.test', 14900, 'EUR', 'completed', 'pi_e36', NOW() - INTERVAL '1 day'),
  ('cs_e37', NULL,     masterclass_id,  'b31@demo.test', 14900, 'EUR', 'completed', 'pi_e37', NOW() - INTERVAL '2 hours'),
  ('cs_e38', NULL,     bundle_id,       'b32@demo.test', 17900, 'EUR', 'completed', 'pi_e38', NOW() - INTERVAL '1 hour'),
  ('cs_e39', NULL,     masterclass_id,  'b33@demo.test', 14900, 'EUR', 'completed', 'pi_e39', NOW() - INTERVAL '15 minutes');

  -- -------------------------------------------------------
  -- PAYMENT TRANSACTIONS — PLN (~PLN 28,000 over 30 days)
  -- Amounts in cents: 19900=199PLN, 34900=349PLN, 69900=699PLN, 79900=799PLN, 199900=1999PLN
  -- -------------------------------------------------------
  INSERT INTO payment_transactions (session_id, user_id, product_id, customer_email, amount, currency, status, stripe_payment_intent_id, created_at) VALUES
  ('cs_p01', NULL,     fundamentals_id, 'k01@demo.test', 19900,  'PLN', 'completed', 'pi_p01', NOW() - INTERVAL '30 days'),
  ('cs_p02', NULL,     fundamentals_id, 'k02@demo.test', 19900,  'PLN', 'completed', 'pi_p02', NOW() - INTERVAL '29 days'),
  ('cs_p03', NULL,     toolkit_id,      'k03@demo.test', 34900,  'PLN', 'completed', 'pi_p03', NOW() - INTERVAL '27 days'),
  ('cs_p04', NULL,     fundamentals_id, 'k04@demo.test', 19900,  'PLN', 'completed', 'pi_p04', NOW() - INTERVAL '25 days'),
  ('cs_p05', NULL,     toolkit_id,      'k05@demo.test', 34900,  'PLN', 'completed', 'pi_p05', NOW() - INTERVAL '24 days'),
  ('cs_p06', NULL,     toolkit_id,      'k06@demo.test', 34900,  'PLN', 'completed', 'pi_p06', NOW() - INTERVAL '22 days'),
  ('cs_p07', NULL,     fundamentals_id, 'k07@demo.test', 19900,  'PLN', 'completed', 'pi_p07', NOW() - INTERVAL '21 days'),
  ('cs_p08', NULL,     masterclass_id,  'k08@demo.test', 69900,  'PLN', 'completed', 'pi_p08', NOW() - INTERVAL '21 days'),
  ('cs_p09', NULL,     toolkit_id,      'k09@demo.test', 34900,  'PLN', 'completed', 'pi_p09', NOW() - INTERVAL '20 days'),
  ('cs_p10', NULL,     masterclass_id,  'k10@demo.test', 69900,  'PLN', 'completed', 'pi_p10', NOW() - INTERVAL '19 days'),
  ('cs_p11', NULL,     fundamentals_id, 'k11@demo.test', 19900,  'PLN', 'completed', 'pi_p11', NOW() - INTERVAL '18 days'),
  ('cs_p12', user6_id, toolkit_id,      'carlos.garcia@example.com', 34900, 'PLN', 'completed', 'pi_p12', NOW() - INTERVAL '18 days'),
  ('cs_p13', NULL,     masterclass_id,  'k12@demo.test', 69900,  'PLN', 'completed', 'pi_p13', NOW() - INTERVAL '17 days'),
  ('cs_p14', NULL,     fundamentals_id, 'k13@demo.test', 19900,  'PLN', 'completed', 'pi_p14', NOW() - INTERVAL '16 days'),
  ('cs_p15', NULL,     toolkit_id,      'k14@demo.test', 34900,  'PLN', 'completed', 'pi_p15', NOW() - INTERVAL '16 days'),
  ('cs_p16', NULL,     masterclass_id,  'k15@demo.test', 69900,  'PLN', 'completed', 'pi_p16', NOW() - INTERVAL '15 days'),
  ('cs_p17', NULL,     masterclass_id,  'k16@demo.test', 69900,  'PLN', 'completed', 'pi_p17', NOW() - INTERVAL '14 days'),
  ('cs_p18', user7_id, bundle_id,       'emma.brown@example.com', 79900, 'PLN', 'completed', 'pi_p18', NOW() - INTERVAL '14 days'),
  ('cs_p19', NULL,     fundamentals_id, 'k17@demo.test', 19900,  'PLN', 'completed', 'pi_p19', NOW() - INTERVAL '13 days'),
  ('cs_p20', NULL,     toolkit_id,      'k18@demo.test', 34900,  'PLN', 'completed', 'pi_p20', NOW() - INTERVAL '13 days'),
  ('cs_p21', NULL,     masterclass_id,  'k19@demo.test', 69900,  'PLN', 'completed', 'pi_p21', NOW() - INTERVAL '12 days'),
  ('cs_p22', NULL,     bundle_id,       'k20@demo.test', 79900,  'PLN', 'completed', 'pi_p22', NOW() - INTERVAL '11 days'),
  ('cs_p23', NULL,     masterclass_id,  'k21@demo.test', 69900,  'PLN', 'completed', 'pi_p23', NOW() - INTERVAL '10 days'),
  ('cs_p24', NULL,     bundle_id,       'k22@demo.test', 79900,  'PLN', 'completed', 'pi_p24', NOW() - INTERVAL '9 days'),
  ('cs_p25', NULL,     masterclass_id,  'k23@demo.test', 69900,  'PLN', 'completed', 'pi_p25', NOW() - INTERVAL '9 days'),
  ('cs_p26', user3_id, fundamentals_id, 'anna.kowalska@example.com', 19900, 'PLN', 'completed', 'pi_p26', NOW() - INTERVAL '8 days'),
  ('cs_p27', NULL,     masterclass_id,  'k24@demo.test', 69900,  'PLN', 'completed', 'pi_p27', NOW() - INTERVAL '8 days'),
  ('cs_p28', NULL,     bundle_id,       'k25@demo.test', 79900,  'PLN', 'completed', 'pi_p28', NOW() - INTERVAL '7 days'),
  ('cs_p29', NULL,     masterclass_id,  'k26@demo.test', 69900,  'PLN', 'completed', 'pi_p29', NOW() - INTERVAL '7 days'),
  ('cs_p30', NULL,     masterclass_id,  'k27@demo.test', 69900,  'PLN', 'completed', 'pi_p30', NOW() - INTERVAL '6 days'),
  ('cs_p31', NULL,     bundle_id,       'k28@demo.test', 79900,  'PLN', 'completed', 'pi_p31', NOW() - INTERVAL '5 days'),
  ('cs_p32', NULL,     masterclass_id,  'k29@demo.test', 69900,  'PLN', 'completed', 'pi_p32', NOW() - INTERVAL '5 days'),
  ('cs_p33', NULL,     bundle_id,       'k30@demo.test', 79900,  'PLN', 'completed', 'pi_p33', NOW() - INTERVAL '4 days'),
  ('cs_p34', NULL,     masterclass_id,  'k31@demo.test', 69900,  'PLN', 'completed', 'pi_p34', NOW() - INTERVAL '4 days'),
  ('cs_p35', user3_id, bundle_id,       'anna.kowalska@example.com', 79900, 'PLN', 'completed', 'pi_p35', NOW() - INTERVAL '3 days'),
  ('cs_p36', NULL,     masterclass_id,  'k32@demo.test', 69900,  'PLN', 'completed', 'pi_p36', NOW() - INTERVAL '3 days'),
  ('cs_p37', NULL,     mentoring_id,    'k33@demo.test', 199900, 'PLN', 'completed', 'pi_p37', NOW() - INTERVAL '3 days'),
  ('cs_p38', NULL,     bundle_id,       'k34@demo.test', 79900,  'PLN', 'completed', 'pi_p38', NOW() - INTERVAL '2 days'),
  ('cs_p39', NULL,     masterclass_id,  'k35@demo.test', 69900,  'PLN', 'completed', 'pi_p39', NOW() - INTERVAL '2 days'),
  ('cs_p40', NULL,     bundle_id,       'k36@demo.test', 79900,  'PLN', 'completed', 'pi_p40', NOW() - INTERVAL '1 day'),
  ('cs_p41', NULL,     masterclass_id,  'k37@demo.test', 69900,  'PLN', 'completed', 'pi_p41', NOW() - INTERVAL '1 day'),
  ('cs_p42', user3_id, masterclass_id,  'anna.kowalska@example.com', 69900, 'PLN', 'completed', 'pi_p42', NOW() - INTERVAL '3 hours'),
  ('cs_p43', NULL,     bundle_id,       'k38@demo.test', 79900,  'PLN', 'completed', 'pi_p43', NOW() - INTERVAL '90 minutes'),
  ('cs_p44', NULL,     mentoring_id,    'k39@demo.test', 199900, 'PLN', 'completed', 'pi_p44', NOW() - INTERVAL '20 minutes');

  -- Grant product access to registered users (matches their transactions)
  INSERT INTO user_product_access (user_id, product_id, access_granted_at) VALUES
  (user2_id, fundamentals_id, NOW() - INTERVAL '6 days'),
  (user2_id, toolkit_id,      NOW() - INTERVAL '4 days'),
  (user2_id, masterclass_id,  NOW() - INTERVAL '1 day'),
  (user3_id, fundamentals_id, NOW() - INTERVAL '8 days'),
  (user3_id, bundle_id,       NOW() - INTERVAL '3 days'),
  (user3_id, masterclass_id,  NOW() - INTERVAL '3 hours'),
  (user4_id, toolkit_id,      NOW() - INTERVAL '23 days'),
  (user5_id, masterclass_id,  NOW() - INTERVAL '20 days'),
  (user6_id, toolkit_id,      NOW() - INTERVAL '18 days'),
  (user7_id, bundle_id,       NOW() - INTERVAL '14 days'),
  (user8_id, fundamentals_id, NOW() - INTERVAL '11 days');

  -- =========================================================
  -- STEP 10: SEED — OTO OFFERS
  -- =========================================================

  -- After buying Email Marketing 101 → 30% off Social Media Toolkit (15 min window)
  INSERT INTO oto_offers (source_product_id, oto_product_id, discount_type, discount_value, duration_minutes, is_active, display_order)
  VALUES (fundamentals_id, toolkit_id, 'percentage', 30, 15, true, 1);

  -- After buying Social Media Toolkit → $20 off Sales Funnel Blueprint (20 min window)
  INSERT INTO oto_offers (source_product_id, oto_product_id, discount_type, discount_value, duration_minutes, is_active, display_order)
  VALUES (toolkit_id, blueprint_id, 'fixed', 20, 20, true, 1);

  -- After buying Email Masterclass → 40% off Group Coaching (30 min window)
  INSERT INTO oto_offers (source_product_id, oto_product_id, discount_type, discount_value, duration_minutes, is_active, display_order)
  VALUES (masterclass_id, mentoring_id, 'percentage', 40, 30, true, 1);

  -- =========================================================
  -- STEP 11: SEED — ADDITIONAL PRODUCTS (showcase OTO & redirect features)
  -- =========================================================
  -- Slugs are intentionally stable — referenced by E2E test fixture helpers.

  INSERT INTO products (
    name, slug, description, icon, price, currency, vat_rate, price_includes_vat,
    features, is_active, success_redirect_url, pass_params_to_redirect
  ) VALUES
  (
    'Instagram Reels Playbook', 'test-oto-active',
    'Compact playbook covering 30 proven Reels formats that grow accounts without dancing or lip-sync.',
    '📲', 19.99, 'USD', 23.00, true,
    '[{"title": "What''s inside", "items": ["30 Reels format breakdowns", "Hook library (60 openers)", "B-roll shot list template", "Caption formula guide"]}, {"title": "After purchase", "items": ["Instant PDF download", "Canva template access", "Bonus offer available"]}]'::jsonb,
    true, NULL, false
  ),
  (
    'YouTube SEO Cheatsheet', 'test-product-redirect',
    'One-page reference guide covering every YouTube ranking factor — title formulas, tags, thumbnails, and upload timing.',
    '▶️', 29.99, 'USD', 23.00, true,
    '[{"title": "What you get", "items": ["1-page SEO reference PDF", "Title formula bank (20 patterns)", "Tag research mini-guide", "Thumbnail contrast tips"]}, {"title": "Bundle up", "items": ["Pairs perfectly with Email Marketing 101", "Learn to convert viewers into subscribers"]}]'::jsonb,
    true, '/p/email-marketing-101', true
  ),
  (
    'Freelancer Client Finder Kit', 'test-custom-redirect',
    'Step-by-step system for landing your first 3 freelance clients using LinkedIn and cold email — no portfolio required.',
    '🤝', 39.99, 'USD', 23.00, true,
    '[{"title": "The system", "items": ["LinkedIn profile optimisation guide", "Cold email sequence (5 templates)", "Proposal template (3 formats)", "Objection-handling scripts"]}, {"title": "Who it''s for", "items": ["New freelancers", "Designers, writers, marketers", "Anyone leaving a 9-5"]}]'::jsonb,
    true, 'https://google.com', true
  ),
  (
    'Podcast Launch Blueprint', 'test-oto-owned',
    'Everything you need to record, edit, and launch a podcast — without spending on studio equipment.',
    '🎙️', 24.99, 'USD', 23.00, true,
    '[{"title": "Launch checklist", "items": ["Equipment setup guide (budget & pro)", "Recording & editing workflow", "Show notes template", "Spotify & Apple submission guide"]}, {"title": "Includes", "items": ["Episode title formula", "Guest pitch email template", "First 10 episodes content plan"]}]'::jsonb,
    true, NULL, false
  ),
  (
    'Content Repurposing Playbook', 'test-no-redirect',
    'Turn one piece of content into 10. A repeatable system for repurposing blog posts, videos, and podcasts across all platforms.',
    '♻️', 14.99, 'USD', 23.00, true,
    '[{"title": "The system", "items": ["Content audit worksheet", "Platform-by-platform format guide", "Weekly repurposing workflow", "Batch scheduling template"]}, {"title": "Works for", "items": ["Solopreneurs", "Content creators", "Small marketing teams"]}]'::jsonb,
    true, NULL, false
  ),
  (
    'Quick-Start Email Templates', 'test-oto-target',
    '30 plug-and-play email templates for every stage of your list — welcome, nurture, promotional, and re-engagement.',
    '✉️', 9.99, 'USD', 23.00, true,
    '[{"title": "30 templates included", "items": ["5 welcome sequence emails", "8 nurture / value emails", "10 promotional emails", "7 re-engagement emails"]}, {"title": "Format", "items": ["Plain-text & HTML versions", "Compatible with all ESPs", "Subject line variants included"]}]'::jsonb,
    true, NULL, false
  );

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

  -- john.doe owns test-oto-target (OTO is skipped for test-oto-owned)
  INSERT INTO user_product_access (user_id, product_id, access_granted_at)
  VALUES (user1_id, (SELECT id FROM products WHERE slug = 'test-oto-target'), NOW() - INTERVAL '7 days');

  -- =========================================================
  -- STEP 12: SEED — VARIANT GROUPS
  -- =========================================================

  -- Group 1: Email Marketing Track — tiered learning path (Foundation → Advanced → Expert)
  INSERT INTO variant_groups (name, slug) VALUES ('Email Marketing Track', 'email-marketing-track');

  INSERT INTO product_variant_groups (product_id, group_id, variant_name, display_order, is_featured) VALUES
  (fundamentals_id, (SELECT id FROM variant_groups WHERE slug = 'email-marketing-track'), 'Foundation',      0, false),
  (masterclass_id,  (SELECT id FROM variant_groups WHERE slug = 'email-marketing-track'), 'Advanced',        1, true),
  (mentoring_id,    (SELECT id FROM variant_groups WHERE slug = 'email-marketing-track'), 'Expert Coaching', 2, false);

  -- Group 2: Creator Suite — growing value at each tier
  INSERT INTO variant_groups (name, slug) VALUES ('Creator Suite', 'creator-suite');

  INSERT INTO product_variant_groups (product_id, group_id, variant_name, display_order, is_featured) VALUES
  (toolkit_id,   (SELECT id FROM variant_groups WHERE slug = 'creator-suite'), 'Social Only', 0, false),
  (bundle_id,    (SELECT id FROM variant_groups WHERE slug = 'creator-suite'), 'Full Bundle', 1, true),
  ((SELECT id FROM products WHERE slug = 'annual-academy-pass'), (SELECT id FROM variant_groups WHERE slug = 'creator-suite'), 'All Access', 2, false);

  -- Group 3: Coaching Options — workshop → group → VIP
  INSERT INTO variant_groups (name, slug) VALUES ('Coaching Options', 'coaching-options');

  INSERT INTO product_variant_groups (product_id, group_id, variant_name, display_order, is_featured) VALUES
  ((SELECT id FROM products WHERE slug = 'live-launch-workshop'), (SELECT id FROM variant_groups WHERE slug = 'coaching-options'), 'Workshop',   0, false),
  (mentoring_id,                                                  (SELECT id FROM variant_groups WHERE slug = 'coaching-options'), 'Group',      1, true),
  ((SELECT id FROM products WHERE slug = 'vip-coaching'),         (SELECT id FROM variant_groups WHERE slug = 'coaching-options'), 'VIP 1-on-1', 2, false);

END;
$func$;

-- Restrict access: only service_role can call this function
REVOKE ALL ON FUNCTION public.demo_reset_data() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demo_reset_data() FROM anon;
REVOKE ALL ON FUNCTION public.demo_reset_data() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.demo_reset_data() TO service_role;
