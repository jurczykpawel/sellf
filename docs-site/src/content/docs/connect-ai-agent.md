---
title: Connect your AI agent
description: Connect Claude Code, Claude Desktop, Codex or Cursor to Sellf and try three tested MCP recipes.
---

Sellf's MCP server lets your own AI agent draft products, create coupons and read sales analytics through the Sellf API. The server runs locally on your computer over **stdio**; it connects to your Sellf installation over HTTPS. You do not need a hosted MCP endpoint.

## Prepare Sellf and the server

1. Install [Bun](https://bun.sh/) on the computer running your agent and obtain the [Sellf source](https://github.com/jurczykpawel/sellf).
2. Install the MCP package dependencies:

   ```sh
   cd /absolute/path/to/sellf/mcp-server
   bun install
   command -v bun
   ```

3. In Sellf, open **Dashboard → API Keys** (`/dashboard/api-keys`). Creating a key requires a registered or higher license. Create a separate key per workflow with the scopes below; copy it when shown. Explicit scope selection in the admin UI requires Pro; an authenticated admin can also request an explicitly scoped key through `POST /api/v1/api-keys` (see the [API reference](/api/)). Do not accept a full-access default for these recipes.

| Recipe | Exact scopes |
| --- | --- |
| Draft, inspect and publish a product | `products:read`, `products:write` |
| Create and inspect a coupon for a known product ID | `coupons:read`, `coupons:write` |
| Weekly sales report below | `analytics:read` |

Add `products:read` to the coupon key only if the agent must look up the product. The report below needs neither transaction nor user access. Tools such as `get_revenue_stats` use the payments API and need `payments:read` even though their names sound analytical. Do not grant `*`, refunds, user writes or webhook writes for these recipes.

**Keep keys in private local configuration, outside version control.** Never paste a key into a recipe prompt. Use a local Sellf instance for experiments: an `sf_test_` prefix does not create a separate database or make writes harmless. Revoke the key in Sellf when finished.

In all examples replace the Bun path with the result of `command -v bun`, the source path with your absolute path, the URL with your Sellf origin (without `/api/v1`), and the key with the workflow's scoped key. Use HTTPS except for local development, where `http://127.0.0.1:3000` is supported. Windows users should use absolute Windows paths and escape backslashes in JSON.

## Claude Code

Run in your project; `--scope local` keeps this registration out of the shared project MCP file:

```sh
claude mcp add --scope local \
  --env SELLF_API_URL=https://sellf.example.com \
  --env SELLF_API_KEY=REPLACE_WITH_SCOPED_KEY \
  --transport stdio sellf -- \
  /absolute/path/to/bun /absolute/path/to/sellf/mcp-server/src/index.ts
```

Open `/mcp` in Claude Code and check that `sellf` is connected. The command contains your key, so avoid saving it in shell history. See [Claude Code's MCP setup](https://code.claude.com/docs/en/mcp).

## Claude Desktop

Open **Settings → Developer → Edit Config**. The file is `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS or `%APPDATA%\Claude\claude_desktop_config.json` on Windows. Merge this entry into your existing `mcpServers` object:

```json
{
  "mcpServers": {
    "sellf": {
      "command": "/absolute/path/to/bun",
      "args": ["/absolute/path/to/sellf/mcp-server/src/index.ts"],
      "env": {
        "SELLF_API_URL": "https://sellf.example.com",
        "SELLF_API_KEY": "REPLACE_WITH_SCOPED_KEY"
      }
    }
  }
}
```

Fully quit and reopen Claude Desktop, then check its available tools for `sellf`. See the [local MCP server guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

## Codex

Add this to your private `~/.codex/config.toml`:

```toml
[mcp_servers.sellf]
command = "/absolute/path/to/bun"
args = ["/absolute/path/to/sellf/mcp-server/src/index.ts"]

[mcp_servers.sellf.env]
SELLF_API_URL = "https://sellf.example.com"
SELLF_API_KEY = "REPLACE_WITH_SCOPED_KEY"
```

Restart the Codex session and check `codex mcp list` or `/mcp` in the CLI. See the [official Codex MCP documentation](https://developers.openai.com/codex/mcp/).

## Cursor

Merge the **same JSON shown for Claude Desktop** into your private `~/.cursor/mcp.json`. Restart Cursor and enable `sellf` in its MCP settings. Avoid a shared `.cursor/mcp.json` containing your key. See [Cursor's MCP setup](https://cursor.com/help/customization/mcp).

## Check the connection

Ask the agent to list Sellf tools, then run a read allowed by your key: `list_products` with `{"limit":1}` for the product key, `list_coupons` with `{"limit":1}` for the coupon key, or `get_top_products` with `{"period":"week","limit":1,"sort_by":"sales"}` for reporting.

If the process cannot start, check the absolute Bun/source paths and run `bun install` in `mcp-server`. If a tool returns 401, check the key and Sellf URL; for 403, check its scopes and that its owner is still an admin. Seeing a tool in the client does not grant permission to use it. After changing keys, restart the MCP connection. Seller permissions are enforced by the API.

## Recipe 1: Draft a product from an offer

Use the product key. Replace the slug with a unique value and paste your own offer text:

```text
Use Sellf MCP. Draft this offer: Automation workbook, 49.99 PLN,
a practical workbook with three exercises. Use slug automation-workbook.
Create a one-time product with description, full description and feature
sections. Keep it inactive and unlisted. Return its ID, admin preview URL
and checkout URL. Do not publish.
```

Expected calls (the real server also defaults `is_active` to false):

```json
{"name":"create_product","arguments":{"name":"Automation workbook","slug":"automation-workbook","price":49.99,"currency":"PLN","description":"A practical workbook with three exercises.","long_description":"Practice automation with three guided exercises.","features":[{"title":"Included","items":["Workbook","Three exercises"]}],"product_type":"one_time","is_listed":false}}
{"name":"get_product","arguments":{"id":"PRODUCT_UUID"}}
```

Check the saved price, currency and features. Product prices use **major units**: `49.99`, not `4999`. Preview while signed in as admin at `https://sellf.example.com/p/automation-workbook?preview=1`. The payment page is `https://sellf.example.com/checkout/automation-workbook`; it becomes available after publication. A draft's public checkout returns 404. Configure Stripe and actual content delivery before selling; drafting the offer does not upload a workbook or charge a buyer.

When ready, explicitly ask: `Publish only product PRODUCT_UUID. Keep it unlisted.` The agent calls `update_product` with `{"id":"PRODUCT_UUID","is_active":true}`. Unlisted products can still be bought through their direct checkout link. To put payment on your own page, enable embedding in Sellf and copy its generated loader snippet; MCP does not deploy your website.

## Recipe 2: Create a coupon

Use the coupon key and a known product UUID. Choose a unique code:

```text
Use Sellf MCP. Create active coupon WORKBOOK20: 20% off only product
PRODUCT_UUID, 10 total uses, once per email, exclude order bumps.
Read it back and show the restrictions. Do not change the product.
```

```json
{"name":"create_coupon","arguments":{"code":"WORKBOOK20","discount_type":"percentage","discount_value":20,"is_active":true,"allowed_product_ids":["PRODUCT_UUID"],"usage_limit_global":10,"usage_limit_per_user":1,"exclude_order_bumps":true}}
{"name":"get_coupon","arguments":{"id":"COUPON_UUID"}}
```

Verify the returned code, product restriction and limits. An empty product restriction applies broadly, so keep the UUID. `20` means 20%; for a fixed discount, use major units and specify its currency. This recipe creates a live coupon and does not redeem it. To undo it, use `deactivate_coupon` with its ID, or delete an unused test coupon with `delete_coupon`.

## Recipe 3: Weekly sales report

Use a separate **`analytics:read` only** key:

```text
Use Sellf MCP with analytics:read only. Produce a sales report for the
trailing seven days using get_top_products(period="week", limit=50,
sort_by="sales"). State the returned start date and generation time.
Show completed sales and revenue per product and currency. Convert minor
units using each currency's exponent. Never add currencies together.
Explain that the report covers at most 50 returned products; if the limit
is reached, say it may be incomplete. Do not forecast or claim a
previous-week comparison. Do not mutate anything.
```

```json
{"name":"get_top_products","arguments":{"period":"week","limit":50,"sort_by":"sales"}}
```

Use `filters.start_date`, `generated_at` and each product's `by_currency` values. For PLN/USD, `4999` minor units is `49.99`. The current product price is in major units and may differ from historical sales. This is a trailing seven-day window in the API server's timezone, not the previous calendar week. The report counts completed transactions; it does not measure profit or refund-adjusted net sales. Totals cover only returned products; mixed-currency totals must not be labelled as one currency.

## Recipe 3b: Where did purchases come from?

Same **`analytics:read` only** key:

```text
Use Sellf MCP. Where did purchases from the last 3 days come from?
Show a table: channel / source / medium / campaign / content / orders / net.
Amounts are in major units per currency; never add currencies together.
```

```json
{"name":"get_purchase_attribution","arguments":{}}
```

No arguments means the last 3 days and the last touch. `touch: "first"` reports the first known
visit, `group_by` changes the dimensions. Net revenue already subtracts refunds. Details:
[Purchase sources](/purchase-attribution/).

## Recipe 4: B2B cart

Use a key with `products:read`, `products:write`, `coupons:read`, `coupons:write`.
For a WiR workshop, ask the agent to call `create_product` with a draft (`is_active: false`),
a 67 PLN price, `issue_license_on_purchase: false` and this `checkout_profile`:

```json
{
  "v": 1,
  "modules": [
    {
      "id": "buyer",
      "types": [
        "organization"
      ],
      "gus": false,
      "bank_transfer_for": [
        "organization"
      ]
    },
    {
      "id": "recipient",
      "for": [
        "organization"
      ]
    },
    {
      "id": "phone",
      "required": true
    },
    {
      "id": "quantity",
      "min": 1,
      "max": 50,
      "mode": "product_page"
    },
    {
      "id": "participants",
      "required": true,
      "prefill_from_buyer": true
    }
  ]
}
```

Then call `create_coupon` with `{"code":"WIR30","discount_type":"set_price","discount_value":30,"currency":"PLN","allowed_product_ids":["RETURNED_PRODUCT_UUID"]}`.
Have the agent read both records back for review before activating the product.
The buyer is an organization; the recipient may differ, phone is required, and
participant count follows quantity (set `allow_later: true` on `participants` to let buyers pay first and add participants later; no reminder e-mail is sent). Transfers require shop bank details and the
payment setting to be enabled. This recipe does not change those settings or place an order.
After publication, share `/checkout/SLUG?coupon=WIR30`. Each unit costs 30 PLN at
either the 47 or 67 PLN event tier; bumps keep their price. The agent can add event
sessions and tiers using the product's `sessions` and `tiers` fields. Delete the unused coupon and draft after a trial.

## Verification and cleanup

These recipes are exercised by [`mcp-server/tests/recipes.e2e.ts`](https://github.com/jurczykpawel/sellf/blob/main/mcp-server/tests/recipes.e2e.ts): an SDK client starts the real stdio process against local Sellf, uses separate scoped keys, reads the created product/coupon back, checks the explicitly published checkout page, and checks a weekly report against synthetic completed/pending and older transactions in two currencies. The test deletes its fixtures and keys. It does not run an AI model or complete a Stripe charge.

Maintainers can run it with local Sellf already running, from `mcp-server`:

```sh
SELLF_RECIPE_E2E=1 SELLF_API_URL=http://127.0.0.1:3000 \
  bun --env-file=../admin-panel/.env.local run test
```

The test needs local Supabase service credentials to provision and remove fixtures; **do not put those credentials in an agent's MCP config**. `SELLF_BUN_PATH` can select an absolute Bun executable. Set `SELLF_RECIPE_TRANSCRIPT` to a private file path to record exact prompts, tool arguments and results. No database reset is needed. For manual trials, delete the unused test coupon and product by their returned IDs; never delete real payment history to clean up a recipe.
