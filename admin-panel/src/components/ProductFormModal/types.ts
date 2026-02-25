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
  // Pay What You Want / Custom Pricing
  allow_custom_price: boolean;
  custom_price_min: number;
  show_price_presets: boolean;
  custom_price_presets: number[];
  // OTO (One-Time Offer) configuration
  oto_enabled?: boolean;
  oto_product_id?: string | null;
  oto_discount_type?: 'percentage' | 'fixed';
  oto_discount_value?: number;
  oto_duration_minutes?: number;
}

export interface OtoState {
  enabled: boolean;
  productId: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  durationMinutes: number;
}

export interface UrlValidation {
  isValid: boolean;
  message: string;
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TranslationFunction = (key: string, values?: Record<string, any>) => string;

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

export interface RefundSectionProps extends SectionProps {}

export interface AdvancedSectionProps extends SectionProps {
  omnibusEnabled: boolean;
}

export interface AvailabilitySectionProps extends SectionProps {
  hasWaitlistWebhook: boolean | null;
}

export interface AccessSectionProps extends SectionProps {}

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
  // Pay What You Want / Custom Pricing
  allow_custom_price: false,
  custom_price_min: 5.00,
  show_price_presets: true,
  custom_price_presets: [5, 10, 25]
};

export const initialOtoState: OtoState = {
  enabled: false,
  productId: '',
  discountType: 'percentage',
  discountValue: 20,
  durationMinutes: 15
};
