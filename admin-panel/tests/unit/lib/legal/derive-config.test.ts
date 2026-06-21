import { describe, it, expect } from 'vitest';
import { deriveLegalConfig, normalizeWebsiteDomain } from '@/lib/legal/derive-config';

const baseInput = {
  shopConfig: {
    shop_name: 'Mój Sklep', company_legal_name: 'Fundacja X', legal_form: 'fundacja',
    contact_email: 'info@x.pl', complaints_email: null, nip: '1182105000', regon: '360731957',
    krs: '0000541407', company_street: 'Makuszyńskiego', company_building_no: '10',
    company_flat_no: '4', company_city: 'Warszawa', company_postal: '01-860',
    company_phone: '500100200', is_vat_exempt: true, is_micro_enterprise: true,
    has_dpo: false, dpo_contact: null, omnibus_enabled: true, tax_id_collection_enabled: true,
  },
  products: [{ product_type: 'one_time', billing_interval: null }],
  integrations: { gtm_container_id: 'GTM-1', facebook_pixel_id: '123', google_ads_conversion_id: null },
  websiteDomain: 'sklep.pl',
} as const;

describe('deriveLegalConfig', () => {
  it('maps company fields', () => {
    const { company } = deriveLegalConfig(baseInput);
    expect(company).toMatchObject({
      name: 'Fundacja X', legalForm: 'fundacja', email: 'info@x.pl',
      street: 'Makuszyńskiego', buildingNo: '10', flatNo: '4', city: 'Warszawa',
      postal: '01-860', nip: '1182105000', regon: '360731957', krs: '0000541407',
      website: 'sklep.pl',
    });
  });

  it('always sets digitalProducts, registerAccount, externalCheckout=Stripe', () => {
    const { flags } = deriveLegalConfig(baseInput);
    expect(flags.digitalProducts).toBe(true);
    expect(flags.registerAccount).toBe(true);
    expect(flags.externalCheckout).toBe(true);
    expect(flags.externalCheckoutProvider).toContain('Stripe');
  });

  it('subscriptionProducts true with yearly period when a yearly subscription exists', () => {
    const { flags } = deriveLegalConfig({
      ...baseInput,
      products: [{ product_type: 'subscription', billing_interval: 'year' }],
    });
    expect(flags.subscriptionProducts).toBe(true);
    expect(flags.subscriptionPeriod).toBe('yearly');
  });

  it('analytics + behaviorAds from integrations', () => {
    const { flags } = deriveLegalConfig(baseInput);
    expect(flags.googleAnalytics).toBe(true);
    expect(flags.facebookAnalytics).toBe(true);
    expect(flags.behaviorAds).toBe(true); // bo facebook_pixel_id != null
  });

  it('vatExempt/microEnterprise/b2bInvoicing/omnibus from explicit fields', () => {
    const { flags } = deriveLegalConfig(baseInput);
    expect(flags.vatExempt).toBe(true);
    expect(flags.microEnterprise).toBe(true);
    expect(flags.b2bInvoicing).toBe(true);
    expect(flags.omnibus).toBe(true);
  });

  it('UGC/chatbot flags stay false (Sellf has none)', () => {
    const { flags } = deriveLegalConfig(baseInput);
    expect(flags.forum).toBe(false);
    expect(flags.addComments).toBe(false);
    expect(flags.aiChatbot).toBe(false);
    expect(flags.intermediaryService).toBe(false);
  });
});

describe('normalizeWebsiteDomain', () => {
  it.each([
    ['http://localhost:3777', 'localhost'],
    ['https://shop.pl', 'shop.pl'],
    ['shop.pl', 'shop.pl'],
    ['shop.pl/path', 'shop.pl'],
    ['http://shop.pl/some/path', 'shop.pl'],
    ['https://sub.domain.com:8443/app', 'sub.domain.com'],
    ['', ''],
  ])('normalizes %s → %s', (input, expected) => {
    expect(normalizeWebsiteDomain(input)).toBe(expected);
  });
});
