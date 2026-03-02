'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Product } from '@/types';
import { ProductContentConfig } from '@/types';
import { getIconEmoji } from '@/utils/themeUtils';
import { getCategories, getProductCategories, Category } from '@/lib/actions/categories';
import { getDefaultCurrency, getShopConfig } from '@/lib/actions/shop-config';
import type { TaxMode } from '@/lib/actions/shop-config';
import { parseVideoUrl, isTrustedVideoPlatform } from '@/lib/videoUtils';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api/client';
import {
  ProductFormData,
  OtoState,
  UrlValidation,
  initialFormData,
  initialOtoState,
} from '../types';

interface WaitlistWarning {
  show: boolean;
  productsCount: number;
}

interface UseProductFormProps {
  product?: Product | null;
  isOpen: boolean;
  onSubmit: (formData: ProductFormData) => Promise<void>;
}

export function useProductForm({ product, isOpen, onSubmit }: UseProductFormProps) {
  const [formData, setFormData] = useState<ProductFormData>(initialFormData);
  const [priceDisplayValue, setPriceDisplayValue] = useState<string>('');
  const [salePriceDisplayValue, setSalePriceDisplayValue] = useState<string>('');
  const [slugModified, setSlugModified] = useState(false);
  const [currentDomain, setCurrentDomain] = useState<string>('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Validation errors for required fields
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Products list for OTO selection
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  // Categories management
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);

  // Default currency from shop config
  const [defaultCurrency, setDefaultCurrency] = useState<string>('USD');

  // Omnibus Directive global setting
  const [omnibusEnabled, setOmnibusEnabled] = useState<boolean>(true);

  // Shop-level default VAT rate (from shop_config.tax_rate, stored as decimal e.g. 0.23)
  const [shopDefaultVatRate, setShopDefaultVatRate] = useState<number | null>(null);

  // Tax mode from shop config
  const [taxMode, setTaxMode] = useState<TaxMode>('local');

  // OTO (One-Time Offer) state
  const [oto, setOto] = useState<OtoState>(initialOtoState);

  // URL validation state - maps content item index to validation status
  const [urlValidation, setUrlValidation] = useState<Record<number, UrlValidation>>({});

  // Waitlist warning state
  const [waitlistWarning, setWaitlistWarning] = useState<WaitlistWarning>({ show: false, productsCount: 0 });
  const [pendingSubmitData, setPendingSubmitData] = useState<ProductFormData | null>(null);

  // Waitlist webhook availability (for disabling checkbox)
  const [hasWaitlistWebhook, setHasWaitlistWebhook] = useState<boolean | null>(null);

  // Fetch categories, default currency, and omnibus setting
  useEffect(() => {
    if (isOpen) {
      // Fetch all categories
      const fetchCats = async () => {
        setLoadingCategories(true);
        try {
          const cats = await getCategories();
          setAllCategories(cats);
        } catch (err) {
          console.error('Failed to fetch categories', err);
        } finally {
          setLoadingCategories(false);
        }
      };
      fetchCats();

      // Fetch default currency for new products
      if (!product) {
        getDefaultCurrency().then(currency => {
          setDefaultCurrency(currency);
        }).catch(err => {
          console.error('Failed to fetch default currency', err);
        });
      }

      // Fetch Omnibus Directive global setting, default VAT rate, and tax mode
      getShopConfig().then(config => {
        if (config) {
          setOmnibusEnabled(config.omnibus_enabled);
          // tax_rate is stored as decimal (0.23 = 23%)
          setShopDefaultVatRate(config.tax_rate ?? null);
          setTaxMode((config.tax_mode as TaxMode) || 'local');
        }
      }).catch(err => {
        console.error('Failed to fetch shop config', err);
      });

      // Fetch waitlist webhook availability
      (async () => {
        try {
          const supabase = await createClient();
          const { data, error } = await supabase.rpc('check_waitlist_config');
          if (!error && data) {
            setHasWaitlistWebhook(data.has_webhook);
          }
        } catch (err) {
          console.error('Failed to fetch waitlist config', err);
        }
      })();
    }
  }, [isOpen, product]);

  // Initialize form data when product changes or modal opens
  useEffect(() => {
    if (product) {
      // For existing products
      setFormData({
        name: product.name,
        slug: product.slug,
        description: product.description,
        long_description: product.long_description || '',
        price: product.price,
        currency: product.currency || 'USD',
        is_active: product.is_active,
        is_featured: product.is_featured || false,
        is_listed: product.is_listed !== false,
        icon: product.icon || getIconEmoji('rocket'),
        image_url: product.image_url || null,
        available_from: product.available_from || '',
        available_until: product.available_until || '',
        auto_grant_duration_days: product.auto_grant_duration_days || null,
        content_delivery_type: product.content_delivery_type || 'content',
        content_config: product.content_config || { content_items: [] },
        success_redirect_url: product.success_redirect_url || '',
        pass_params_to_redirect: product.pass_params_to_redirect || false,
        categories: [],
        omnibus_exempt: product.omnibus_exempt || false,
        sale_price: product.sale_price || null,
        sale_price_until: product.sale_price_until || null,
        sale_quantity_limit: product.sale_quantity_limit || null,
        sale_quantity_sold: product.sale_quantity_sold || 0,
        is_refundable: (product as Product & { is_refundable?: boolean }).is_refundable || false,
        refund_period_days: (product as Product & { refund_period_days?: number | null }).refund_period_days || null,
        // Waitlist settings
        enable_waitlist: product.enable_waitlist || false,
        // VAT/Tax
        vat_rate: product.vat_rate ?? null,
        price_includes_vat: product.price_includes_vat ?? true,
        // Pay What You Want / Custom Pricing
        allow_custom_price: product.allow_custom_price || false,
        custom_price_min: product.custom_price_min ?? 5.00,
        show_price_presets: product.show_price_presets !== false, // default true
        custom_price_presets: Array.isArray(product.custom_price_presets) ? product.custom_price_presets : [5, 10, 25]
      });

      // Fetch assigned categories
      getProductCategories(product.id).then(catIds => {
        setFormData(prev => ({ ...prev, categories: catIds }));
      }).catch(err => console.error(err));

      // Fetch OTO configuration for this product using v1 API
      api.getCustom<{ has_oto: boolean; oto_product_id?: string; discount_type?: 'percentage' | 'fixed'; discount_value?: number; duration_minutes?: number }>(`products/${product.id}/oto`)
        .then(data => {
          if (data.has_oto) {
            setOto({
              enabled: true,
              productId: data.oto_product_id || '',
              discountType: data.discount_type || 'percentage',
              discountValue: data.discount_value || 20,
              durationMinutes: data.duration_minutes || 15
            });
          } else {
            setOto(initialOtoState);
          }
        })
        .catch(err => {
          console.error('Failed to fetch OTO config:', err);
        });

      // Set display value for price
      setPriceDisplayValue(product.price.toString().replace('.', ','));
      setSalePriceDisplayValue(product.sale_price ? product.sale_price.toString().replace('.', ',') : '');
      setSlugModified(true);
    } else {
      // For new products — copy shop default VAT rate so it's explicit per product
      setFormData({
        ...initialFormData,
        currency: defaultCurrency,
        icon: getIconEmoji('rocket'),
        vat_rate: shopDefaultVatRate != null ? Math.round(shopDefaultVatRate * 100) : null,
      });
      setPriceDisplayValue('');
      setSalePriceDisplayValue('');
      setSlugModified(false);
      setOto(initialOtoState);
    }

    // Focus the name input when the modal opens
    if (isOpen) {
      setTimeout(() => {
        nameInputRef.current?.focus();
      }, 100);
    }
  }, [product, isOpen, defaultCurrency]);

  // When shop default VAT rate loads, apply it to new products (if user hasn't set one yet)
  useEffect(() => {
    if (!product && isOpen && shopDefaultVatRate != null) {
      setFormData(prev => {
        if (prev.vat_rate != null) return prev; // user already set a value
        return { ...prev, vat_rate: Math.round(shopDefaultVatRate * 100) };
      });
    }
  }, [product, isOpen, shopDefaultVatRate]);

  // Fetch products for OTO dropdown using v1 API
  useEffect(() => {
    const fetchProducts = async () => {
      if (!isOpen) return;
      try {
        setLoadingProducts(true);
        const response = await api.list<Product>('products', {
          limit: 1000,
          status: 'active',
          sort: 'name',
        });
        setProducts(response.data || []);
      } catch (err) {
        console.error('Failed to fetch products', err);
      } finally {
        setLoadingProducts(false);
      }
    };
    fetchProducts();
  }, [isOpen]);

  // Get the current domain when the component mounts
  useEffect(() => {
    if (typeof window !== 'undefined' && isOpen) {
      const origin = window.location.origin;
      const mainDomain = origin.replace(/\/\/admin\./, '//');
      setCurrentDomain(mainDomain);
    }
  }, [isOpen]);

  // Generate slug from product name
  const generateSlug = useCallback((name: string): string => {
    return name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/--+/g, '-')
      .trim();
  }, []);

  // Validate content item URL
  const validateContentItemUrl = useCallback((url: string, type: 'video_embed' | 'download_link'): UrlValidation => {
    if (!url || url.trim() === '') {
      return { isValid: false, message: 'URL is required' };
    }

    if (type === 'video_embed') {
      const parsed = parseVideoUrl(url);
      if (!parsed.isValid) {
        if (!isTrustedVideoPlatform(url)) {
          return {
            isValid: false,
            message: 'Untrusted platform. Supported: YouTube, Vimeo, Bunny.net, Loom, Wistia, DailyMotion, Twitch'
          };
        }
        return {
          isValid: false,
          message: 'Invalid video URL format. Please check the URL.'
        };
      }
      return {
        isValid: true,
        message: `✓ ${parsed.platform === 'youtube' ? 'YouTube' : parsed.platform === 'vimeo' ? 'Vimeo' : parsed.platform === 'bunny' ? 'Bunny.net' : parsed.platform === 'loom' ? 'Loom' : parsed.platform === 'wistia' ? 'Wistia' : parsed.platform === 'dailymotion' ? 'DailyMotion' : parsed.platform === 'twitch' ? 'Twitch' : 'Valid'} video detected`
      };
    } else if (type === 'download_link') {
      try {
        const urlObj = new URL(url);

        if (urlObj.protocol !== 'https:') {
          return {
            isValid: false,
            message: 'Download URL must use HTTPS'
          };
        }

        const trustedStorageProviders = [
          'amazonaws.com', 'googleapis.com', 'supabase.co', 'cdn.', 'storage.',
          'bunny.net', 'b-cdn.net', 'drive.google.com', 'docs.google.com',
          'dropbox.com', 'dl.dropboxusercontent.com', 'onedrive.live.com',
          '1drv.ms', 'sharepoint.com', 'box.com', 'mega.nz', 'mediafire.com',
          'wetransfer.com', 'sendspace.com', 'cloudinary.com', 'imgix.net', 'fastly.net'
        ];

        const isTrustedStorage = trustedStorageProviders.some(provider =>
          urlObj.hostname.includes(provider)
        );

        if (!isTrustedStorage) {
          return {
            isValid: false,
            message: 'URL must be from a trusted storage provider (AWS, Google Drive, Dropbox, OneDrive, CDN, etc.)'
          };
        }

        return {
          isValid: true,
          message: '✓ Valid download URL'
        };
      } catch {
        return {
          isValid: false,
          message: 'Invalid URL format'
        };
      }
    }

    return { isValid: false, message: 'Unknown type' };
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;

    // Clear field error on change
    if (fieldErrors[name]) {
      setFieldErrors(prev => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }

    if (name === 'name' && !slugModified) {
      setFormData(prev => ({
        ...prev,
        [name]: value,
        slug: generateSlug(value)
      }));
    } else if (name === 'slug') {
      setSlugModified(true);
      setFormData(prev => ({
        ...prev,
        [name]: generateSlug(value)
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: type === 'checkbox'
          ? (e.target as HTMLInputElement).checked
          : value
      }));
    }
  }, [slugModified, generateSlug]);

  const handleCheckboxChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: checked
    }));
  }, []);

  const handleIconSelect = useCallback((icon: string) => {
    setFormData(prev => ({
      ...prev,
      icon: icon
    }));
  }, []);

  // Handler for product select dropdown (redirect URL)
  const handleProductSelect = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedSlug = e.target.value;
    if (!selectedSlug) {
      setFormData(prev => ({ ...prev, success_redirect_url: '' }));
      setOto(prev => ({ ...prev, productId: '', enabled: false }));
      return;
    }

    const selectedProduct = products.find(p => p.slug === selectedSlug);
    const currentUrl = formData.success_redirect_url || '';
    const queryParams = currentUrl.includes('?') ? currentUrl.split('?')[1] : '';
    const newUrl = `/checkout/${selectedSlug}${queryParams ? `?${queryParams}` : ''}`;

    setFormData(prev => ({ ...prev, success_redirect_url: newUrl }));

    if (selectedProduct && selectedProduct.price > 0) {
      setOto(prev => ({ ...prev, productId: selectedProduct.id }));
    } else {
      setOto(prev => ({ ...prev, productId: '', enabled: false }));
    }
  }, [products, formData.success_redirect_url]);

  // Helper to detect if redirect URL points to an internal product
  const getSelectedProductFromUrl = useCallback((): Product | null => {
    const url = formData.success_redirect_url || '';
    const match = url.match(/\/checkout\/([^/?]+)/);
    if (match) {
      const slug = match[1];
      return products.find(p => p.slug === slug) || null;
    }
    return null;
  }, [formData.success_redirect_url, products]);

  const selectedRedirectProduct = getSelectedProductFromUrl();
  const canShowOtoOption = selectedRedirectProduct && selectedRedirectProduct.price > 0 && selectedRedirectProduct.id !== product?.id;

  // Handler for hide bump checkbox
  const handleHideBumpChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = e.target.checked;
    let currentUrl = formData.success_redirect_url || '';

    try {
      const isRelative = currentUrl.startsWith('/');
      const baseUrl = 'http://dummy.com';
      const urlObj = new URL(currentUrl, baseUrl);

      if (isChecked) {
        urlObj.searchParams.set('hide_bump', 'true');
      } else {
        urlObj.searchParams.delete('hide_bump');
      }

      const newUrlString = isRelative
        ? urlObj.pathname + urlObj.search
        : urlObj.toString();

      setFormData(prev => ({ ...prev, success_redirect_url: newUrlString }));
    } catch {
      if (isChecked && !currentUrl.includes('hide_bump=true')) {
        const separator = currentUrl.includes('?') ? '&' : '?';
        setFormData(prev => ({ ...prev, success_redirect_url: `${currentUrl}${separator}hide_bump=true` }));
      } else if (!isChecked) {
        setFormData(prev => ({ ...prev, success_redirect_url: currentUrl.replace(/[?&]hide_bump=true/, '') }));
      }
    }
  }, [formData.success_redirect_url]);

  // Check waitlist configuration via RPC
  const checkWaitlistConfig = useCallback(async (): Promise<{ has_webhook: boolean; products_count: number }> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('check_waitlist_config');
    if (error) {
      console.error('Failed to check waitlist config:', error);
      return { has_webhook: true, products_count: 0 }; // Assume OK on error
    }
    return data as { has_webhook: boolean; products_count: number };
  }, []);

  // Proceed with submit after user confirms waitlist warning
  const proceedWithSubmit = useCallback(() => {
    if (pendingSubmitData) {
      onSubmit(pendingSubmitData);
      setPendingSubmitData(null);
      setWaitlistWarning({ show: false, productsCount: 0 });
    }
  }, [pendingSubmitData, onSubmit]);

  // Dismiss waitlist warning
  const dismissWaitlistWarning = useCallback(() => {
    setWaitlistWarning({ show: false, productsCount: 0 });
    setPendingSubmitData(null);
  }, []);

  // Validate required fields — returns true if valid
  const validateRequiredFields = useCallback((): boolean => {
    const errors: Record<string, string> = {};
    if (!formData.name.trim()) errors.name = 'required';
    if (!formData.slug.trim()) errors.slug = 'required';
    if (!formData.description.trim()) errors.description = 'required';
    if (priceDisplayValue === '') errors.price = 'required';

    // In local tax mode: VAT rate is required when no shop default is set
    if (taxMode === 'local' && formData.price_includes_vat && formData.vat_rate == null) {
      errors.vat_rate = 'required';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      if (errors.name) nameInputRef.current?.focus();
      return false;
    }
    setFieldErrors({});
    return true;
  }, [formData.name, formData.slug, formData.description, formData.price_includes_vat, formData.vat_rate, priceDisplayValue, taxMode]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateRequiredFields()) return;

    // Validate all content items with URLs before submission
    if (formData.content_delivery_type === 'content') {
      const contentItems = (formData.content_config as ProductContentConfig)?.content_items || [];
      const invalidItems: number[] = [];

      contentItems.forEach((item, index) => {
        if (item.type === 'video_embed' || item.type === 'download_link') {
          const url = item.type === 'video_embed'
            ? item.config?.embed_url
            : item.config?.download_url;

          if (url) {
            const validation = validateContentItemUrl(url, item.type);
            if (!validation.isValid) {
              invalidItems.push(index);
              setUrlValidation(prev => ({
                ...prev,
                [index]: validation
              }));
            }
          }
        }
      });

      if (invalidItems.length > 0) {
        return;
      }
    }

    // Include OTO data in the form submission
    const submitData: ProductFormData = {
      ...formData,
      oto_enabled: oto.enabled,
      oto_product_id: oto.enabled && oto.productId ? oto.productId : null,
      oto_discount_type: oto.discountType,
      oto_discount_value: oto.discountValue,
      oto_duration_minutes: oto.durationMinutes,
    };

    // Check waitlist config if enabling waitlist
    if (formData.enable_waitlist) {
      const config = await checkWaitlistConfig();
      if (!config.has_webhook) {
        // Show warning modal
        setPendingSubmitData(submitData);
        setWaitlistWarning({ show: true, productsCount: config.products_count });
        return;
      }
    }

    onSubmit(submitData);
  }, [formData, oto, onSubmit, validateContentItemUrl, checkWaitlistConfig]);

  return {
    // Form data
    formData,
    setFormData,
    priceDisplayValue,
    setPriceDisplayValue,
    salePriceDisplayValue,
    setSalePriceDisplayValue,
    slugModified,
    setSlugModified,
    currentDomain,
    nameInputRef,

    // Products
    products,
    loadingProducts,

    // Categories
    allCategories,
    loadingCategories,

    // Settings
    defaultCurrency,
    omnibusEnabled,
    shopDefaultVatRate,
    taxMode,

    // OTO
    oto,
    setOto,
    selectedRedirectProduct,
    canShowOtoOption,

    // Validation
    fieldErrors,
    setFieldErrors,
    urlValidation,
    setUrlValidation,

    // Handlers
    handleInputChange,
    handleCheckboxChange,
    handleIconSelect,
    handleProductSelect,
    handleHideBumpChange,
    handleSubmit,

    // Utilities
    generateSlug,
    validateContentItemUrl,
    validateRequiredFields,

    // Waitlist warning
    waitlistWarning,
    proceedWithSubmit,
    dismissWaitlistWarning,
    hasWaitlistWebhook,
  };
}
