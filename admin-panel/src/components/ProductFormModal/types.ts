import { Product, ContentItem } from '@/types';
import { Category } from '@/lib/actions/categories';

export interface ProductFormModalProps {
  product?: Product | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (formData: ProductFormData) => Promise<void>;
  isSubmitting: boolean;
  error: string | null;
}

export interface ProductFormData {
  name: string;
  slug: string;
  description: string;
  long_description?: string | null;
  price: number;
  currency: string;
  is_active: boolean;
  is_featured: boolean;
  is_listed: boolean;
  icon: string;
  image_url?: string | null;
  preview_video_url?: string | null;
  preview_video_config?: import('@/components/player/VideoOptionsPanel').VideoOptionsConfig | null;
  // Temporal availability fields
  available_from?: string | null;
  available_until?: string | null;
  // Auto-grant access duration for users
  auto_grant_duration_days?: number | null;
  // Content delivery fields
  content_delivery_type: 'redirect' | 'content';
  content_config: {
    redirect_url?: string;
    content_items?: ContentItem[];
  };
  // Funnel / OTO settings
  success_redirect_url?: string | null;
  pass_params_to_redirect: boolean;
  // Categories
  categories: string[];
  // EU Omnibus Directive
  omnibus_exempt: boolean;
  // Sale price (promotional pricing)
  sale_price?: number | null;
  sale_price_until?: string | null;
  sale_quantity_limit?: number | null;
  sale_quantity_sold?: number;
  // Refund settings
  is_refundable: boolean;
  refund_period_days?: number | null;
  // Waitlist settings (for inactive products)
  enable_waitlist: boolean;
  // VAT/Tax configuration
  vat_rate?: number | null;
  price_includes_vat: boolean;
  vat_exempt: boolean;
  vat_exempt_note: string | null;
  // Pay What You Want / Custom Pricing
  allow_custom_price: boolean;
  custom_price_min: number;
  show_price_presets: boolean;
  custom_price_presets: number[];
  // Embed checkout (per-product toggle)
  embed_enabled: boolean;
  // License keys (signed JWT issued on purchase)
  issue_license_on_purchase: boolean;
  license_tier?: string | null;
  license_duration_days?: number | null;
  // OTO (One-Time Offer) configuration
  oto_enabled?: boolean;
  oto_product_id?: string | null;
  oto_discount_type?: 'percentage' | 'fixed';
  oto_discount_value?: number;
  oto_duration_minutes?: number;
  oto_downsell_product_id?: string | null;
  oto_downsell_discount_type?: 'percentage' | 'fixed';
  oto_downsell_discount_value?: number;
  oto_downsell_duration_minutes?: number;
  // Subscription (Phase 4 — Subscriptions MVP)
  product_type: 'one_time' | 'subscription';
  billing_interval: 'day' | 'week' | 'month' | 'year' | null;
  billing_interval_count: number | null;
  recurring_price: number | null;
  trial_days: number | null;
  // Checkout template + custom fields (Phase 3 — checkout-templates feat)
  checkout_template: string;
  custom_checkout_fields: import('@/lib/validations/custom-checkout-fields').CustomFieldDefinition[];
  // UX product type — form-only state surfacing which radio card the seller
  // picked. Not persisted to the DB; on edit we derive it from the loaded
  // product via inferProductTypeFromForm.
  ux_product_type: import('@/lib/product-defaults').UxProductType;
}

export interface OtoState {
  enabled: boolean;
  productId: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  durationMinutes: number;
  // Downsell branch — optional. When `downsellEnabled` is false the four
  // downsell_* columns are persisted as NULL (no decline path).
  downsellEnabled: boolean;
  downsellProductId: string;
  downsellDiscountType: 'percentage' | 'fixed';
  downsellDiscountValue: number;
  downsellDurationMinutes: number;
}

export interface UrlValidation {
  isValid: boolean;
  message: string;
  /** Detected platform name (e.g. 'youtube', 'vimeo') — used for conditional UI */
  platform?: string;
}

export interface ProductFormState {
  formData: ProductFormData;
  priceDisplayValue: string;
  salePriceDisplayValue: string;
  slugModified: boolean;
  currentDomain: string;
  products: Product[];
  loadingProducts: boolean;
  allCategories: Category[];
  loadingCategories: boolean;
  defaultCurrency: string;
  omnibusEnabled: boolean;
  oto: OtoState;
  urlValidation: Record<number, UrlValidation>;
}

// Translation function type - compatible with next-intl
export type TranslationFunction = (key: string, values?: Record<string, string | number | Date>) => string;

// Section props - common interface for all sections
export interface SectionProps {
  formData: ProductFormData;
  setFormData: React.Dispatch<React.SetStateAction<ProductFormData>>;
  t: TranslationFunction;
}

export interface BasicInfoSectionProps extends SectionProps {
  nameInputRef: React.RefObject<HTMLInputElement | null>;
  slugModified: boolean;
  setSlugModified: (value: boolean) => void;
  currentDomain: string;
  generateSlug: (name: string) => string;
  fieldErrors?: Record<string, string>;
}

export interface PricingSectionProps extends SectionProps {
  priceDisplayValue: string;
  setPriceDisplayValue: (value: string) => void;
}

export interface SalePriceSectionProps extends SectionProps {
  salePriceDisplayValue: string;
  setSalePriceDisplayValue: (value: string) => void;
  omnibusEnabled: boolean;
}

export interface ContentDeliverySectionProps extends SectionProps {
  urlValidation: Record<number, UrlValidation>;
  setUrlValidation: React.Dispatch<React.SetStateAction<Record<number, UrlValidation>>>;
  validateContentItemUrl: (url: string, type: 'video_embed' | 'download_link') => UrlValidation;
}

export interface PostPurchaseSectionProps extends SectionProps {
  products: Product[];
  loadingProducts: boolean;
  currentProductId?: string;
  oto: OtoState;
  setOto: React.Dispatch<React.SetStateAction<OtoState>>;
}

export interface CategoriesSectionProps extends SectionProps {
  allCategories: Category[];
  loadingCategories: boolean;
}

export type RefundSectionProps = SectionProps;

export interface AdvancedSectionProps extends SectionProps {
  omnibusEnabled: boolean;
}

export interface AvailabilitySectionProps extends SectionProps {
  hasWaitlistWebhook: boolean | null;
}

export interface AccessSectionProps extends SectionProps {
  hasLicenseIssuance?: boolean;
}

// Initial form data
export const initialFormData: ProductFormData = {
  name: '',
  slug: '',
  description: '',
  long_description: '',
  price: 0,
  currency: 'USD',
  is_active: true,
  is_featured: false,
  is_listed: true,
  icon: '🚀',
  image_url: null,
  preview_video_url: null,
  preview_video_config: null,
  available_from: '',
  available_until: '',
  auto_grant_duration_days: null,
  content_delivery_type: 'content',
  content_config: {
    content_items: []
  },
  success_redirect_url: '',
  pass_params_to_redirect: false,
  categories: [],
  omnibus_exempt: false,
  sale_price: null,
  sale_price_until: null,
  sale_quantity_limit: null,
  sale_quantity_sold: 0,
  is_refundable: false,
  refund_period_days: null,
  // Waitlist settings
  enable_waitlist: false,
  // VAT/Tax
  vat_rate: null,
  price_includes_vat: true,
  vat_exempt: false,
  vat_exempt_note: null,
  // Pay What You Want / Custom Pricing
  allow_custom_price: false,
  custom_price_min: 5.00,
  show_price_presets: true,
  custom_price_presets: [5, 10, 25],
  // Embed checkout
  embed_enabled: false,
  // License keys
  issue_license_on_purchase: false,
  license_tier: null,
  license_duration_days: null,
  // Subscription (Phase 4 — Subscriptions MVP)
  product_type: 'one_time',
  billing_interval: null,
  billing_interval_count: null,
  recurring_price: null,
  trial_days: null,
  // Checkout template + custom fields (Phase 3 — checkout-templates feat)
  checkout_template: 'default',
  custom_checkout_fields: [],
  ux_product_type: 'standard',
};

export const initialOtoState: OtoState = {
  enabled: false,
  productId: '',
  discountType: 'percentage',
  discountValue: 20,
  durationMinutes: 15,
  downsellEnabled: false,
  downsellProductId: '',
  downsellDiscountType: 'percentage',
  downsellDiscountValue: 50,
  downsellDurationMinutes: 15,
};
