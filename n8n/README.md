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
tested. Do not edit them here: `.github/workflows/sync-ksef-example.yml` periodically overwrites
this copy with the upstream version.
