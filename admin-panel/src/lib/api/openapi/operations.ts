/**
 * API v1 operation registry: the single description of every `/api/v1` route.
 *
 * One entry per route handler (method + path). Request bodies, query objects and
 * responses reference the zod validators the routes themselves use, so the OpenAPI
 * document (`GET /api/v1/openapi.json`) cannot drift into a second copy. Where a route
 * still validates by hand, the entry carries a short `bodyHint` instead of a schema.
 *
 * Adding a route without an entry here fails `tests/unit/lib/api/openapi-contract.test.ts`
 * in CI, as does a wrong scope or an undeclared query parameter.
 *
 * @see ./spec.ts (document builder)
 * @see src/app/api/v1/openapi.json/route.ts
 */
import { z } from 'zod';
import { API_SCOPES, type ApiScope } from '@/lib/api/scope-constants';
import { ProductArchivedDTO, ProductCreateDTO, ProductDeletionImpactDTO, ProductRelationsDTO, ProductResponseDTO, ProductUpdateDTO } from '@/lib/api/dto/product';
import { TAG_SORT_COLUMNS, TagCreateDTO, TagUpdateDTO } from '@/lib/api/dto/tag';
import { cocreatorPutSchema, cocreatorResponseSchema } from '@/lib/affiliates/cocreator/model';
import { attributionQuerySchema } from '@/lib/attribution/report';
import { checkoutSettingsSchema } from '@/lib/checkout/invoice-recipient-setting';
import { accessLicenseSchema } from '@/lib/license-keys/access';
import { maintenanceChangeSchema, maintenanceStatusSchema } from '@/lib/maintenance/setting';
import { licenseRequestSchema } from '@/lib/license-keys/request';
import { transferOperationSchema } from '@/lib/orders/bank-transfer-admin';
import { exportFiltersSchema } from '@/lib/payments/search';
import { PRODUCT_SORT_COLUMNS } from '@/lib/validations/product';
import { validationResultSchema } from '@/lib/storefront-templates/json';
import { storefrontReadSchema } from '@/lib/storefront-templates/lifecycle';
import { mutationSchema } from '@/lib/storefront-templates/mutations';
import { offerOperationSchema } from '@/lib/storefront-templates/offer-lifecycle';
import { offerConfigSchema } from '@/lib/storefront-templates/phase2-contracts';
import { previewSchema } from '@/lib/storefront-templates/preview';
import { configSchema, revisionSchema } from '@/lib/storefront-templates/schemas';
import { templateCredentialInputSchema, templateLicenseStatusSchema } from '@/lib/storefront-templates/template-credentials';

// ===== TYPES =====

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type AnyObject = z.ZodObject<z.ZodRawShape>;

/** Operation groups, with the description an agent reads before choosing an operation. */
export const API_TAGS = {
  Products: 'Catalogue items: price, delivery, checkout modules, licensing, subscriptions. DELETE archives a product that has history; restore brings it back.',
  Offers: 'The sales page of one product ("offer"): read, edit the draft, validate, preview, publish, roll back. Every write carries expectedRevision (optimistic locking).',
  Templates: 'The storefront (shop home page) template: same lifecycle as offers, plus capabilities and private template license keys.',
  Catalog: 'Tags and variant groups that organise products.',
  Upsells: 'Order bumps (extra product in the checkout) and one-time offers (OTO, shown after purchase).',
  Coupons: 'Discount codes and their usage.',
  Payments: 'Orders and transactions: list, details, metadata, refunds, bank-transfer handling, CSV export.',
  Refunds: 'Refund requests submitted by buyers: review, approve or reject.',
  Users: 'Buyers and their product access (grant, extend, revoke; optional license on grant/revoke).',
  Licenses: 'Signed license keys for licensed products: issue, read, revoke (Pro).',
  Webhooks: 'Outgoing signed webhooks: endpoints, delivery logs, retries, abandoned business events.',
  Analytics: 'Read-only sales metrics and purchase attribution.',
  Settings: 'Shop-level settings: checkout options and tracking/consent integrations.',
  System: 'Instance status, maintenance mode and self-upgrade.',
  'API keys': 'Key management. Panel session only: an API key cannot manage keys.',
  Meta: 'This API description.',
} as const;
export type ApiTag = keyof typeof API_TAGS;

/** Groups whose operations must carry full zod schemas (owner decision 11.1, stage 1). */
export const FULL_SCHEMA_TAGS: readonly ApiTag[] = ['Products', 'Offers', 'Templates'];

export interface ApiOperation {
  operationId: string;
  method: HttpMethod;
  /** OpenAPI path relative to `/api/v1`, e.g. `/products/{id}`. */
  path: string;
  tag: ApiTag;
  summary: string;
  description?: string;
  /** API-key scope the route checks. Absent only together with `auth`. */
  scope?: ApiScope;
  /** `session`: admin panel only (no API key); `public`: no authentication. */
  auth?: 'session' | 'public';
  query?: AnyObject;
  /** `query` is the zod object the route itself parses (static query check skipped). */
  queryFromRoute?: boolean;
  /** JSON request body, from the route's own validator. */
  body?: z.ZodType;
  /** Fields of a body the route still validates by hand (documented, not a schema). */
  bodyHint?: string;
  /** Write operation without a body. */
  noBody?: boolean;
  /** Success payload (inside `data` unless `envelope` says otherwise). */
  response?: z.ZodType;
  /** `data` (default) `{ data }`, `list` `{ data: [], pagination }`, `raw` bare JSON, `empty` 204, `csv` text/csv. */
  envelope?: 'data' | 'list' | 'raw' | 'empty' | 'csv';
  /** Success status codes (default 200). */
  status?: number[];
  /** Hide from the generated MCP layer (W221b). */
  mcpExclude?: boolean;
}

// ===== SHARED FRAGMENTS =====

const cursor = z.string().optional().describe('Opaque cursor from pagination.next_cursor');
const limit = z.number().int().min(1).max(100).optional().describe('Page size (default 20, max 100)');
const page = { cursor, limit };
const uuid = z.uuid();
const sortOrder = z.enum(['asc', 'desc']).optional();

/** One operation of a lifecycle union (`operation` / `action` discriminator), without the routed fields. */
function unionOption(options: readonly AnyObject[], discriminator: string, value: string, drop: string[] = []): AnyObject {
  const option = options.find((candidate) => (candidate.shape[discriminator] as z.ZodLiteral | undefined)?.value === value);
  if (!option) throw new Error(`[openapi] no ${discriminator}=${value} in lifecycle schema`);
  // Rebuilt from the shape (`.omit` refuses refined objects); refinements stay enforced by the route.
  const hidden = new Set([discriminator, ...drop]);
  const shape = Object.fromEntries(Object.entries(option.shape).filter(([field]) => !hidden.has(field)));
  return (option.def.catchall?._zod.def.type === 'never' ? z.strictObject(shape) : z.object(shape)) as AnyObject;
}
const templateBody = (operation: string) => unionOption([...mutationSchema.options, ...storefrontReadSchema.options] as AnyObject[], 'operation', operation);
const offerBody = (operation: string) => unionOption(offerOperationSchema.options as unknown as AnyObject[], 'operation', operation, ['productId']);
const transferBody = (action: string) => unionOption(transferOperationSchema.options as unknown as AnyObject[], 'action', action);

// ===== TEMPLATE / OFFER RESPONSES =====

const mutationResult = z.object({ revision: revisionSchema, validation: validationResultSchema });
const changeSchema = z.object({ path: z.string(), kind: z.enum(['added', 'removed', 'changed']), before: z.unknown(), after: z.unknown() });
const diffResult = z.object({ fromRevision: revisionSchema, toRevision: revisionSchema, changes: z.array(changeSchema), unusedSlots: z.array(z.string()).optional(), validation: validationResultSchema });
const previewResult = z.object({
  revision: revisionSchema, locale: z.enum(['en', 'pl']), fixture: z.string(), expiresAt: z.string(), validation: validationResultSchema,
  effectiveTokens: z.array(z.object({}).loose()), unusedSlots: z.array(z.string()),
  previewPath: z.string().describe('Relative URL of the rendered preview; open it with the same session or key'),
});
const templateRead = z.object({
  revision: revisionSchema, draft: configSchema.nullable(), published: configSchema, effectiveTemplateId: z.string(),
  rights: z.object({}).loose().describe('What the current license tier may change and publish'),
  validation: validationResultSchema, unusedSlots: z.array(z.string()), effectiveTokens: z.array(z.object({}).loose()),
});
const offerRead = z.object({
  productId: uuid, productName: z.string(), productSlug: z.string(), revision: revisionSchema,
  draft: offerConfigSchema.nullable(), published: offerConfigSchema.nullable(), validation: validationResultSchema,
});
const historyResult = z.object({ history: z.array(z.object({ revision: revisionSchema }).loose()) });
const templateConfigDoc = configSchema.describe('Storefront config; any JSON is accepted and checked against this schema');
const offerConfigDoc = offerConfigSchema.describe('Offer config; any JSON is accepted and checked against this schema');

/** Schemas used by several operations, published under readable component names. */
export const API_SCHEMAS: Record<string, z.ZodType> = {
  Product: ProductResponseDTO,
  StorefrontConfig: configSchema,
  OfferConfig: offerConfigSchema,
  ValidationResult: validationResultSchema,
  Revision: revisionSchema,
  MutationResult: mutationResult,
  RevisionDiff: diffResult,
  PreviewResult: previewResult,
};

// ===== OPERATIONS =====

const S = API_SCOPES;

const PRODUCTS: ApiOperation[] = [
  {
    operationId: 'list_products', method: 'GET', path: '/products', tag: 'Products', scope: S.PRODUCTS_READ, envelope: 'list',
    summary: 'List products', description: 'Cursor-paginated. Archived products are hidden unless status=archived.',
    query: z.object({
      ...page,
      search: z.string().max(200).optional().describe('Search in name and description'),
      status: z.enum(['all', 'active', 'inactive', 'archived']).optional(),
      sort_by: z.enum(Object.keys(PRODUCT_SORT_COLUMNS) as [string, ...string[]]).optional(), sort_order: sortOrder,
      embed: z.string().optional().describe('CSV: categories,tags'),
      category: z.string().optional().describe('CSV of category UUIDs or slugs (AND)'),
      tag: z.string().optional().describe('CSV of tag UUIDs or slugs (AND)'),
    }),
    response: ProductResponseDTO,
  },
  {
    operationId: 'create_product', method: 'POST', path: '/products', tag: 'Products', scope: S.PRODUCTS_WRITE, status: [201],
    summary: 'Create a product', description: 'Amounts are in major currency units (29 = 29.00).',
    body: z.intersection(ProductCreateDTO, ProductRelationsDTO), response: ProductResponseDTO,
  },
  {
    operationId: 'get_product', method: 'GET', path: '/products/{id}', tag: 'Products', scope: S.PRODUCTS_READ,
    summary: 'Get a product', query: z.object({ embed: z.string().optional().describe('CSV: categories,tags') }), response: ProductResponseDTO,
  },
  {
    operationId: 'update_product', method: 'PATCH', path: '/products/{id}', tag: 'Products', scope: S.PRODUCTS_WRITE, status: [200, 207],
    summary: 'Update a product', description: 'Partial update. categories/tags/bundleItemIds replace the whole set when present. 207: the product was saved but a category/tag write failed; see _warnings.',
    body: z.intersection(ProductUpdateDTO, ProductRelationsDTO), response: ProductResponseDTO,
  },
  {
    operationId: 'delete_product', method: 'DELETE', path: '/products/{id}', tag: 'Products', scope: S.PRODUCTS_WRITE, status: [200, 204],
    summary: 'Delete or archive a product',
    description: 'A product with orders, licenses, accesses or subscriptions is archived (200 with impact). Without history it is deleted (204). permanent=true deletes an archived product without orders.',
    query: z.object({ permanent: z.enum(['true', 'false']).optional() }), response: ProductArchivedDTO,
  },
  {
    operationId: 'get_product_deletion_impact', method: 'GET', path: '/products/{id}/deletion-impact', tag: 'Products', scope: S.PRODUCTS_READ,
    summary: 'What deleting a product would affect', response: ProductDeletionImpactDTO,
  },
  {
    operationId: 'restore_product', method: 'POST', path: '/products/{id}/restore', tag: 'Products', scope: S.PRODUCTS_WRITE, noBody: true,
    summary: 'Restore an archived product', description: 'The product returns to the list but stays inactive until activated.', response: ProductResponseDTO,
  },
  {
    operationId: 'get_product_cocreator', method: 'GET', path: '/products/{id}/cocreator', tag: 'Products', scope: S.PRODUCTS_READ,
    summary: 'Read the co-creator of a product and their share', response: cocreatorResponseSchema,
    description: 'A co-creator earns a fixed share (percent of the net line amount or a fixed amount) of every one-time purchase, with or without a coupon, added to any partner commission. Payouts of co-creator shares wait until that person accepts the creator terms.',
  },
  {
    operationId: 'set_product_cocreator', method: 'PUT', path: '/products/{id}/cocreator', tag: 'Products', scope: S.PRODUCTS_WRITE,
    summary: 'Assign a co-creator to a product or change their share', body: cocreatorPutSchema, response: cocreatorResponseSchema,
    description: 'One person per product, one-time products only. The person needs an account (e-mail). Only purchases after the change earn the new share; earlier purchases keep what they had. 404 when no account has this e-mail; 400 without partner program settings.',
  },
  {
    operationId: 'delete_product_cocreator', method: 'DELETE', path: '/products/{id}/cocreator', tag: 'Products', scope: S.PRODUCTS_WRITE, envelope: 'empty', status: [204],
    summary: 'Remove the co-creator from future purchases', description: 'Shares already earned stay and follow refunds as before.',
  },
];

const offer = (operationId: string, method: HttpMethod, action: string, summary: string, extra: Partial<ApiOperation>): ApiOperation => ({
  operationId, method, path: `/products/{id}/offer/${action}`, tag: 'Offers', envelope: 'raw', summary, ...extra,
});
const OFFERS: ApiOperation[] = [
  offer('get_offer', 'GET', 'config', 'Read the offer page of a product', { scope: S.TEMPLATES_READ, response: offerRead, description: 'Draft, published config, revision and validation.' }),
  offer('update_offer_draft', 'PUT', 'draft', 'Save the offer draft', { scope: S.TEMPLATES_WRITE, body: offerBody('draft'), response: mutationResult }),
  offer('validate_offer', 'POST', 'validate', 'Validate an offer config without saving', { scope: S.TEMPLATES_READ, body: offerBody('validate').extend({ config: offerConfigDoc }), response: validationResultSchema }),
  offer('preview_offer', 'POST', 'preview', 'Render a preview of an offer revision', { scope: S.TEMPLATES_READ, body: previewSchema, response: previewResult }),
  offer('publish_offer', 'POST', 'publish', 'Publish the offer draft', { scope: S.TEMPLATES_ACTIVATE, body: offerBody('publish'), response: mutationResult }),
  offer('rollback_offer', 'POST', 'rollback', 'Roll the offer back to an earlier revision', { scope: S.TEMPLATES_ACTIVATE, body: offerBody('rollback'), response: mutationResult }),
  offer('reset_offer_field', 'POST', 'reset', 'Reset appearance or density of the offer draft', { scope: S.TEMPLATES_WRITE, body: offerBody('reset'), response: mutationResult }),
  offer('diff_offer', 'POST', 'diff', 'Compare two offer revisions', { scope: S.TEMPLATES_READ, body: offerBody('diff'), response: diffResult }),
  offer('list_offer_history', 'POST', 'history', 'List offer revisions', { scope: S.TEMPLATES_READ, body: offerBody('history'), response: historyResult }),
];

const template = (operationId: string, method: HttpMethod, action: string, summary: string, extra: Partial<ApiOperation>): ApiOperation => ({
  operationId, method, path: `/templates/${action}`, tag: 'Templates', envelope: 'raw', summary, ...extra,
});
const TEMPLATES: ApiOperation[] = [
  template('get_template_capabilities', 'GET', 'capabilities', 'Template capabilities and JSON schemas', {
    scope: S.TEMPLATES_READ, description: 'Installed templates, slots, reset paths, limits and the JSON schemas of every config part. Read this before editing a config.',
    response: z.object({ validatorVersion: z.literal(1), templates: z.array(z.object({}).loose()), schemas: z.record(z.string(), z.unknown()) }).loose(),
  }),
  template('get_template_config', 'GET', 'config', 'Read the storefront config', { scope: S.TEMPLATES_READ, response: templateRead }),
  template('update_template_draft', 'PUT', 'draft', 'Save the storefront draft', { scope: S.TEMPLATES_WRITE, body: templateBody('draft'), response: mutationResult }),
  template('validate_template', 'POST', 'validate', 'Validate a storefront config without saving', { scope: S.TEMPLATES_READ, body: templateBody('validate').extend({ config: templateConfigDoc }), response: validationResultSchema }),
  template('preview_template', 'POST', 'preview', 'Render a preview of a storefront revision', { scope: S.TEMPLATES_READ, body: previewSchema, response: previewResult }),
  template('publish_template', 'POST', 'publish', 'Publish the storefront draft', { scope: S.TEMPLATES_ACTIVATE, body: templateBody('publish'), response: mutationResult }),
  template('rollback_template', 'POST', 'rollback', 'Roll the storefront back to an earlier revision', { scope: S.TEMPLATES_ACTIVATE, body: templateBody('rollback'), response: mutationResult }),
  template('reset_template_field', 'POST', 'reset', 'Reset one field of the storefront draft to the template default', { scope: S.TEMPLATES_WRITE, body: templateBody('reset'), response: mutationResult }),
  template('diff_template', 'POST', 'diff', 'Compare two storefront revisions', { scope: S.TEMPLATES_READ, body: templateBody('diff'), response: diffResult }),
  template('get_template_licenses', 'GET', 'licenses', 'Status of private template license keys', { scope: S.TEMPLATES_READ, response: z.object({ statuses: z.array(templateLicenseStatusSchema) }) }),
  template('save_template_license', 'POST', 'licenses', 'Save a private template license key', {
    scope: S.TEMPLATES_WRITE, body: templateCredentialInputSchema, response: templateLicenseStatusSchema,
    description: 'Saving a key does not grant activation rights by itself; the key is verified separately.', mcpExclude: true,
  }),
];

const CATALOG: ApiOperation[] = [
  { operationId: 'list_tags', method: 'GET', path: '/tags', tag: 'Catalog', scope: S.PRODUCTS_READ, envelope: 'list', summary: 'List tags',
    query: z.object({ ...page, search: z.string().optional(), sort_by: z.enum(Object.keys(TAG_SORT_COLUMNS) as [string, ...string[]]).optional(), sort_order: sortOrder }) },
  { operationId: 'create_tag', method: 'POST', path: '/tags', tag: 'Catalog', scope: S.PRODUCTS_WRITE, status: [201], summary: 'Create a tag', body: TagCreateDTO },
  { operationId: 'get_tag', method: 'GET', path: '/tags/{id}', tag: 'Catalog', scope: S.PRODUCTS_READ, summary: 'Get a tag' },
  { operationId: 'update_tag', method: 'PATCH', path: '/tags/{id}', tag: 'Catalog', scope: S.PRODUCTS_WRITE, summary: 'Update a tag', body: TagUpdateDTO },
  { operationId: 'delete_tag', method: 'DELETE', path: '/tags/{id}', tag: 'Catalog', scope: S.PRODUCTS_WRITE, envelope: 'empty', status: [204], summary: 'Delete a tag (product links are removed)' },
  { operationId: 'list_variant_groups', method: 'GET', path: '/variant-groups', tag: 'Catalog', scope: S.PRODUCTS_READ, envelope: 'list', summary: 'List variant groups', query: z.object(page) },
  { operationId: 'create_variant_group', method: 'POST', path: '/variant-groups', tag: 'Catalog', scope: S.PRODUCTS_WRITE, status: [201], summary: 'Create a variant group',
    bodyHint: 'name?, slug?, products: [{ product_id, variant_name?, is_featured? }] (required)' },
  { operationId: 'get_variant_group', method: 'GET', path: '/variant-groups/{id}', tag: 'Catalog', scope: S.PRODUCTS_READ, summary: 'Get a variant group' },
  { operationId: 'update_variant_group', method: 'PATCH', path: '/variant-groups/{id}', tag: 'Catalog', scope: S.PRODUCTS_WRITE, summary: 'Update a variant group',
    bodyHint: 'name?, slug?, products?: [{ product_id, variant_name?, display_order, is_featured? }]' },
  { operationId: 'delete_variant_group', method: 'DELETE', path: '/variant-groups/{id}', tag: 'Catalog', scope: S.PRODUCTS_WRITE, envelope: 'empty', status: [204], summary: 'Delete a variant group' },
];

const UPSELLS: ApiOperation[] = [
  { operationId: 'list_order_bumps', method: 'GET', path: '/order-bumps', tag: 'Upsells', scope: S.PRODUCTS_READ, envelope: 'list', summary: 'List order bumps',
    query: z.object({ product_id: uuid.optional().describe('Filter by main product'), ...page }) },
  { operationId: 'create_order_bump', method: 'POST', path: '/order-bumps', tag: 'Upsells', scope: S.PRODUCTS_WRITE, status: [201], summary: 'Create an order bump',
    bodyHint: 'main_product_id, bump_product_id, bump_title (required); bump_price (number|null), bump_description, is_active (default true), display_order, access_duration_days' },
  { operationId: 'get_order_bump', method: 'GET', path: '/order-bumps/{id}', tag: 'Upsells', scope: S.PRODUCTS_READ, summary: 'Get an order bump' },
  { operationId: 'update_order_bump', method: 'PATCH', path: '/order-bumps/{id}', tag: 'Upsells', scope: S.PRODUCTS_WRITE, summary: 'Update an order bump',
    bodyHint: 'Any of: bump_product_id, bump_price, bump_title, bump_description, is_active, display_order, access_duration_days' },
  { operationId: 'delete_order_bump', method: 'DELETE', path: '/order-bumps/{id}', tag: 'Upsells', scope: S.PRODUCTS_WRITE, envelope: 'empty', status: [204], summary: 'Delete an order bump' },
  { operationId: 'get_product_oto', method: 'GET', path: '/products/{id}/oto', tag: 'Upsells', scope: S.PRODUCTS_READ, summary: 'Get the one-time offer shown after buying a product' },
  { operationId: 'set_product_oto', method: 'PUT', path: '/products/{id}/oto', tag: 'Upsells', scope: S.PRODUCTS_WRITE, summary: 'Create or replace the one-time offer of a product',
    bodyHint: 'oto_product_id (required); discount_type percentage|fixed (default percentage); discount_value (default 20); duration_minutes (default 15, max 10080)' },
  { operationId: 'delete_product_oto', method: 'DELETE', path: '/products/{id}/oto', tag: 'Upsells', scope: S.PRODUCTS_WRITE, envelope: 'empty', status: [204], summary: 'Remove the one-time offer of a product' },
];

const COUPONS: ApiOperation[] = [
  { operationId: 'list_coupons', method: 'GET', path: '/coupons', tag: 'Coupons', scope: S.COUPONS_READ, envelope: 'list', summary: 'List coupons',
    query: z.object({ ...page, status: z.enum(['all', 'active', 'inactive', 'expired']).optional(), type: z.enum(['all', 'oto', 'regular']).optional(),
      search: z.string().max(200).optional().describe('Code or name'), sort: z.string().optional().describe("Default '-created_at'") }) },
  { operationId: 'create_coupon', method: 'POST', path: '/coupons', tag: 'Coupons', scope: S.COUPONS_WRITE, status: [201], summary: 'Create a coupon',
    bodyHint: 'code, discount_type (percentage|fixed|set_price), discount_value (required; amounts in major units); name, currency (required for fixed/set_price), is_active, starts_at, expires_at, usage_limit_global, usage_limit_per_user (default 1), allowed_emails[], allowed_product_ids[], exclude_order_bumps' },
  { operationId: 'get_coupon', method: 'GET', path: '/coupons/{id}', tag: 'Coupons', scope: S.COUPONS_READ, summary: 'Get a coupon' },
  { operationId: 'update_coupon', method: 'PATCH', path: '/coupons/{id}', tag: 'Coupons', scope: S.COUPONS_WRITE, summary: 'Update a coupon', bodyHint: 'Any field accepted on create; null clears expires_at and usage limits' },
  { operationId: 'delete_coupon', method: 'DELETE', path: '/coupons/{id}', tag: 'Coupons', scope: S.COUPONS_WRITE, envelope: 'empty', status: [204], summary: 'Delete a coupon' },
  { operationId: 'get_coupon_stats', method: 'GET', path: '/coupons/{id}/stats', tag: 'Coupons', scope: S.COUPONS_READ, summary: 'Usage statistics of a coupon' },
];

const PAYMENTS: ApiOperation[] = [
  { operationId: 'list_payments', method: 'GET', path: '/payments', tag: 'Payments', scope: S.PAYMENTS_READ, envelope: 'list', summary: 'List payments',
    query: z.object({ ...page, status: z.string().optional(), product_id: uuid.optional(), email: z.string().optional(), search: z.string().max(200).optional(),
      date_from: z.string().optional().describe('ISO date'), date_to: z.string().optional().describe('ISO date'), sort: z.string().optional(), embed: z.string().optional() }) },
  { operationId: 'get_payment', method: 'GET', path: '/payments/{id}', tag: 'Payments', scope: S.PAYMENTS_READ, summary: 'Get a payment' },
  { operationId: 'update_payment_metadata', method: 'PATCH', path: '/payments/{id}', tag: 'Payments', scope: S.PAYMENTS_WRITE, summary: 'Merge metadata into a payment', bodyHint: '{ metadata: object } (merged, not replaced)' },
  { operationId: 'refund_payment', method: 'POST', path: '/payments/{id}/refund', tag: 'Payments', scope: S.PAYMENTS_REFUND, summary: 'Refund a payment (full or partial)',
    bodyHint: 'amount? (minor units; omit for a full refund), reason? duplicate|fraudulent|requested_by_customer' },
  { operationId: 'mark_payment_paid', method: 'POST', path: '/payments/{id}/mark-paid', tag: 'Payments', scope: S.PAYMENTS_WRITE, summary: 'Record a received bank transfer',
    description: 'Over the seat limit the answer is 409 oversold_confirmation_required: check late-transfer-preview, then resend with acceptOversold: true.', body: transferBody('mark-paid') },
  { operationId: 'cancel_payment', method: 'POST', path: '/payments/{id}/cancel', tag: 'Payments', scope: S.PAYMENTS_WRITE, summary: 'Cancel an unpaid bank-transfer order', body: transferBody('cancel') },
  { operationId: 'mark_payment_invoice_issued', method: 'POST', path: '/payments/{id}/invoice-issued', tag: 'Payments', scope: S.PAYMENTS_WRITE, summary: 'Hold a transfer order without expiry (invoice issued outside Sellf)', body: transferBody('invoice-issued') },
  { operationId: 'get_late_transfer_preview', method: 'GET', path: '/payments/{id}/late-transfer-preview', tag: 'Payments', scope: S.PAYMENTS_READ, summary: 'Facts before accepting a late bank transfer', description: 'Price then vs now, seats left, coupon state, whether acceptance oversells. No personal data.' },
  { operationId: 'export_payments', method: 'POST', path: '/payments/export', tag: 'Payments', scope: S.PAYMENTS_READ, envelope: 'csv', summary: 'Export payments as CSV', body: exportFiltersSchema, mcpExclude: true },
  { operationId: 'get_payment_stats', method: 'GET', path: '/payments/stats', tag: 'Payments', scope: S.ANALYTICS_READ, summary: 'Payment statistics' },
];

const REFUNDS: ApiOperation[] = [
  { operationId: 'list_refund_requests', method: 'GET', path: '/refund-requests', tag: 'Refunds', scope: S.REFUND_REQUESTS_READ, envelope: 'list', summary: 'List refund requests',
    query: z.object({ ...page, status: z.string().optional(), user_id: uuid.optional(), product_id: uuid.optional() }) },
  { operationId: 'get_refund_request', method: 'GET', path: '/refund-requests/{id}', tag: 'Refunds', scope: S.REFUND_REQUESTS_READ, summary: 'Get a refund request' },
  { operationId: 'review_refund_request', method: 'PATCH', path: '/refund-requests/{id}', tag: 'Refunds', scope: S.REFUND_REQUESTS_WRITE, summary: 'Approve or reject a refund request',
    bodyHint: 'action approve|reject (required), admin_response? (message to the buyer)' },
];

const USERS: ApiOperation[] = [
  { operationId: 'list_users', method: 'GET', path: '/users', tag: 'Users', scope: S.USERS_READ, envelope: 'list', summary: 'List users',
    query: z.object({ ...page, search: z.string().optional(), sort_by: z.string().optional(), sort_order: sortOrder }) },
  { operationId: 'get_user', method: 'GET', path: '/users/{id}', tag: 'Users', scope: S.USERS_READ, summary: 'Get a user with product access' },
  { operationId: 'list_user_access', method: 'GET', path: '/users/{id}/access', tag: 'Users', scope: S.USERS_READ, envelope: 'list', summary: 'List the product access of a user', query: z.object(page) },
  { operationId: 'grant_user_access', method: 'POST', path: '/users/{id}/access', tag: 'Users', scope: S.USERS_WRITE, status: [201], summary: 'Grant a user access to a product',
    description: 'product_id (required), access_duration_days?, access_expires_at? plus the license options below. Issuing a license also needs licenses:write.',
    body: accessLicenseSchema.extend({ product_id: uuid, access_duration_days: z.number().int().positive().optional(), access_expires_at: z.string().optional().describe('ISO date') }) },
  { operationId: 'revoke_user_access_by_product', method: 'DELETE', path: '/users/{id}/access', tag: 'Users', scope: S.USERS_WRITE, status: [200, 204], summary: 'Revoke the access of a user to a product',
    description: 'Revokes the license issued with this grant too, unless revoke_license=false (needs licenses:write; without it the license stays and a warning is returned).',
    query: z.object({ product_id: uuid, revoke_license: z.enum(['true', 'false']).optional() }) },
  { operationId: 'get_user_access', method: 'GET', path: '/users/{id}/access/{accessId}', tag: 'Users', scope: S.USERS_READ, summary: 'Get one access entry' },
  { operationId: 'update_user_access', method: 'PATCH', path: '/users/{id}/access/{accessId}', tag: 'Users', scope: S.USERS_WRITE, summary: 'Extend or change an access entry',
    bodyHint: 'One of: extend_days, access_expires_at (ISO date), access_duration_days' },
  { operationId: 'revoke_user_access', method: 'DELETE', path: '/users/{id}/access/{accessId}', tag: 'Users', scope: S.USERS_WRITE, status: [200, 204], summary: 'Revoke one access entry',
    description: 'Same license rule as revoking by product.', query: z.object({ product_id: uuid.optional().describe('Ignored when accessId is given'), revoke_license: z.enum(['true', 'false']).optional() }) },
];

const LICENSES: ApiOperation[] = [
  { operationId: 'list_licenses', method: 'GET', path: '/licenses', tag: 'Licenses', scope: S.LICENSES_READ, envelope: 'list', summary: 'List issued licenses',
    query: z.object({ ...page, product_id: uuid.optional(), email: z.string().optional(), status: z.enum(['active', 'expired', 'revoked']).optional(), source: z.enum(['purchase', 'manual', 'api']).optional() }) },
  { operationId: 'issue_license', method: 'POST', path: '/licenses', tag: 'Licenses', scope: S.LICENSES_WRITE, status: [201], summary: 'Issue a license key', description: 'Emits license.issued; the buyer gets the key by mail unless sendEmail is false.', body: licenseRequestSchema },
  { operationId: 'get_license', method: 'GET', path: '/licenses/{id}', tag: 'Licenses', scope: S.LICENSES_READ, summary: 'Get a license with its signed token' },
  { operationId: 'revoke_license', method: 'DELETE', path: '/licenses/{id}', tag: 'Licenses', scope: S.LICENSES_WRITE, summary: 'Revoke a license permanently', description: 'Emits license.revoked.' },
];

const WEBHOOKS: ApiOperation[] = [
  { operationId: 'list_webhooks', method: 'GET', path: '/webhooks', tag: 'Webhooks', scope: S.WEBHOOKS_READ, envelope: 'list', summary: 'List webhook endpoints',
    query: z.object({ ...page, status: z.enum(['all', 'active', 'inactive']).optional() }) },
  { operationId: 'create_webhook', method: 'POST', path: '/webhooks', tag: 'Webhooks', scope: S.WEBHOOKS_WRITE, status: [201], summary: 'Create a webhook endpoint',
    description: 'The signing secret is returned once.', bodyHint: 'url (https, required), events[] (required), description?, is_active?, product_filter_mode?, product_ids?, custom_payload_fields?' },
  { operationId: 'get_webhook', method: 'GET', path: '/webhooks/{id}', tag: 'Webhooks', scope: S.WEBHOOKS_READ, summary: 'Get a webhook endpoint' },
  { operationId: 'update_webhook', method: 'PATCH', path: '/webhooks/{id}', tag: 'Webhooks', scope: S.WEBHOOKS_WRITE, summary: 'Update a webhook endpoint', description: 'Endpoint fields and product scope are updated together. An invalid update preserves the previous settings.', bodyHint: 'Any of: url, events[], description, is_active, product_filter_mode + product_ids, custom_payload_fields' },
  { operationId: 'delete_webhook', method: 'DELETE', path: '/webhooks/{id}', tag: 'Webhooks', scope: S.WEBHOOKS_WRITE, envelope: 'empty', status: [204], summary: 'Delete a webhook endpoint' },
  { operationId: 'rotate_webhook_secret', method: 'POST', path: '/webhooks/{id}/rotate-secret', tag: 'Webhooks', scope: S.WEBHOOKS_WRITE, noBody: true, summary: 'Replace the signing secret of an endpoint' },
  { operationId: 'test_webhook', method: 'POST', path: '/webhooks/{id}/test', tag: 'Webhooks', scope: S.WEBHOOKS_WRITE, summary: 'Send a test delivery', bodyHint: 'event_type? (default: first subscribed event)' },
  { operationId: 'list_webhook_logs', method: 'GET', path: '/webhooks/logs', tag: 'Webhooks', scope: S.WEBHOOKS_READ, envelope: 'list', summary: 'List webhook delivery logs',
    query: z.object({ ...page, endpoint_id: uuid.optional(), status: z.string().optional(), event_type: z.string().optional() }) },
  { operationId: 'retry_webhook_log', method: 'POST', path: '/webhooks/logs/{logId}/retry', tag: 'Webhooks', auth: 'session', mcpExclude: true, noBody: true, description: 'Admin panel session required; API keys are not accepted. Returns 409 when the endpoint URL changed after the delivery or event was created.', summary: 'Retry a failed delivery now' },
  { operationId: 'force_retry_webhook_log', method: 'POST', path: '/webhooks/logs/{logId}/force-retry', tag: 'Webhooks', auth: 'session', mcpExclude: true, noBody: true, description: 'Admin panel session required; API keys are not accepted. Returns 409 when the endpoint URL changed after the delivery or event was created.', summary: 'Run a pending retry on the next worker tick' },
  { operationId: 'cancel_webhook_log', method: 'POST', path: '/webhooks/logs/{logId}/cancel', tag: 'Webhooks', scope: S.WEBHOOKS_WRITE, noBody: true, summary: 'Cancel a pending retry (marks it permanently failed)' },
  { operationId: 'replay_webhook_log', method: 'POST', path: '/webhooks/logs/{logId}/replay', tag: 'Webhooks', auth: 'session', mcpExclude: true, noBody: true, description: 'Admin panel session required; API keys are not accepted. Returns 409 when the endpoint URL changed after the delivery or event was created.', summary: 'Replay a permanently failed delivery' },
  { operationId: 'archive_webhook_log', method: 'POST', path: '/webhooks/logs/{logId}/archive', tag: 'Webhooks', scope: S.WEBHOOKS_WRITE, noBody: true, summary: 'Archive a delivery log entry' },
  { operationId: 'list_abandoned_webhook_events', method: 'GET', path: '/webhooks/events', tag: 'Webhooks', scope: S.WEBHOOKS_READ, summary: 'List business events whose hand-off to delivery failed',
    query: z.object({ status: z.literal('abandoned').optional(), limit }) },
  { operationId: 'retry_webhook_event', method: 'POST', path: '/webhooks/events/{eventId}/retry', tag: 'Webhooks', auth: 'session', mcpExclude: true, noBody: true, description: 'Admin panel session required; API keys are not accepted. Returns 409 unless the event is abandoned. Each resulting delivery retains the event creation time and is closed if its endpoint URL changed later.', summary: 'Retry an abandoned business event' },
];

const ANALYTICS: ApiOperation[] = [
  { operationId: 'get_dashboard', method: 'GET', path: '/analytics/dashboard', tag: 'Analytics', scope: S.ANALYTICS_READ, summary: 'Dashboard overview', query: z.object({ product_id: uuid.optional() }) },
  { operationId: 'get_revenue', method: 'GET', path: '/analytics/revenue', tag: 'Analytics', scope: S.ANALYTICS_READ, summary: 'Revenue statistics',
    query: z.object({ period: z.string().optional(), start_date: z.string().optional(), end_date: z.string().optional(), product_id: uuid.optional(), group_by: z.string().optional() }) },
  { operationId: 'get_top_products', method: 'GET', path: '/analytics/top-products', tag: 'Analytics', scope: S.ANALYTICS_READ, summary: 'Best-selling products',
    query: z.object({ period: z.string().optional(), limit, sort_by: z.string().optional() }) },
  { operationId: 'get_purchase_attribution', method: 'GET', path: '/analytics/attribution', tag: 'Analytics', scope: S.ANALYTICS_READ, summary: 'Where purchases came from (aggregated, no personal data)',
    query: attributionQuerySchema, queryFromRoute: true },
];

const SETTINGS: ApiOperation[] = [
  { operationId: 'get_checkout_settings', method: 'GET', path: '/settings/checkout', tag: 'Settings', scope: S.SYSTEM_READ, summary: 'Read checkout settings', response: checkoutSettingsSchema },
  { operationId: 'update_checkout_settings', method: 'PATCH', path: '/settings/checkout', tag: 'Settings', scope: S.SYSTEM_WRITE, summary: 'Change checkout settings', body: checkoutSettingsSchema, response: checkoutSettingsSchema },
  { operationId: 'update_integrations', method: 'PATCH', path: '/integrations', tag: 'Settings', scope: S.INTEGRATIONS_WRITE, summary: 'Update tracking and consent integrations',
    bodyHint: 'Integration fields to change (tracking IDs, consent settings); validated by validateIntegrations' },
];

const SYSTEM: ApiOperation[] = [
  { operationId: 'get_system_status', method: 'GET', path: '/system/status', tag: 'System', scope: S.SYSTEM_READ, summary: 'Detailed system status' },
  { operationId: 'check_for_update', method: 'GET', path: '/system/update-check', tag: 'System', scope: S.SYSTEM_READ, summary: 'Check for a newer Sellf release',
    query: z.object({ force: z.enum(['true', 'false']).optional().describe('Bypass the one-hour cache') }) },
  { operationId: 'start_upgrade', method: 'POST', path: '/system/upgrade', tag: 'System', scope: S.SYSTEM_WRITE, status: [202], noBody: true, summary: 'Start the self-upgrade',
    description: 'Returns a token immediately; follow progress with get_upgrade_status. One upgrade at a time.' },
  { operationId: 'get_upgrade_status', method: 'GET', path: '/system/upgrade-status', tag: 'System', scope: S.SYSTEM_READ, summary: 'Progress of a running upgrade', query: z.object({ token: uuid }) },
  { operationId: 'get_maintenance_mode', method: 'GET', path: '/system/maintenance', tag: 'System', scope: S.SYSTEM_READ, summary: 'Read maintenance mode and its source',
    description: 'Active when the server file, SELLF_MAINTENANCE or the database switch is on; the file wins. Says where the file is looked for.', response: maintenanceStatusSchema },
  { operationId: 'update_maintenance_mode', method: 'PATCH', path: '/system/maintenance', tag: 'System', scope: S.SYSTEM_WRITE, summary: 'Switch maintenance mode (database source) on or off',
    description: 'While on, the shop, checkout, embed, login wall and new payments answer 503; the admin panel, API v1 and Stripe webhooks keep working. Turning it off clears message and expected end. Audited.',
    body: maintenanceChangeSchema, response: maintenanceStatusSchema },
];

const sessionOnly = { tag: 'API keys' as const, auth: 'session' as const, mcpExclude: true };
const API_KEYS: ApiOperation[] = [
  { ...sessionOnly, operationId: 'list_api_keys', method: 'GET', path: '/api-keys', summary: 'List API keys (without secrets)' },
  { ...sessionOnly, operationId: 'create_api_key', method: 'POST', path: '/api-keys', status: [201], summary: 'Create an API key (secret shown once)', bodyHint: 'name, scopes[], rate_limit_per_minute?, expires_at?' },
  { ...sessionOnly, operationId: 'get_api_key', method: 'GET', path: '/api-keys/{id}', summary: 'Get an API key' },
  { ...sessionOnly, operationId: 'update_api_key', method: 'PATCH', path: '/api-keys/{id}', summary: 'Rename or deactivate an API key', bodyHint: 'name?, is_active?' },
  { ...sessionOnly, operationId: 'revoke_api_key', method: 'DELETE', path: '/api-keys/{id}', summary: 'Revoke an API key', query: z.object({ reason: z.string().optional() }) },
  { ...sessionOnly, operationId: 'rotate_api_key', method: 'POST', path: '/api-keys/{id}/rotate', status: [201, 207], summary: 'Rotate an API key (old key keeps working during the grace period)' },
];

const META: ApiOperation[] = [
  { operationId: 'get_openapi_spec', method: 'GET', path: '/openapi.json', tag: 'Meta', auth: 'public', envelope: 'raw', mcpExclude: true,
    summary: 'This OpenAPI 3.1 description', description: 'Public, cacheable, no secrets. Generated from the operation registry and the route validators.' },
];

export const API_OPERATIONS: readonly ApiOperation[] = [
  ...PRODUCTS, ...OFFERS, ...TEMPLATES, ...CATALOG, ...UPSELLS, ...COUPONS, ...PAYMENTS, ...REFUNDS,
  ...USERS, ...LICENSES, ...WEBHOOKS, ...ANALYTICS, ...SETTINGS, ...SYSTEM, ...API_KEYS, ...META,
];
