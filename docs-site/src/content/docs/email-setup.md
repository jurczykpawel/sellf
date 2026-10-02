---
title: "E-mails: templates and sending from your own domain"
description: "Configure Supabase SMTP, verify your sending domain, upload Sellf's authentication templates, and test a login link."
---

Supabase Auth sends Sellf's login emails. Configure delivery **in Supabase**, even if you cannot yet log in to your shop.

## 1. Why use your own SMTP?

Supabase's built-in email service is for testing, with a Supabase sender rather than your brand. Delivery is best-effort; messages may land in spam. It currently sends only to addresses belonging to your project's organization team, with a limit of **2 messages per hour**. It is not a production email service. See [Supabase's SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp).

Custom SMTP lets you send customer login emails from your own domain. You need your shop URL, access to your domain's DNS, and an email provider with SMTP credentials.

## 2. Configure SMTP in Supabase

### Supabase Cloud

1. Open your project in the [Supabase dashboard](https://supabase.com/dashboard).
2. Go to **Authentication → Emails → SMTP Settings** and turn on **Enable custom SMTP**.
3. Fill in the fields below using your provider's settings.
4. Click **Save changes**.

| Dashboard field | What to enter |
|---|---|
| **Host** | Your provider's SMTP hostname |
| **Port number** | The port specified by your provider |
| **Username** | Your SMTP username |
| **Password** | Your SMTP password or the credential your provider requires for SMTP |
| **Sender email address** | An address on your verified domain, such as `login@your-shop.com` |
| **Sender name** | Your shop's name |

Enter secrets directly in the dashboard, never in an AI chat. These labels are checked against the [Supabase SMTP form](https://github.com/supabase/supabase/blob/master/apps/studio/components/interfaces/Auth/SmtpForm/SmtpForm.tsx); the navigation is documented in the [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod).

Custom SMTP initially sets a **30 messages/hour** limit. Review **Authentication → Rate Limits** and adjust it for expected traffic within your provider's limits. The SMTP form also has **Minimum interval per user**; Supabase's default magic-link cooldown is 60 seconds. Sellf applies its own request limits too, so avoid repeatedly requesting test links. See [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).

### Self-hosted Supabase / GoTrue

Configure these variables on the **Supabase Auth service**, not the Sellf container:

```env
GOTRUE_SMTP_HOST=smtp.your-provider.example
GOTRUE_SMTP_PORT=587
GOTRUE_SMTP_USER=your-smtp-user
GOTRUE_SMTP_PASS=<set privately in your environment>
GOTRUE_SMTP_ADMIN_EMAIL=login@your-shop.com
GOTRUE_SMTP_SENDER_NAME=Your shop
```

Use your provider's actual host and port. In the official Docker stack, `.env` uses `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_ADMIN_EMAIL`, and `SMTP_SENDER_NAME`; Compose maps them to `GOTRUE_SMTP_*`. Check your stack's mapping and recreate the Auth service to load changes. See the [Auth configuration reference](https://github.com/supabase/auth#email), [Docker Compose mapping](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml), and [full-stack guide](/full-stack/).

## 3. Choose an email provider

Look for **transactional email through SMTP**, domain verification with **DKIM**, delivery/bounce logs, and limits that fit your shop. If EU processing matters, check the provider's region options and data-processing terms before choosing.

Options include Resend, Postmark, Brevo, Amazon SES, Mailgun, or your own mail server. Supabase lists [compatible SMTP services](https://supabase.com/docs/guides/auth/auth-smtp); Mailgun documents [SMTP delivery](https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/send-smtp) and an [EU region](https://help.mailgun.com/hc/en-us/articles/360007512013-Can-I-transfer-my-domain-to-another-region-US-to-EU-EU-to-US). Your own server means maintaining its authentication, reputation, and delivery yourself.

Disable click tracking for authentication emails: it can rewrite login links. See [Supabase's production checklist](https://supabase.com/docs/guides/deployment/going-into-prod).

## 4. Verify your sending domain in DNS

Add your sending domain to your provider, then copy **its exact DNS names, record types, and values** into your DNS panel.

| Setting | What it does |
|---|---|
| SPF | Lists the servers allowed to send for the envelope-sender domain. |
| DKIM | Adds a signature recipients can check against your domain's public key. |
| DMARC | Defines reporting and handling of messages that fail authentication aligned with the visible From domain. |
| Return-path | Receives bounce messages; a provider may use a dedicated subdomain to support SPF alignment. |

Get SPF, DKIM, and return-path records from your provider; use its DMARC guidance to choose a policy for your domain. Do not replace unrelated mail records or add a second SPF record at the same name. Start with DMARC monitoring if you have not checked all legitimate senders.

Wait for DNS propagation, then use your provider's domain verification button. A green verification result is the first check; test an actual message in step 7. References: [domain verification](https://resend.com/docs/dashboard/domains/introduction), [DMARC policies](https://resend.com/blog/dmarc-policy-modes), and [custom return-path](https://resend.com/changelog/custom-return-path).

## 5. Upload Sellf's templates

Use the HTML files in [`supabase/templates/`](https://github.com/jurczykpawel/sellf/tree/main/supabase/templates) from your Sellf checkout. They contain Polish text; you can translate the visible text for your shop.

### Dashboard

Open **Authentication → Emails → Templates** ([menu layout](https://github.com/supabase/supabase/blob/master/apps/studio/components/layouts/AuthLayout/AuthEmailsLayout.tsx), [Email Templates documentation](https://supabase.com/docs/guides/auth/auth-email-templates)). For each template, paste the **entire HTML file** into the body editor, set a suitable subject, and save.

| File | Authentication template | Management API field |
|---|---|---|
| `magic-link.html` | Magic link | `mailer_templates_magic_link_content` |
| `confirmation.html` | Confirm sign up | `mailer_templates_confirmation_content` |
| `invite.html` | Invite user | `mailer_templates_invite_content` |
| `recovery.html` | Reset password | `mailer_templates_recovery_content` |
| `email-change.html` | Change email address | `mailer_templates_email_change_content` |

### Management API

The [`templates/README.md`](https://github.com/jurczykpawel/sellf/blob/main/supabase/templates/README.md#opcja-2-api-management-cloud) gives this alternative. Set `SUPABASE_ACCESS_TOKEN` privately in your shell environment; it is a **Management API access token**, not the project's anon or service-role key. Replace `{project_ref}` and the HTML placeholder before running:

```bash
curl -X PATCH "https://api.supabase.com/v1/projects/{project_ref}/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mailer_templates_magic_link_content": "<JSON-escaped contents of magic-link.html>"
  }'
```

Repeat with the matching field and file in the table. HTML must be JSON-escaped, including quotes and newlines; use a JSON encoder rather than pasting raw HTML into the string. The [Supabase template documentation](https://supabase.com/docs/guides/auth/auth-email-templates) verifies this endpoint and the fields.

### Self-hosted template URLs

GoTrue fetches templates over HTTP. Set the following on the Auth service and ensure it can reach these URLs. If you put them in `.env`, also map them into `auth.environment` in Compose; adding a new `.env` variable alone does not pass it to the container. Recreate the Auth service after changing its environment:

```env
GOTRUE_MAILER_TEMPLATES_MAGIC_LINK=https://your-shop.com/auth-email-templates/magic-link.html
GOTRUE_MAILER_TEMPLATES_CONFIRMATION=https://your-shop.com/auth-email-templates/confirmation.html
GOTRUE_MAILER_TEMPLATES_INVITE=https://your-shop.com/auth-email-templates/invite.html
GOTRUE_MAILER_TEMPLATES_RECOVERY=https://your-shop.com/auth-email-templates/recovery.html
GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGE=https://your-shop.com/auth-email-templates/email-change.html
```

Sellf serves these files. If a URL is unreachable or invalid, GoTrue falls back to its default template. See [self-hosted templates](https://supabase.com/docs/guides/self-hosting/custom-email-templates).

### Customise the appearance safely

Change colours, visible text, subjects, and the logo; use an absolute HTTPS URL for a replacement image. Preserve template variables and authentication links exactly as supplied.

Sellf's **magic-link and confirmation** templates use `{{ .RedirectTo }}` and `{{ .TokenHash }}`. Keep their spelling, case, braces, `token_hash`, `type`, and `&` separators unchanged. `RedirectTo` already includes the callback path and a query string supplied by Sellf. Do not substitute `{{ .SiteURL }}` or the stock `{{ .ConfirmationURL }}` for these links.

The supplied **invite, recovery, and email-change** files currently use `{{ .ConfirmationURL }}`. Preserve those as supplied too; uploading them is not proof that these separate flows work. Test each enabled flow before relying on it. [Supabase documents what each variable means](https://supabase.com/docs/guides/auth/auth-email-templates#terminology).

## 6. Set the shop and redirect URLs

In Supabase Cloud, go to **Authentication → URL Configuration**:

1. Set **Site URL** to your shop's public URL, for example `https://your-shop.com`.
2. Add `https://your-shop.com/**` under **Redirect URLs** and save.
3. Set Sellf's own `SITE_URL` environment variable to the same shop URL.

The allow-list entry accepts the callback paths and query strings generated by Sellf. Add each shop domain you actually use; do not allow arbitrary domains. Supabase explains [Site URL and wildcard matching](https://supabase.com/docs/guides/auth/redirect-urls).

If the callback redirect is not allowed, Supabase can fall back to Site URL. With Sellf's template, the resulting email can contain a malformed link such as:

```text
https://your-shop.com&token_hash=...
```

It lacks `/auth/callback` and the start of the query string. Check the allow list first, then request a **fresh** login email.

**Sellf ≥ 2026.10.3 builds links from `SITE_URL` at runtime.** Set it on the running instance; a prebuilt release does not know your shop's domain. This does not replace Supabase's Site URL or Redirect URLs settings.

For self-hosted Auth, use `GOTRUE_SITE_URL=https://your-shop.com` and `GOTRUE_URI_ALLOW_LIST=https://your-shop.com/**` (or the corresponding `.env` inputs mapped by your stack). See [Auth configuration](https://supabase.com/docs/guides/self-hosting/auth/config).

## 7. Test the complete login

1. Open your shop's `/login` page and request a link to your own inbox.
2. Check the inbox and spam folder: the sender name and From domain should be yours.
3. Inspect the link privately. It should point to your shop's `/auth/callback` with `token_hash` and `type`; do not share the live token.
4. Click it once and confirm you are signed in. A plain login sends admins to `/dashboard` and other users to `/my-products`.
5. Check the provider's delivery log and message headers for SPF, DKIM, and DMARC results.
6. For a spam-score check, use a disposable test account with a mail-testing service such as [mail-tester](https://www.mail-tester.com/). A login email gives the recipient account access, so never send a real customer's or admin's link to a third-party tester. A good score does not guarantee inbox delivery.

If delivery fails, check provider verification and Supabase Auth logs. If the link fails, check step 6 and the uploaded HTML. Test other enabled email flows separately.

## 8. Copy this prompt for an AI agent

Use it with Claude Code, Codex, or ChatGPT with tools:

```text
Help me configure authentication emails for MY Sellf shop using the guide at https://docs.sellf.app/email-setup/.

First ask for my shop URL, Sellf version, Supabase project reference (or self-hosted stack), email provider, DNS provider, sender address/name, expected volume, and whether EU processing is required. Ask for missing non-secret SMTP host/port/username values when needed.

Never ask me to paste passwords, API keys, access tokens, service-role keys, or live login links into chat. Have me enter secrets directly in the dashboard or private environment variables. Use authorised tools without printing secrets; redact logs.

Verify current official Supabase/provider documentation. Walk me through provider choice, DNS (SPF, DKIM, DMARC, return-path), custom SMTP, and rate limits. For Cloud use Authentication → Emails → SMTP Settings; for self-hosted map GOTRUE_SMTP_* into the Auth service.

Upload all five Sellf templates from my release via the dashboard or Management API, or configure self-hosted template URLs. Preserve all supplied authentication links, especially TokenHash and RedirectTo in magic-link/confirmation; change only branding and visible text.

Set Supabase Site URL, allow https://MY-SHOP-DOMAIN/** in Redirect URLs, and check Sellf SITE_URL (runtime in ≥ 2026.10.3). Diagnose links missing /auth/callback.

Guide a real shop login test, sender/domain and DNS-authentication checks, and a spam-score test using a disposable account. Test other enabled flows separately. Report verified results and anything still untested; do not claim success from settings alone.
```
