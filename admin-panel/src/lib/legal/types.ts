export type LegalForm = 'jdg' | 'spzoo' | 'fundacja' | 'osoba_fizyczna';

export interface LegalCompany {
  name: string; legalForm: LegalForm; email: string;
  street: string; buildingNo: string; city: string; postal: string;
  flatNo?: string; emailComplaints?: string; website?: string;
  nip?: string; regon?: string; krs?: string; phone?: string;
}

// Pełny obiekt flag — wartości domyślne false; legal-engine i tak wymaga kompletu.
export interface LegalFlags {
  registerAccount: boolean; newsletter: boolean; contactForm: boolean;
  addComments: boolean; rateProducts: boolean; forum: boolean;
  otherTools: boolean; otherToolsName?: string;
  newProducts: boolean; usedProducts: boolean; digitalProducts: boolean;
  subscriptionProducts: boolean; subscriptionPeriod?: 'monthly'|'quarterly'|'yearly';
  guarantee: boolean; basedEu: boolean; microEnterprise: boolean;
  intermediaryService: boolean; externalCheckout: boolean; externalCheckoutProvider?: string;
  omnibus: boolean; vatExempt: boolean; b2bInvoicing: boolean;
  aiChatbot: boolean; aiContentGen: boolean; moderateContent: boolean; userTerms: boolean;
  storeFirstName: boolean; storeLastName: boolean; storeEmail: boolean;
  storeTelephone: boolean; storeAddress: boolean; storePesel: boolean;
  storeNip: boolean; storeIdNumber: boolean; storeBirthdate: boolean;
  storeOther: boolean; storeOtherName?: string; storeOtherPurpose?: string;
  contextAds: boolean; behaviorAds: boolean;
  googleAnalytics: boolean; facebookAnalytics: boolean;
  twitterAnalytics: boolean; linkedinAnalytics: boolean;
  userPolicy: boolean; hasDpo: boolean; dpoEmail?: string;
}

export const BASE_FLAGS: LegalFlags = {
  registerAccount: false, newsletter: false, contactForm: false, addComments: false,
  rateProducts: false, forum: false, otherTools: false, newProducts: false,
  usedProducts: false, digitalProducts: false, subscriptionProducts: false,
  guarantee: false, basedEu: true, microEnterprise: false, intermediaryService: false,
  externalCheckout: false, omnibus: true, vatExempt: false, b2bInvoicing: false,
  aiChatbot: false, aiContentGen: false, moderateContent: false, userTerms: false,
  storeFirstName: false, storeLastName: false, storeEmail: false, storeTelephone: false,
  storeAddress: false, storePesel: false, storeNip: false, storeIdNumber: false,
  storeBirthdate: false, storeOther: false, contextAds: false, behaviorAds: false,
  googleAnalytics: false, facebookAnalytics: false, twitterAnalytics: false,
  linkedinAnalytics: false, userPolicy: false, hasDpo: false,
};

export interface SellerShopConfig {
  country?: string | null;
  shop_name: string | null; company_legal_name: string | null;
  legal_form: LegalForm | null; contact_email: string | null; complaints_email: string | null;
  nip: string | null; regon: string | null; krs: string | null;
  company_street: string | null; company_building_no: string | null; company_flat_no: string | null;
  company_city: string | null; company_postal: string | null; company_phone: string | null;
  is_vat_exempt: boolean; is_micro_enterprise: boolean;
  has_dpo: boolean; dpo_contact: string | null;
  omnibus_enabled: boolean | null; tax_id_collection_enabled: boolean | null;
}
export interface SellerIntegrations {
  gtm_container_id: string | null; facebook_pixel_id: string | null;
  google_ads_conversion_id: string | null;
}
export interface DeriveInput {
  shopConfig: SellerShopConfig;
  products: { product_type: string; billing_interval: string | null }[];
  integrations: SellerIntegrations;
  websiteDomain: string;
}
