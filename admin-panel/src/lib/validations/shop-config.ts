/**
 * Zod DTO for updateShopConfig — mirrors the `ShopConfig` interface in
 * lib/actions/shop-config.ts (minus id/created_at/updated_at, which the
 * action itself sets). `.strict()` rejects any key not listed here so a
 * raw Server Action call can't smuggle in an unlisted column.
 */

import { z } from 'zod';

export const ShopConfigUpdateDTO = z
  .object({
    default_currency: z.string().trim().min(1).max(10),
    shop_name: z.string().trim().min(1).max(200),
    contact_email: z.string().trim().max(320).nullable(),
    country: z.string().trim().max(10).nullable(),
    tax_rate: z.number().nullable(),

    tax_mode: z.enum(['local', 'stripe_tax']),
    stripe_tax_rate_cache: z.record(z.string(), z.string()),

    logo_url: z.string().trim().max(2000).nullable(),
    font_family: z
      .enum(['system', 'inter', 'roboto', 'montserrat', 'poppins', 'playfair'])
      .nullable(),

    checkout_theme: z.enum(['system', 'light', 'dark']).nullable(),

    automatic_tax_enabled: z.boolean().nullable(),
    tax_id_collection_enabled: z.boolean().nullable(),

    checkout_billing_address: z.enum(['auto', 'required']).nullable(),
    checkout_expires_hours: z.number().nullable(),
    checkout_collect_terms: z.boolean().nullable(),

    omnibus_enabled: z.boolean(),

    terms_of_service_url: z.string().trim().max(2000).nullable(),
    privacy_policy_url: z.string().trim().max(2000).nullable(),

    legal_form: z.enum(['jdg', 'spzoo', 'fundacja', 'osoba_fizyczna']).nullable(),
    company_legal_name: z.string().trim().max(300).nullable(),
    nip: z.string().trim().max(20).nullable(),
    regon: z.string().trim().max(20).nullable(),
    krs: z.string().trim().max(20).nullable(),
    company_street: z.string().trim().max(300).nullable(),
    company_building_no: z.string().trim().max(50).nullable(),
    company_flat_no: z.string().trim().max(50).nullable(),
    company_city: z.string().trim().max(200).nullable(),
    company_postal: z.string().trim().max(20).nullable(),
    company_phone: z.string().trim().max(50).nullable(),
    complaints_email: z.string().trim().max(320).nullable(),
    is_vat_exempt: z.boolean(),
    vat_exempt_note: z.string().trim().max(1000).nullable(),
    is_micro_enterprise: z.boolean(),
    has_dpo: z.boolean(),
    dpo_contact: z.string().trim().max(300).nullable(),

    custom_settings: z.record(z.string(), z.unknown()),
  })
  .strict()
  .partial();

export type ShopConfigUpdateInput = z.infer<typeof ShopConfigUpdateDTO>;
