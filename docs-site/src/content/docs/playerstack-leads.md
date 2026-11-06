---
title: PlayerStack lead forms
description: Email-confirmed lead magnets and marketing consent from PlayerStack forms.
---

Sellf accepts the hardened `plugin-email-gate` contract. An accepted form returns
`200 {"status":"check_email"}`. Product access and `lead.captured` follow only after
the viewer clicks the email link. Existing accounts receive the same response.
Sellf stores consent evidence; your webhook integration manages the mailing list
and unsubscribe links.

## Product settings

In the product's embed settings, enable embedding. The product must be active,
free, within its availability window, and a one-time product. Configure consent
wording in Polish and English, and a version (1–60 letters, digits, dots, dashes
or underscores). Change the version whenever the wording changes.

**List signup required** defaults to off. With it on, the form explains that the
material is exchanged for joining the newsletter. The checkbox remains unchecked.
Conditioning a service on marketing consent may affect freely given consent under
GDPR Article 7(4) and EDPB Guidelines 05/2020. The seller chooses whether to use
this setting and should review the wording for their circumstances.

## Endpoints

All cross-origin requests, including GET and OPTIONS, require an Origin on the seller's allowed
embed origins list (Settings → embed domains; `SELLF_EMBED_ALLOWED_ORIGINS` fallback).
Credentialed requests are supported. Same-origin browser requests on the Sellf
instance also work when GET omits Origin (Sec-Fetch-Site: same-origin). `product` accepts a slug or UUID, 1–100
characters. `src` is an HTTPS video URL, at most 2048 characters, recorded only as
source; it never chooses the product or a redirect.

- `GET /api/leads/challenge?product=<slug-or-uuid>` returns `{altcha, nonce}`.
  The nonce belongs to that product, Origin and ALTCHA challenge; it expires in
  ten minutes and is consumed by the first POST, including rejected submissions.
- `POST /api/leads/submit?product=<slug-or-uuid>` accepts JSON
  `{email, src, product?, nonce, altcha, marketingConsent?, consentVersion?, consentText?}`.
  Keep the product in the query for preflight and in the body for submission.
  `altcha` can be a solution object or base64-encoded solution JSON. A retry needs
  a new challenge and nonce. IP/email limits return 429; invalid input/consent
  returns 400; unavailable, paid or disabled products return 404.
- `GET /api/products/<slug-or-uuid>/playerstack?locale=pl` returns a public
  configuration with `src` (the preview video), title, `emailGate` and both
  `marketingConsent.pl` / `.en` variants. English is the default. No private
  content-delivery configuration is returned. The integrator supplies trusted
  webhook/challenge URLs separately, and a video src if no preview is configured.

The wire consent version includes the language suffix, for example `1:pl`.
Send the returned version verbatim. With `marketingConsent: true`, Sellf stores its
canonical text for that version and language. Client `consentText` is supplemental.
Without consent, free access remains available unless required by the product.
A list-only form omits `product` in both requests and requires consent. It uses the
instance embed allowlist and the default PL/EN wording/version `1:pl` / `1:en`
from `src/lib/leads/config.ts`.

## Integration with PlayerStack

### Trusted Sellf origin (PlayerStack 90b5f28 or later)

For an HTTPS instance, the API supplies absolute `emailGate.webhookUrl` and
`emailGate.challengeUrl` from the configured Sellf origin. Request headers never
choose these addresses. Authorize that origin in the adapter:

```js
import { createSellfConfigProvider } from '@playerstack/plugin-sellf-adapter';
const base = 'https://your-sellf.example';
const provider = createSellfConfigProvider({
  baseUrl: base,
  trustedOrigins: [new URL(base).origin],
});
const element = document.querySelector('player-stack');
element.setAttribute('data-sellf-product', 'free-guide');
const config = await provider.load(element);
// Use config with your PlayerStack host, or register provider in your host.
```

The response includes the product in each endpoint's query so preflight uses the
correct seller allowlist. There is no playback analytics collector in Sellf, so
`analytics.endpoint` is omitted.

### Integrator endpoints (also works with PlayerStack 8baee66)

Explicit integrator endpoints always take priority, including when trustedOrigins
is also configured. Use this variant for older adapters or local HTTP testing:

```js
import { createSellfConfigProvider } from '@playerstack/plugin-sellf-adapter';
const product = 'free-guide';
const base = 'https://your-sellf.example';
const provider = createSellfConfigProvider({
  baseUrl: base,
  fetchOptions: { credentials: 'include', headers: { 'Accept-Language': 'en' } },
  endpoints: { emailGate: {
    challenge: `${base}/api/leads/challenge`,
    webhook: `${base}/api/leads/submit?product=${encodeURIComponent(product)}&locale=en`,
  } },
});
```

The API advertises automatic endpoint URLs only for an HTTPS configured origin;
HTTP loopback development uses explicit integrator endpoints. Set a video `src`
attribute on the element if the product has no preview video. An explicit
`?locale=pl` takes priority over the first Accept-Language preference; otherwise
English is the default. The API returns 14 localized form messages, `at: "after"`,
`altchaFormat: "base64"`, and `remember: false`, plus consent and privacy wording
within the adapter's text limits. A pre-roll host can choose `at: "before"` in its
trusted configuration. Any 2xx means accepted; the viewer still confirms by email.


An unchecked optional consent omits `consentVersion` in the pinned adapter. Set the form language on the trusted submit endpoint with `?locale=pl` or `?locale=en`; Sellf retains it for the confirmation mail and `customer.locale` regardless of consent. Without this query, the consent version language or Accept-Language supplies the language.

## Confirmed webhook

Subscribe to `lead.captured` in Sellf's webhook settings. It uses the ordinary signed
webhook envelope and delivery queue. For this form, `data` contains `leadId`,
`customer: {email, userId}`, `product: {id, slug, name}` (null for list-only), `source`,
`capturedAt`, `confirmedAt`, `marketingConsent`, `consentVersion`, and
`consentConfirmedAt` (null without marketing consent). A separate submission gets
a separate lead ID. Reopening its confirmation does not create another delivery
to the same endpoint. Deduplicate receiver processing by the delivery envelope ID.

Only add the viewer to a marketing list when `marketingConsent === true` and
`consentConfirmedAt` is present. Unconfirmed submissions never emit this event;
their pending records expire after one day. Confirmed evidence is retained in
`lead_submissions`, readable with service-role credentials only.
Other `lead.captured` producers can have a different payload; the consent fields
above describe PlayerStack submissions.
