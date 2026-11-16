---
title: Connect your AI agent
description: Connect Claude Code, Claude Desktop, Codex or Cursor to your Sellf's built-in MCP endpoint and try tested recipes.
---

Every Sellf instance has a built-in MCP endpoint at **`https://YOUR-SELLF/api/mcp`** (Streamable HTTP). Your AI agent connects to it with a Sellf API key and can then draft products, create coupons or read sales reports. Nothing to install on the Sellf side.

The tools are generated from the [API description](/api/#api-description-for-agents) (`/api/v1/openapi.json`): one tool per API operation, named after its `operationId` (for example `create_product`). Each call is an ordinary request to `/api/v1` with your key, so scopes, rate limits and the audit log apply exactly as for the API; MCP bypasses nothing. A request body goes under the `body` argument; path and query parameters are arguments by name.

## Prepare a key

In Sellf, open **Dashboard → API Keys** (`/dashboard/api-keys`). Creating a key requires a registered or higher license. Create a separate key per workflow with the scopes below; copy it when shown. Explicit scope selection in the admin UI requires Pro; an authenticated admin can also request an explicitly scoped key through `POST /api/v1/api-keys` (see the [API reference](/api/)). Do not accept a full-access default for these recipes.

| Recipe | Exact scopes |
| --- | --- |
| Draft, inspect and publish a product | `products:read`, `products:write` |
| Create and inspect a coupon for a known product ID | `coupons:read`, `coupons:write` |
| Weekly sales report below | `analytics:read` |

The agent sees only the operations its key's scopes allow (each operation's scope is `x-required-scope` in the API description). Add `products:read` to the coupon key only if the agent must look up the product. Do not grant `*`, refunds, user writes or webhook writes for these recipes. Key management and CSV export are never exposed over MCP.

**Keep keys in private local configuration, outside version control.** Never paste a key into a recipe prompt. Use a local Sellf instance for experiments: an `sf_test_` prefix does not create a separate database or make writes harmless. Revoke the key in Sellf when finished.

In all examples replace `https://sellf.example.com` with your Sellf origin and `sf_live_REPLACE` with the workflow's scoped key. Use HTTPS except for local development, where `http://127.0.0.1:3000/api/mcp` works.

### Full or compact tool list

`/api/mcp` lists one tool per allowed operation. With a full-scope key that is about 100 tools and roughly 190 KB of definitions, which crowds a chat model's context. **`/api/mcp?mode=compact`** exposes just two tools instead: `search_operations` (find operations by words; returns their input schemas) and `call_operation` (`{"operationId": "...", "params": {...}}`). Use compact mode for broad keys and chat clients; a narrowly scoped key works well in the default mode.

## Claude Code

```sh
claude mcp add --transport http --scope local sellf https://sellf.example.com/api/mcp \
  --header "Authorization: Bearer sf_live_REPLACE"
```

`--scope local` keeps the registration (and the key) out of the shared project file. Open `/mcp` in Claude Code and check that `sellf` is connected; a wrong key shows 401. See [Claude Code's MCP setup](https://code.claude.com/docs/en/mcp).

## Claude Desktop

Claude Desktop's configuration file starts local processes, so it reaches a remote endpoint through [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) (requires Node.js). Open **Settings → Developer → Edit Config** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows) and merge:

```json
{
  "mcpServers": {
    "sellf": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://sellf.example.com/api/mcp?mode=compact", "--header", "Authorization:${SELLF_AUTH}"],
      "env": { "SELLF_AUTH": "Bearer sf_live_REPLACE" }
    }
  }
}
```

The header has no space after the colon and its value sits in `env` on purpose: some clients pass arguments containing spaces incorrectly. Fully quit and reopen Claude Desktop, then check its tools for `sellf`.

Connecting from Claude.ai or ChatGPT in the browser (custom connectors) needs OAuth sign-in, which Sellf does not offer yet; it is planned. Until then use one of the clients on this page.

## Codex

In your private `~/.codex/config.toml`:

```toml
[mcp_servers.sellf]
url = "https://sellf.example.com/api/mcp"
bearer_token_env_var = "SELLF_API_KEY"
```

Export `SELLF_API_KEY=sf_live_REPLACE` in the environment that starts Codex, restart the session and check `codex mcp list`. See the [official Codex MCP documentation](https://developers.openai.com/codex/mcp/).

## Cursor

In your private `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "sellf": {
      "url": "https://sellf.example.com/api/mcp",
      "headers": { "Authorization": "Bearer ${env:SELLF_API_KEY}" }
    }
  }
}
```

Restart Cursor and enable `sellf` in its MCP settings. Avoid a shared `.cursor/mcp.json` containing your key. See [Cursor's MCP setup](https://cursor.com/help/customization/mcp).

## Check the connection

Ask the agent to list Sellf tools, then run a read allowed by your key: `list_products` with `{"limit":1}` for the product key, `list_coupons` with `{"limit":1}` for the coupon key, or `get_top_products` with `{"period":"week","limit":1,"sort_by":"sales"}` for reporting. In compact mode the agent first calls `search_operations` (for example `{"query":"list products"}`).

A 401 from `/api/mcp` means a missing, wrong or revoked key (a signed-in panel session is not accepted). A tool result marked as an error carries the API's own response, for example 403 when the key lacks a scope or its owner is no longer an admin. After changing keys, restart the MCP connection.

## Recipe 1: Draft a product from an offer

Use the product key. Replace the slug with a unique value and paste your own offer text:

```text
Use Sellf MCP. Draft this offer: Automation workbook, 49.99 PLN,
a practical workbook with three exercises. Use slug automation-workbook.
Create a one-time product with description, full description and feature
sections. Keep it inactive and unlisted. Return its ID, admin preview URL
and checkout URL. Do not publish.
```

Expected calls (the API also defaults `is_active` to false):

```json
{"name":"create_product","arguments":{"body":{"name":"Automation workbook","slug":"automation-workbook","price":49.99,"currency":"PLN","description":"A practical workbook with three exercises.","long_description":"Practice automation with three guided exercises.","features":[{"title":"Included","items":["Workbook","Three exercises"]}],"product_type":"one_time","is_listed":false}}}
{"name":"get_product","arguments":{"id":"PRODUCT_UUID"}}
```

Check the saved price, currency and features. Product prices use **major units**: `49.99`, not `4999`. Preview while signed in as admin at `https://sellf.example.com/p/automation-workbook?preview=1`. The payment page is `https://sellf.example.com/checkout/automation-workbook`; it becomes available after publication. A draft's public checkout returns 404. Configure Stripe and actual content delivery before selling; drafting the offer does not upload a workbook or charge a buyer.

When ready, explicitly ask: `Publish only product PRODUCT_UUID. Keep it unlisted.` The agent calls `update_product` with `{"id":"PRODUCT_UUID","body":{"is_active":true}}`. Unlisted products can still be bought through their direct checkout link. To put payment on your own page, enable embedding in Sellf and copy its generated loader snippet; MCP does not deploy your website.

## Recipe 2: Create a coupon

Use the coupon key and a known product UUID. Choose a unique code:

```text
Use Sellf MCP. Create active coupon WORKBOOK20: 20% off only product
PRODUCT_UUID, 10 total uses, once per email, exclude order bumps.
Read it back and show the restrictions. Do not change the product.
```

```json
{"name":"create_coupon","arguments":{"body":{"code":"WORKBOOK20","discount_type":"percentage","discount_value":20,"is_active":true,"allowed_product_ids":["PRODUCT_UUID"],"usage_limit_global":10,"usage_limit_per_user":1,"exclude_order_bumps":true}}}
{"name":"get_coupon","arguments":{"id":"COUPON_UUID"}}
```

Verify the returned code, product restriction and limits. An empty product restriction applies broadly, so keep the UUID. `20` means 20%; for a fixed discount, use major units and specify its currency. This recipe creates a live coupon and does not redeem it. To undo it, call `update_coupon` with `{"id":"COUPON_UUID","body":{"is_active":false}}`, or delete an unused test coupon with `delete_coupon`.

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

Then call `create_coupon` with `{"body":{"code":"WIR30","discount_type":"set_price","discount_value":30,"currency":"PLN","allowed_product_ids":["RETURNED_PRODUCT_UUID"]}}`.
Have the agent read both records back for review before activating the product.
The buyer is an organization; the recipient may differ, phone is required, and
participant count follows quantity (set `allow_later: true` on `participants` to let buyers pay first and add participants later; no reminder e-mail is sent). Transfers require shop bank details and the
payment setting to be enabled. This recipe does not change those settings or place an order.
After publication, share `/checkout/SLUG?coupon=WIR30`. Each unit costs 30 PLN at
either the 47 or 67 PLN event tier; bumps keep their price. The agent can add event
sessions and tiers using the product's `sessions` and `tiers` fields. Delete the unused coupon and draft after a trial.

## Verification and cleanup

The endpoint is covered by `admin-panel/tests/api/mcp.test.ts`: the official MCP SDK client talks to a running local Sellf with a key limited to `products:read` (initialize, tool list limited to that scope, a real `get_product` call, an out-of-scope write refused without touching the product, compact search and call) and checks that a missing key and a panel session alone get 401. The recipe arguments above follow the generated tool schemas; the recipes themselves are not run end to end, and nothing here runs an AI model or a Stripe charge.

For manual trials, delete the unused test coupon and product by their returned IDs; never delete real payment history to clean up a recipe.
