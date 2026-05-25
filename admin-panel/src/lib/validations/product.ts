/**
 * Product validation utilities with strict security checks
 * SECURITY: All input data MUST be validated before database operations
 * No external dependencies - pure TypeScript validation
 */

import { parseVideoUrl, isTrustedVideoPlatform } from '@/lib/videoUtils';
import { SUPPORTED_CURRENCY_CODES } from '@/lib/constants';
import { getTrustedDownloadProviders } from '@/lib/trustedDownloadProviders';
import { CHECKOUT_TEMPLATE_SLUGS } from '@/lib/checkout-templates/types';
import { validateCustomFieldDefinitions } from '@/lib/validations/custom-checkout-fields';

/**
 * Explicit field list for Products API v1 responses.
 * Excludes internal/sensitive fields: sale_price, sale_price_until,
 * sale_quantity_limit, sale_quantity_sold, tenant_id, success_redirect_url,
 * pass_params_to_redirect, vat_rate, price_includes_vat, omnibus_exempt
 *
 * @see supabase/migrations/20250101000000_core_schema.sql (products table)
 */
export const PRODUCT_API_FIELDS = `id, name, slug, description, long_description, icon, image_url, thumbnail_url, preview_video_url, preview_video_config, price, currency, features, layout_template, is_active, is_featured, is_listed, available_from, available_until, auto_grant_duration_days, content_delivery_type, content_config, is_refundable, refund_period_days, enable_waitlist, allow_custom_price, custom_price_min, show_price_presets, custom_price_presets, vat_rate, price_includes_vat, omnibus_exempt, sale_price, sale_price_until, sale_quantity_limit, success_redirect_url, pass_params_to_redirect, product_type, billing_interval, billing_interval_count, recurring_price, trial_days, embed_enabled, created_at, updated_at`;

/**
 * SECURITY FIX (V13): Escape ILIKE special characters to prevent SQL pattern injection
 * PostgreSQL ILIKE treats %, _, and \ as wildcards/escape chars
 * @param input - Raw user input for ILIKE search
 * @returns Escaped string safe for ILIKE patterns
 */
export function escapeIlikePattern(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }
  // Escape backslash first, then % and _
  return input
    .replace(/\\/g, '\\\\')  // \ -> \\
    .replace(/%/g, '\\%')    // % -> \%
    .replace(/_/g, '\\_');   // _ -> \_
}

/**
 * Wraps an ILIKE-escaped value in a PostgREST double-quoted string so that
 * commas, dots, parens and colons inside the value cannot be parsed as
 * PostgREST .or() filter syntax. Inside the quoted form, the only meta-chars
 * are `\` and `"`, both of which we escape with a backslash.
 */
export function quoteForPostgrestOr(value: string): string {
  if (typeof value !== 'string') return '""';
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Allowed sort columns for product queries - prevents SQL injection via sortBy
 * SECURITY: Only whitelisted columns can be used for sorting
 */
export const PRODUCT_SORT_COLUMNS: Record<string, string> = {
  'name': 'name',
  'price': 'price',
  'created_at': 'created_at',
  'updated_at': 'updated_at',
  'is_active': 'is_active',
  'is_featured': 'is_featured',
  'slug': 'slug',
};

/**
 * Validate and map sortBy parameter to prevent SQL injection
 * @param sortBy - User-provided sort column name
 * @returns Safe column name or default
 */
export function validateProductSortColumn(sortBy: string | null): string {
  if (!sortBy || typeof sortBy !== 'string') {
    return 'created_at';
  }
  return PRODUCT_SORT_COLUMNS[sortBy] || 'created_at';
}

// Validation result type
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

// Product input types
export interface CreateProductInput {
  name: string;
  slug: string;
  description: string;
  price: number;
  currency?: string;
  is_active?: boolean;
  is_featured?: boolean;
  icon?: string;
  content_delivery_type?: string;
  content_config?: {
    content_items: Array<{
      id: string;
      type: string;
      title: string;
      content: string;
      order: number;
      is_active: boolean;
    }>;
  };
  available_from?: string | null;
  available_until?: string | null;
  auto_grant_duration_days?: number | null;
  embed_enabled?: boolean;
}

export interface UpdateProductInput {
  name?: string;
  slug?: string;
  description?: string;
  price?: number;
  currency?: string;
  is_active?: boolean;
  is_featured?: boolean;
  icon?: string;
  content_delivery_type?: string;
  content_config?: {
    content_items: Array<{
      id: string;
      type: string;
      title: string;
      content: string;
      order: number;
      is_active: boolean;
    }>;
  };
  available_from?: string | null;
  available_until?: string | null;
  auto_grant_duration_days?: number | null;
  embed_enabled?: boolean;
}

// Validation functions
function validateSlug(slug: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (!slug || typeof slug !== 'string') {
    errors.push('Slug is required');
  } else {
    const trimmedSlug = slug.trim();
    
    if (trimmedSlug.length === 0) {
      errors.push('Slug cannot be empty');
    } else if (trimmedSlug.length > 100) {
      errors.push('Slug must be less than 100 characters');
    } else if (!/^[a-z0-9-]+$/.test(trimmedSlug)) {
      errors.push('Slug can only contain lowercase letters, numbers, and hyphens');
    } else if (trimmedSlug.startsWith('-') || trimmedSlug.endsWith('-')) {
      errors.push('Slug cannot start or end with hyphens');
    } else if (trimmedSlug.includes('--')) {
      errors.push('Slug cannot contain consecutive hyphens');
    }
  }
  
  return { isValid: errors.length === 0, errors };
}

function validateName(name: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (!name || typeof name !== 'string') {
    errors.push('Name is required');
  } else {
    const trimmedName = name.trim();
    
    if (trimmedName.length === 0) {
      errors.push('Name cannot be empty');
    } else if (trimmedName.length > 200) {
      errors.push('Name must be less than 200 characters');
    }
  }
  
  return { isValid: errors.length === 0, errors };
}

function validateDescription(description: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (!description || typeof description !== 'string') {
    errors.push('Description is required');
  } else {
    const trimmedDescription = description.trim();
    
    if (trimmedDescription.length === 0) {
      errors.push('Description cannot be empty');
    } else if (trimmedDescription.length > 1000) {
      errors.push('Description must be less than 1000 characters');
    }
  }
  
  return { isValid: errors.length === 0, errors };
}

function validatePrice(price: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (typeof price !== 'number') {
    errors.push('Price must be a number');
  } else if (isNaN(price) || !isFinite(price)) {
    errors.push('Price must be a valid number');
  } else if (price < 0) {
    errors.push('Price must be non-negative');
  } else if (price > 999999.99) {
    errors.push('Price cannot exceed $999,999.99');
  }
  
  return { isValid: errors.length === 0, errors };
}

function validateCurrency(currency: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (!currency || typeof currency !== 'string') {
    errors.push('Currency is required');
  } else if (currency.length !== 3) {
    errors.push('Currency must be exactly 3 characters');
  } else if (!/^[A-Z]{3}$/.test(currency)) {
    errors.push('Currency must be uppercase letters only');
  } else if (!(SUPPORTED_CURRENCY_CODES as readonly string[]).includes(currency)) {
    errors.push(`Unsupported currency code. Supported: ${SUPPORTED_CURRENCY_CODES.join(', ')}`);
  }
  
  return { isValid: errors.length === 0, errors };
}

function validateIcon(icon: unknown): ValidationResult {
  const errors: string[] = [];

  if (!icon || typeof icon !== 'string') {
    errors.push('Icon is required');
  } else if (icon.length > 20) {
    // Allow longer length for multi-codepoint emojis (e.g., 🛠️ = 3 chars)
    errors.push('Icon must be less than 20 characters');
  } else {
    // Check if it's a valid icon: either emoji(s) or alphanumeric icon name
    const isAlphanumericIcon = /^[a-zA-Z0-9-_]+$/.test(icon);
    // Match emojis including multi-codepoint ones (flags, skin tones, ZWJ sequences)
    const emojiRegex = /^[\p{Emoji}\p{Emoji_Modifier}\p{Emoji_Component}\p{Emoji_Modifier_Base}\p{Emoji_Presentation}\u200d\ufe0f]+$/u;
    const isEmojiIcon = emojiRegex.test(icon);

    if (!isAlphanumericIcon && !isEmojiIcon) {
      errors.push('Invalid icon format');
    }
  }

  return { isValid: errors.length === 0, errors };
}

function validateContentDeliveryType(type: unknown): ValidationResult {
  const errors: string[] = [];
  const validTypes = ['content', 'redirect'];
  
  if (!type || typeof type !== 'string') {
    errors.push('Content delivery type is required');
  } else if (!validTypes.includes(type)) {
    errors.push('Invalid content delivery type');
  }
  
  return { isValid: errors.length === 0, errors };
}

function validateDate(date: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (date !== null && date !== undefined && date !== '') {
    if (typeof date !== 'string') {
      errors.push('Date must be a string');
    } else if (isNaN(Date.parse(date))) {
      errors.push('Invalid date format');
    } else {
      const parsedDate = new Date(date);
      const now = new Date();
      const maxFutureDate = new Date(now.getFullYear() + 10, now.getMonth(), now.getDate());
      
      if (parsedDate < new Date('2020-01-01') || parsedDate > maxFutureDate) {
        errors.push('Date must be between 2020 and 10 years in the future');
      }
    }
  }
  
  return { isValid: errors.length === 0, errors };
}

function validateDuration(duration: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (duration !== null && duration !== undefined) {
    if (typeof duration !== 'number') {
      errors.push('Duration must be a number');
    } else if (!Number.isInteger(duration)) {
      errors.push('Duration must be an integer');
    } else if (duration < 1) {
      errors.push('Duration must be at least 1 day');
    } else if (duration > 3650) {
      errors.push('Duration cannot exceed 10 years');
    }
  }
  
  return { isValid: errors.length === 0, errors };
}

export function validateUUID(uuid: string): ValidationResult {
  const errors: string[] = [];
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!uuid || typeof uuid !== 'string') {
    errors.push('UUID is required');
  } else if (!uuidRegex.test(uuid)) {
    errors.push('Invalid UUID format');
  }

  return { isValid: errors.length === 0, errors };
}

/**
 * Normalize and validate bump product IDs from checkout requests.
 * Supports backward compatibility: legacy single `bumpProductId` is promoted to array.
 * When `bumpProductIds[]` is non-empty it takes precedence over the legacy field.
 *
 * Returns valid UUIDs (deduplicated) and any invalid IDs separately,
 * allowing callers to decide error handling (strict 400 vs. silent filter).
 */
export function normalizeBumpIds(input: {
  bumpProductId?: string;
  bumpProductIds?: string[];
}): { validIds: string[]; invalidIds: string[] } {
  const raw: string[] = input.bumpProductIds && input.bumpProductIds.length > 0
    ? input.bumpProductIds
    : input.bumpProductId ? [input.bumpProductId] : [];

  const validIds: string[] = [];
  const invalidIds: string[] = [];

  const seen = new Set<string>();
  for (const id of raw) {
    if (seen.has(id)) continue;
    seen.add(id);

    if (validateUUID(id).isValid) {
      validIds.push(id);
    } else {
      invalidIds.push(id);
    }
  }

  return { validIds, invalidIds };
}

function validateFeatures(features: unknown): ValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(features)) {
    errors.push('Features must be an array');
    return { isValid: false, errors };
  }

  for (let i = 0; i < features.length; i++) {
    const section = features[i];
    if (typeof section === 'string') {
      errors.push(`Features[${i}] is a plain string — each element must be an object with { title: string, items: string[] }`);
      continue;
    }
    if (!section || typeof section !== 'object' || Array.isArray(section)) {
      errors.push(`Features[${i}] must be an object with { title: string, items: string[] }`);
      continue;
    }
    const obj = section as Record<string, unknown>;
    if (typeof obj.title !== 'string' || obj.title.trim().length === 0) {
      errors.push(`Features[${i}].title is required and must be a non-empty string`);
    } else if (obj.title.length > 200) {
      errors.push(`Features[${i}].title must be 200 characters or less`);
    }
    if (!Array.isArray(obj.items)) {
      errors.push(`Features[${i}].items is required and must be an array of strings`);
    } else {
      for (let j = 0; j < obj.items.length; j++) {
        if (typeof obj.items[j] !== 'string') {
          errors.push(`Features[${i}].items[${j}] must be a string`);
        } else if ((obj.items[j] as string).length > 500) {
          errors.push(`Features[${i}].items[${j}] must be 500 characters or less`);
        }
      }
    }
  }

  return { isValid: errors.length === 0, errors };
}

function validateContentConfig(contentConfig: unknown): ValidationResult {
  const errors: string[] = [];

  const config = contentConfig as Record<string, unknown>;

  if (!config || typeof config !== 'object') {
    return { isValid: true, errors }; // Content config is optional
  }

  // Validate content items if present
  if (config.content_items && Array.isArray(config.content_items)) {
    config.content_items.forEach((item: Record<string, unknown>, index: number) => {
      if (!item || typeof item !== 'object') {
        errors.push(`Content item ${index + 1}: Invalid format`);
        return;
      }

      const itemType = item.type;
      const itemConfig = item.config as Record<string, unknown> | undefined;

      // Validate video embed URLs
      if (itemType === 'video_embed') {
        const embedUrl = itemConfig?.embed_url;

        if (embedUrl) {
          if (typeof embedUrl !== 'string') {
            errors.push(`Content item ${index + 1}: Video embed URL must be a string`);
          } else {
            if (!embedUrl.startsWith('https://')) {
              errors.push(`Content item ${index + 1}: Video embed URL must use HTTPS`);
            } else {
              const parsed = parseVideoUrl(embedUrl);
              if (!parsed.isValid) {
                if (parsed.rejectionReason === 'bunny_iframe_unsupported') {
                  errors.push(`Content item ${index + 1}: Bunny iframe embeds are not supported. Use a Bunny Stream HLS playlist (.m3u8) or MP4/WebM URL from your pull zone.`);
                } else if (!isTrustedVideoPlatform(embedUrl)) {
                  errors.push(
                    `Content item ${index + 1}: Video URL must be from a trusted platform (YouTube, Vimeo, Wistia, Bunny Stream HLS/MP4, Twitch)`
                  );
                } else {
                  errors.push(`Content item ${index + 1}: Invalid video URL format`);
                }
              }
            }
          }
        }
      }

      // Validate download link URLs
      else if (itemType === 'download_link') {
        const downloadUrl = itemConfig?.download_url;

        if (downloadUrl) {
          if (typeof downloadUrl !== 'string') {
            errors.push(`Content item ${index + 1}: Download URL must be a string`);
          } else {
            try {
              const urlObj = new URL(downloadUrl);

              // Must be HTTPS
              if (urlObj.protocol !== 'https:') {
                errors.push(`Content item ${index + 1}: Download URL must use HTTPS`);
              }

              // Source of truth: src/lib/trustedDownloadProviders.ts (baseline +
              // sanitized NEXT_PUBLIC_SELLF_ALLOWED_DOWNLOAD_DOMAINS env additions).
              const hostname = urlObj.hostname.toLowerCase();
              const trustedDomains = getTrustedDownloadProviders();
              const isTrustedStorage = trustedDomains.some(domain =>
                hostname === domain || hostname.endsWith('.' + domain)
              );

              if (!isTrustedStorage) {
                errors.push(
                  `Content item ${index + 1}: Download URL must be from a trusted storage provider (AWS, Google Drive, Dropbox, OneDrive, CDN, etc.)`
                );
              }
            } catch {
              errors.push(`Content item ${index + 1}: Invalid download URL format`);
            }
          }
        }
      }
    });
  }

  return { isValid: errors.length === 0, errors };
}

// Main validation functions
export function validateCreateProduct(data: unknown): ValidationResult {
  const errors: string[] = [];
  const input = data as Record<string, unknown>;
  
  // Validate required fields
  const nameResult = validateName(input.name);
  const slugResult = validateSlug(input.slug);
  const descriptionResult = validateDescription(input.description);
  const priceResult = validatePrice(input.price);
  
  errors.push(...nameResult.errors, ...slugResult.errors, ...descriptionResult.errors, ...priceResult.errors);
  
  // Validate optional fields
  if (input.currency) {
    const currencyResult = validateCurrency(input.currency);
    errors.push(...currencyResult.errors);
  }
  
  if (input.icon) {
    const iconResult = validateIcon(input.icon);
    errors.push(...iconResult.errors);
  }
  
  if (input.content_delivery_type) {
    const typeResult = validateContentDeliveryType(input.content_delivery_type);
    errors.push(...typeResult.errors);
  }
  
  if (input.available_from) {
    const fromResult = validateDate(input.available_from);
    errors.push(...fromResult.errors);
  }
  
  if (input.available_until) {
    const untilResult = validateDate(input.available_until);
    errors.push(...untilResult.errors);
  }
  
  if (input.auto_grant_duration_days !== null && input.auto_grant_duration_days !== undefined) {
    const durationResult = validateDuration(input.auto_grant_duration_days);
    errors.push(...durationResult.errors);
  }

  // Validate long_description length
  if (input.long_description !== undefined && input.long_description !== null) {
    if (typeof input.long_description === 'string' && input.long_description.length > 50000) {
      errors.push('Long description must be 50,000 characters or less');
    }
  }

  // Validate features
  if (input.features !== undefined && input.features !== null) {
    const featuresResult = validateFeatures(input.features);
    errors.push(...featuresResult.errors);
  }

  // Validate content config
  if (input.content_config) {
    const contentConfigResult = validateContentConfig(input.content_config);
    errors.push(...contentConfigResult.errors);
  }

  // Validate preview_video_url platform and HTTPS
  if (typeof input.preview_video_url === 'string' && input.preview_video_url) {
    if (!input.preview_video_url.startsWith('https://')) {
      errors.push('Preview video URL must use HTTPS');
    } else {
      const parsed = parseVideoUrl(input.preview_video_url);
      const allowedPlatforms = ['youtube', 'vimeo', 'wistia', 'bunny', 'twitch'];
      if (!parsed.isValid || !allowedPlatforms.includes(parsed.platform)) {
        errors.push('Preview video URL must be from a supported platform: YouTube, Vimeo, Wistia, Bunny Stream HLS/MP4, or Twitch');
      }
    }
  }

  if (input.preview_video_config !== undefined) {
    errors.push(...validatePreviewVideoConfig(input.preview_video_config).errors);
  }

  // Validate date range
  if (typeof input.available_from === 'string' && typeof input.available_until === 'string') {
    const fromDate = new Date(input.available_from);
    const untilDate = new Date(input.available_until);
    if (fromDate >= untilDate) {
      errors.push('Available from date must be before available until date');
    }
  }

  // VAT rate is only relevant for paid products (or PWYW where customer always pays > 0)
  if (input.price_includes_vat === true && (input.price == null || Number(input.price) <= 0) && !input.allow_custom_price) {
    errors.push('price_includes_vat cannot be true for free products (price must be greater than 0)');
  }

  // Subscription fields validation
  errors.push(...validateSubscriptionFields(input).errors);

  if (input.checkout_template !== undefined) {
    errors.push(...validateCheckoutTemplate(input.checkout_template).errors);
  }
  if (input.custom_checkout_fields !== undefined) {
    errors.push(...validateCustomCheckoutFieldsPayload(input.custom_checkout_fields).errors);
  }
  if (input.checkout_template !== undefined || input.allow_custom_price !== undefined) {
    errors.push(...validateCheckoutTemplateDependencies(input.checkout_template, input.allow_custom_price).errors);
  }

  if (input.embed_enabled !== undefined && typeof input.embed_enabled !== 'boolean') {
    errors.push('embed_enabled must be a boolean');
  }

  return { isValid: errors.length === 0, errors };
}

function validateSubscriptionFields(input: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const productType = input.product_type;

  if (productType !== undefined && productType !== 'one_time' && productType !== 'subscription') {
    errors.push("product_type must be 'one_time' or 'subscription'");
    return { isValid: false, errors };
  }

  if (productType === 'subscription') {
    const recurring = input.recurring_price;
    if (recurring == null || Number(recurring) <= 0) {
      errors.push('Subscription requires recurring_price > 0');
    }
    const interval = input.billing_interval;
    if (typeof interval !== 'string' || !['day', 'week', 'month', 'year'].includes(interval)) {
      errors.push("billing_interval must be one of: day, week, month, year");
    }
    const count = input.billing_interval_count;
    if (count == null || !Number.isInteger(Number(count)) || Number(count) < 1) {
      errors.push('billing_interval_count must be a positive integer');
    }
    const trial = input.trial_days;
    if (trial !== undefined && trial !== null) {
      const t = Number(trial);
      if (!Number.isInteger(t) || t < 0 || t > 730) {
        errors.push('trial_days must be an integer between 0 and 730');
      }
    }
  } else if (productType === 'one_time' || productType === undefined) {
    // For one-time products, recurring fields must be null/absent.
    if (input.recurring_price != null && Number(input.recurring_price) > 0) {
      errors.push('recurring_price is only valid for subscription products');
    }
    if (input.billing_interval != null && input.billing_interval !== '') {
      errors.push('billing_interval is only valid for subscription products');
    }
  }

  return { isValid: errors.length === 0, errors };
}

export function validateUpdateProduct(data: unknown): ValidationResult {
  const errors: string[] = [];
  const input = data as Record<string, unknown>;
  
  // Validate fields only if provided
  if (input.name !== undefined) {
    const nameResult = validateName(input.name);
    errors.push(...nameResult.errors);
  }
  
  if (input.slug !== undefined) {
    const slugResult = validateSlug(input.slug);
    errors.push(...slugResult.errors);
  }
  
  if (input.description !== undefined) {
    const descriptionResult = validateDescription(input.description);
    errors.push(...descriptionResult.errors);
  }
  
  if (input.price !== undefined) {
    const priceResult = validatePrice(input.price);
    errors.push(...priceResult.errors);
  }
  
  if (input.currency !== undefined) {
    const currencyResult = validateCurrency(input.currency);
    errors.push(...currencyResult.errors);
  }
  
  if (input.icon !== undefined) {
    const iconResult = validateIcon(input.icon);
    errors.push(...iconResult.errors);
  }
  
  if (input.content_delivery_type !== undefined) {
    const typeResult = validateContentDeliveryType(input.content_delivery_type);
    errors.push(...typeResult.errors);
  }
  
  if (input.available_from !== undefined) {
    const fromResult = validateDate(input.available_from);
    errors.push(...fromResult.errors);
  }
  
  if (input.available_until !== undefined) {
    const untilResult = validateDate(input.available_until);
    errors.push(...untilResult.errors);
  }
  
  if (input.auto_grant_duration_days !== undefined) {
    const durationResult = validateDuration(input.auto_grant_duration_days);
    errors.push(...durationResult.errors);
  }

  // Validate long_description length
  if (input.long_description !== undefined && input.long_description !== null) {
    if (typeof input.long_description === 'string' && input.long_description.length > 50000) {
      errors.push('Long description must be 50,000 characters or less');
    }
  }

  // Validate features
  if (input.features !== undefined) {
    const featuresResult = validateFeatures(input.features);
    errors.push(...featuresResult.errors);
  }

  // Validate content config
  if (input.content_config !== undefined) {
    const contentConfigResult = validateContentConfig(input.content_config);
    errors.push(...contentConfigResult.errors);
  }

  // Validate preview_video_url platform and HTTPS
  if (typeof input.preview_video_url === 'string' && input.preview_video_url) {
    if (!input.preview_video_url.startsWith('https://')) {
      errors.push('Preview video URL must use HTTPS');
    } else {
      const parsed = parseVideoUrl(input.preview_video_url);
      const allowedPlatforms = ['youtube', 'vimeo', 'wistia', 'bunny', 'twitch'];
      if (!parsed.isValid || !allowedPlatforms.includes(parsed.platform)) {
        errors.push('Preview video URL must be from a supported platform: YouTube, Vimeo, Wistia, Bunny Stream HLS/MP4, or Twitch');
      }
    }
  }

  if (input.preview_video_config !== undefined) {
    errors.push(...validatePreviewVideoConfig(input.preview_video_config).errors);
  }

  // Validate date range if both are provided
  if (typeof input.available_from === 'string' && typeof input.available_until === 'string') {
    const fromDate = new Date(input.available_from);
    const untilDate = new Date(input.available_until);
    if (fromDate >= untilDate) {
      errors.push('Available from date must be before available until date');
    }
  }

  // VAT rate is only relevant for paid products (when both fields are provided together)
  // Exception: PWYW (allow_custom_price) products always have a payment, so price_includes_vat is allowed
  if (input.price_includes_vat === true && input.price !== undefined && Number(input.price) <= 0 && !input.allow_custom_price) {
    errors.push('price_includes_vat cannot be true for free products (price must be greater than 0)');
  }

  // Subscription fields validation (only when caller provides at least one of them)
  if (
    input.product_type !== undefined ||
    input.recurring_price !== undefined ||
    input.billing_interval !== undefined ||
    input.billing_interval_count !== undefined ||
    input.trial_days !== undefined
  ) {
    errors.push(...validateSubscriptionFields(input).errors);
  }

  if (input.checkout_template !== undefined) {
    errors.push(...validateCheckoutTemplate(input.checkout_template).errors);
  }
  if (input.custom_checkout_fields !== undefined) {
    errors.push(...validateCustomCheckoutFieldsPayload(input.custom_checkout_fields).errors);
  }
  if (input.checkout_template !== undefined || input.allow_custom_price !== undefined) {
    errors.push(...validateCheckoutTemplateDependencies(input.checkout_template, input.allow_custom_price, 'update').errors);
  }

  if (input.embed_enabled !== undefined && typeof input.embed_enabled !== 'boolean') {
    errors.push('embed_enabled must be a boolean');
  }

  return { isValid: errors.length === 0, errors };
}

// Phase 3 — Checkout templates feature. Both helpers below mirror the DB
// CHECK constraint + the typed registry; admin UI also runs them client-side
// so the editor highlights errors without a round-trip.

const PREVIEW_VIDEO_CONFIG_FLAGS = ['autoplay', 'loop', 'muted', 'controls', 'saved_position'] as const;

export function validatePreviewVideoConfig(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (value === undefined || value === null) {
    return { isValid: true, errors };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    errors.push('preview_video_config must be an object');
    return { isValid: false, errors };
  }
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (!(PREVIEW_VIDEO_CONFIG_FLAGS as readonly string[]).includes(key)) {
      errors.push(`preview_video_config has unknown key: ${key}`);
      continue;
    }
    if (typeof val !== 'boolean') {
      errors.push(`preview_video_config.${key} must be a boolean`);
    }
  }
  return { isValid: errors.length === 0, errors };
}

function validateCheckoutTemplate(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof value !== 'string' || !CHECKOUT_TEMPLATE_SLUGS.includes(value as typeof CHECKOUT_TEMPLATE_SLUGS[number])) {
    errors.push(
      `checkout_template must be one of: ${CHECKOUT_TEMPLATE_SLUGS.join(', ')}`,
    );
  }
  return { isValid: errors.length === 0, errors };
}

export function validateCheckoutTemplateDependencies(
  template: unknown,
  allowCustomPrice: unknown,
  context: 'create' | 'update' = 'create',
): ValidationResult {
  const errors: string[] = [];
  if (template === 'tip-jar') {
    if (context === 'create' && allowCustomPrice !== true) {
      errors.push('checkout_template "tip-jar" requires allow_custom_price=true (PWYW)');
    }
    if (context === 'update' && allowCustomPrice !== undefined && allowCustomPrice !== true) {
      errors.push('Cannot set checkout_template "tip-jar" with allow_custom_price=false (PWYW required)');
    }
  }
  return { isValid: errors.length === 0, errors };
}

function validateCustomCheckoutFieldsPayload(value: unknown): ValidationResult {
  const errors: string[] = [];
  const result = validateCustomFieldDefinitions(value);
  if (!result.ok) {
    for (const [idx, msg] of Object.entries(result.errors)) {
      errors.push(`custom_checkout_fields[${idx}]: ${msg}`);
    }
  }
  return { isValid: errors.length === 0, errors };
}

export function validateProductId(id: string): ValidationResult {
  return validateUUID(id);
}

// Data sanitization function
// Note: setDefaults should be true for CREATE operations, false for UPDATE (partial updates)
export function sanitizeProductData(data: Record<string, unknown>, setDefaults: boolean = true): Record<string, unknown> {
  // Create a copy to avoid mutating original data
  const sanitizedData = { ...data };

  // Remove dangerous fields that should not be set by user
  delete sanitizedData.id;
  delete sanitizedData.created_at;
  delete sanitizedData.updated_at;

  // Remove OTO fields - these are handled by separate oto_offers table
  delete sanitizedData.oto_enabled;
  delete sanitizedData.oto_product_id;
  delete sanitizedData.oto_discount_type;
  delete sanitizedData.oto_discount_value;
  delete sanitizedData.oto_duration_minutes;

  // SECURITY FIX: Remove sale_quantity_sold - this is a system counter
  // that should only be incremented by increment_sale_quantity_sold() function
  delete sanitizedData.sale_quantity_sold;

  // Sanitize and trim string fields
  if (sanitizedData.name && typeof sanitizedData.name === 'string') {
    sanitizedData.name = sanitizedData.name.trim();
  }

  if (sanitizedData.description && typeof sanitizedData.description === 'string') {
    sanitizedData.description = sanitizedData.description.trim();
  }

  if (sanitizedData.slug && typeof sanitizedData.slug === 'string') {
    sanitizedData.slug = sanitizedData.slug.toLowerCase().trim();
  }

  if (sanitizedData.currency && typeof sanitizedData.currency === 'string') {
    sanitizedData.currency = sanitizedData.currency.toUpperCase().trim();
  }

  // preview_video_config has a NOT NULL CHECK constraint with default '{}'
  // — let the DB default fill in for callers that haven't set it.
  if (sanitizedData.preview_video_config === null) {
    delete sanitizedData.preview_video_config;
  }

  // Convert empty strings to null for date fields
  if (sanitizedData.available_from === '') {
    sanitizedData.available_from = null;
  }

  if (sanitizedData.available_until === '') {
    sanitizedData.available_until = null;
  }

  if (sanitizedData.sale_price_until === '') {
    sanitizedData.sale_price_until = null;
  }

  // Convert sale_price empty/zero to null
  if (sanitizedData.sale_price === '' || sanitizedData.sale_price === 0 || sanitizedData.sale_price === null) {
    sanitizedData.sale_price = null;
  }

  // Convert sale_quantity_limit empty/zero to null
  if (sanitizedData.sale_quantity_limit === '' || sanitizedData.sale_quantity_limit === 0 || sanitizedData.sale_quantity_limit === null) {
    sanitizedData.sale_quantity_limit = null;
  } else if (typeof sanitizedData.sale_quantity_limit === 'string') {
    sanitizedData.sale_quantity_limit = parseInt(sanitizedData.sale_quantity_limit, 10) || null;
  }

  // NOTE: sale_quantity_sold is deleted above - it's a system counter, not user-editable

  // Validate custom_price_min if provided
  if (sanitizedData.custom_price_min !== undefined) {
    // Allow 0 for PWYW-free products (nullish coalescing — 0 is valid)
    const parsed = parseFloat(String(sanitizedData.custom_price_min));
    const minPrice = isNaN(parsed) ? 5.00 : parsed;
    sanitizedData.custom_price_min = Math.max(0, minPrice);
  }

  // Ensure custom_price_presets is a valid array if provided
  if (sanitizedData.custom_price_presets !== undefined) {
    if (!Array.isArray(sanitizedData.custom_price_presets)) {
      sanitizedData.custom_price_presets = [5, 10, 25];
    }
  }

  // Subscription fields normalization
  if (sanitizedData.product_type !== 'subscription') {
    // For non-subscription products: clear all recurring fields.
    if (sanitizedData.product_type !== undefined) sanitizedData.product_type = 'one_time';
    if ('recurring_price' in sanitizedData) sanitizedData.recurring_price = null;
    if ('billing_interval' in sanitizedData) sanitizedData.billing_interval = null;
    if ('billing_interval_count' in sanitizedData) sanitizedData.billing_interval_count = null;
    if ('trial_days' in sanitizedData) sanitizedData.trial_days = null;
  } else {
    if (sanitizedData.recurring_price !== undefined && sanitizedData.recurring_price !== null) {
      sanitizedData.recurring_price = parseFloat(String(sanitizedData.recurring_price));
    }
    if (sanitizedData.billing_interval_count !== undefined && sanitizedData.billing_interval_count !== null) {
      sanitizedData.billing_interval_count = parseInt(String(sanitizedData.billing_interval_count), 10) || 1;
    } else if (setDefaults) {
      sanitizedData.billing_interval_count = 1;
    }
    if (sanitizedData.trial_days === '' || sanitizedData.trial_days === undefined) {
      sanitizedData.trial_days = null;
    } else if (sanitizedData.trial_days !== null) {
      sanitizedData.trial_days = parseInt(String(sanitizedData.trial_days), 10);
    }
  }

  // Set defaults only for CREATE operations (not partial updates)
  if (setDefaults) {
    if (sanitizedData.currency === undefined) {
      sanitizedData.currency = 'USD';
    }
    if (sanitizedData.product_type === undefined) {
      sanitizedData.product_type = 'one_time';
    }

    if (sanitizedData.icon === undefined) {
      sanitizedData.icon = '📦';
    }

    if (sanitizedData.content_delivery_type === undefined) {
      sanitizedData.content_delivery_type = 'content';
    }

    if (sanitizedData.content_config === undefined) {
      sanitizedData.content_config = { content_items: [] };
    }

    if (sanitizedData.is_active === undefined) {
      sanitizedData.is_active = true;
    }

    if (sanitizedData.is_featured === undefined) {
      sanitizedData.is_featured = false;
    }

    if (sanitizedData.allow_custom_price === undefined) {
      sanitizedData.allow_custom_price = false;
    }

    if (sanitizedData.show_price_presets === undefined) {
      sanitizedData.show_price_presets = true;
    }
  }

  return sanitizedData;
}
