import { BASE_FLAGS, type DeriveInput, type LegalCompany, type LegalFlags } from './types';

function periodFromInterval(i: string | null): LegalFlags['subscriptionPeriod'] {
  if (i === 'year') return 'yearly';
  if (i === 'month') return 'monthly';
  if (i === 'week' || i === 'day') return 'monthly'; // brak krótszych w generatorze → najbliższy
  return 'monthly';
}

export function deriveLegalConfig(input: DeriveInput): { company: LegalCompany; flags: LegalFlags } {
  const s = input.shopConfig;
  const sub = input.products.find((p) => p.product_type === 'subscription');

  const company: LegalCompany = {
    name: s.company_legal_name ?? s.shop_name ?? '',
    legalForm: s.legal_form ?? 'jdg',
    email: s.contact_email ?? '',
    street: s.company_street ?? '',
    buildingNo: s.company_building_no ?? '',
    city: s.company_city ?? '',
    postal: s.company_postal ?? '',
    flatNo: s.company_flat_no ?? undefined,
    emailComplaints: s.complaints_email ?? undefined,
    website: input.websiteDomain,
    nip: s.nip ?? undefined,
    regon: s.regon ?? undefined,
    krs: s.krs ?? undefined,
    phone: s.company_phone ?? undefined,
  };

  const flags: LegalFlags = {
    ...BASE_FLAGS,
    digitalProducts: true,
    registerAccount: true,
    externalCheckout: true,
    externalCheckoutProvider: 'Stripe Payments Europe, Ltd.',
    subscriptionProducts: Boolean(sub),
    subscriptionPeriod: sub ? periodFromInterval(sub.billing_interval) : BASE_FLAGS.subscriptionPeriod,
    b2bInvoicing: Boolean(s.tax_id_collection_enabled),
    omnibus: s.omnibus_enabled ?? true,
    vatExempt: s.is_vat_exempt,
    microEnterprise: s.is_micro_enterprise,
    hasDpo: s.has_dpo,
    dpoEmail: s.has_dpo ? (s.dpo_contact ?? undefined) : undefined,
    googleAnalytics: input.integrations.gtm_container_id != null,
    facebookAnalytics: input.integrations.facebook_pixel_id != null,
    behaviorAds:
      input.integrations.facebook_pixel_id != null ||
      input.integrations.google_ads_conversion_id != null,
    storeEmail: true,
    storeFirstName: true,
    storeLastName: true,
    storeAddress: true,
    storeNip: Boolean(s.tax_id_collection_enabled),
  };

  return { company, flags };
}
