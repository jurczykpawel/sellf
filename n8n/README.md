# n8n Integration Workflows

Ready-made n8n workflows built on Sellf's signed webhooks and REST API.

Each workflow ships in two languages - the logic is byte-identical, only the sticky-note text differs:

- `*.json` - English sticky notes
- `*-PL.json` - polskie sticky notes (node names and code stay English either way)

Import whichever file matches your preference (n8n → Workflows → Import from File).

> Every Sellf webhook delivery is HMAC-signed (`X-Sellf-Signature`, Stripe-style `t=...,v1=...`)
> and every webhook workflow here verifies the signature before trusting the payload. The Code
> node doing that needs `NODE_FUNCTION_ALLOW_BUILTIN=crypto` in your n8n environment.

| Workflow | Files | What it does |
|---|---|---|
| **Webhook starter** | `sellf-webhooks-handler` | Verify + route every event type to its own lane - the base to build on |
| **Sales log** | `sellf-purchase-google-sheets` | Every sale becomes a Google Sheets row, deduplicated by Stripe session |
| **Waitlist → Listmonk** | `sellf-waitlist-collection` | Pre-launch signups land on a Listmonk list with product attributes |
| **Lead nurture** | `sellf-lead-nurture` | Free-product leads join Listmonk, then get a follow-up email after 3 days |
| **Daily sales report** | `sellf-daily-sales-report` | Revenue/orders/users/top products on Telegram every morning |
| **Refund alerts** | `sellf-refund-alert` | Pending refund requests ping Telegram every 15 minutes |
| **Webhook monitor** | `sellf-failed-webhooks-monitor` | Failed deliveries: Telegram alert + automatic retry via the Sellf API |
| **Purchase → iFirma** | `sellf-purchase-ifirma` | B2B purchases become paid iFirma VAT invoices (HMAC-SHA1 request auth) |
| **Purchase → Fakturownia** | `sellf-purchase-fakturownia` | B2B purchases become paid Fakturownia VAT invoices |
| **Purchase → wFirma** | `sellf-purchase-wfirma` | B2B purchases become paid wFirma invoices (gross→net conversion) |
| **Invoice + thank-you** | `sellf-purchase-invoice-delivery` | B2B gets the invoice first, everyone gets your thank-you email |
| **Win-back** | `sellf-access-expired-winback` | Expired access → friendly note → personal coupon two days later |
| **Purchase → KSeF** | `sellf-ksef` | B2B purchases become KSeF e-invoices (mirror - see [KSeF section](#ksef-polish-e-invoicing)) |

### Shared setup

1. **Sellf webhook endpoint** (webhook-triggered workflows): Sellf admin → **Settings → Webhooks** →
   Add endpoint with the workflow's Production URL → copy the signing secret into `Configuration (EDIT ME)`.
   Use the endpoint's **Send test** button to prove the pipeline end to end.
2. **Sellf API key** (API-calling workflows): Sellf admin → **Settings → API keys**.
3. Fill in the rest of `Configuration (EDIT ME)` per the workflow's yellow overview note.

### KSeF (Polish e-invoicing)

`sellf-ksef.json` / `sellf-ksef-PL.json` turn Sellf purchases into KSeF e-invoices via
[KSeF Gateway](https://github.com/jurczykpawel/ksef-gateway). These two files are a **read-only
mirror** - the source of truth is `examples/n8n/` in that repo, where they are maintained and
tested. Local review may correct explanatory notes without changing execution logic: `.github/workflows/sync-ksef-example.yml` periodically overwrites
this copy with the upstream version, including those notes.


#### KSeF setup and operating limits

1. Import one language version and configure the gateway URL and seller details in
   **Configuration (EDIT ME)**. Subscribe the Sellf webhook endpoint to
   `purchase.completed` and keep the default event payload (no custom field mapping).
2. In **Send to KSeF Gateway**, select an n8n **Header Auth** credential with header
   `X-Api-Key` and your gateway API key. Credentials are not included in the export.
3. Set `SELLF_WEBHOOK_SECRET` in the execution environment, or replace the
   `webhookSecret` placeholder in Configuration. Environment takes precedence.
   The Configuration fallback is visible in workflow exports and node output;
   never share an export containing a real secret. Self-hosted environment access
   requires `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`; the Code runtime also needs
   `NODE_FUNCTION_ALLOW_BUILTIN=crypto`. Preserve Raw Body and binary data settings.
4. Run on a dedicated single execution instance with production concurrency **1**
   (for example `N8N_CONCURRENCY_PRODUCTION_LIMIT=1` in regular mode). Do not use
   these static-data reservations as a lock across queue workers or instances.
   Check that execution-data saving remains disabled after import.

This is a single-product B2B example for Stripe checkout purchases carrying
`order.sessionId`, one VAT rate and a two-decimal currency such as PLN or EUR.
Bank-transfer orders without a Stripe session, baskets with bumps, mixed tax rates,
other currency minor units, refunds and credit notes require adapting the mapping
before use. Foreign B2C/OSS is outside scope. `invoice.nip` supplies the business
identifier; the buyer country selects NIP, EU VAT ID or foreign tax ID. Configure
`defaultVatRate`, `euB2bVatRate` and `exportVatRate` for your sales; classification
alone does not establish VAT registration or eligibility. Amounts come from
`order.amount` and, when present, `order.netTotal`, in minor units.

The workflow now responds **after processing**, rather than acknowledging first.
Sellf's default outbound request timeout is **5 seconds**; gateway startup, invoice
processing or Wait nodes can exceed it, so Sellf may record a failed delivery and
retry while n8n continues. HTTP 200 means a handled outcome: inspect `success`,
`skipped`, `duplicate`, `status` and `ksefNumber`; monitor handled failures separately.
An error workflow alone does not alert on a handled `success: false` result.

Deduplication retains at most 1,000 order keys in workflow static data. Only completed
production executions persist that state; manual runs, crashes or cancellation after
sending can lose a reservation. Old `sent` entries can be evicted, allowing old orders
to be sent again. Before resending an interrupted, `uncertain` or `not_accepted`
order, reconcile its full invoice identifier in KSeF and preserve the existing state.
For unattended operation across failures, add a durable external reservation/job
store and reconciliation before enabling retries.

The health loop probes at most nine times. Invoice POST has a 120-second timeout
and at most two additional attempts: HTTP 429 with a valid Retry-After up to 300
seconds, or empty/HTML 503 responses. The latter assumes your proxy rejects the
request **before forwarding it**; disable that branch if this is not guaranteed.
Gateway JSON errors and transport timeouts remain uncertain and are not retried.
See the [upstream operating guide](https://github.com/jurczykpawel/ksef-gateway/blob/main/examples/n8n/README.md#commercial-workflow-safety-sellf-and-woocommerce)
for reconciliation and deployment details.
