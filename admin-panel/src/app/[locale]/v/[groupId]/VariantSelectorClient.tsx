'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { useTranslations, useLocale } from 'next-intl';
import { formatPrice } from '@/lib/constants';
import { isSalePriceActive, getEffectiveUnitPrice } from '@/lib/services/omnibus';
import { useConfig } from '@/components/providers/config-provider';
import SellfBranding from '@/components/SellfBranding';
import FloatingToolbar from '@/components/FloatingToolbar';

interface Variant {
  id: string;
  name: string;
  slug: string;
  variant_name: string | null;
  display_order: number;
  is_featured: boolean;
  price: number;
  currency: string;
  description: string | null;
  image_url: string | null;
  icon: string | null;
  is_active: boolean;
  allow_custom_price: boolean;
  custom_price_min: number | null;
  sale_price: number | null;
  sale_price_until: string | null;
  sale_quantity_limit: number | null;
  sale_quantity_sold: number | null;
}

/**
 * Resolve a variant's display pricing using the same shared helpers as the
 * single-product checkout page, so the variant list, the checkout page and the
 * charge layer can never disagree about whether a promo is live.
 */
function getVariantPricing(variant: Variant): {
  isSaleActive: boolean;
  effectivePrice: number;
  saleQuantityRemaining: number | null;
} {
  const isSaleActive = isSalePriceActive(
    variant.sale_price,
    variant.sale_price_until,
    variant.sale_quantity_limit,
    variant.sale_quantity_sold,
  );
  const saleQuantityRemaining = variant.sale_quantity_limit !== null
    ? variant.sale_quantity_limit - (variant.sale_quantity_sold ?? 0)
    : null;
  return {
    isSaleActive,
    effectivePrice: isSaleActive ? getEffectiveUnitPrice(variant) : variant.price,
    saleQuantityRemaining,
  };
}

// Check if string is a valid UUID
const isUUID = (str: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};

interface VariantSelectorClientProps {
  groupId: string;
  licenseValid: boolean;
}

export default function VariantSelectorClient({ groupId, licenseValid }: VariantSelectorClientProps) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('variants');
  const config = useConfig();

  const [variants, setVariants] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchVariants = async () => {
      try {
        const supabase = createBrowserClient(
          config.supabaseUrl,
          config.supabaseAnonKey
        );

        const isId = isUUID(groupId);
        const { data, error: fetchError } = isId
          ? await supabase.rpc('get_variant_group', { p_group_id: groupId })
          : await supabase.rpc('get_variant_group_by_slug', { p_slug: groupId });

        if (fetchError) {
          console.error('[VariantSelectorClient] Error fetching variants:', fetchError);
          setError(t('loadError'));
          return;
        }

        const activeVariants = data.filter((v: Variant) => v.is_active);

        if (!activeVariants || activeVariants.length === 0) {
          setError(t('noVariants'));
          return;
        }

        setVariants(activeVariants);
      } catch (err) {
        console.error('[VariantSelectorClient] Error:', err);
        setError(t('errorOccurred'));
      } finally {
        setLoading(false);
      }
    };

    if (groupId) {
      fetchVariants();
    }
  }, [groupId, config.supabaseUrl, config.supabaseAnonKey]);

  const handleSelectVariant = (slug: string) => {
    router.push(`/${locale}/checkout/${slug}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-sf-deep flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sf-accent"></div>
      </div>
    );
  }

  if (error || variants.length === 0) {
    return (
      <div className="min-h-screen bg-sf-deep flex items-center justify-center px-4">
        <div
          data-testid="variant-not-found"
          className="bg-sf-base border border-sf-border rounded-2xl shadow-[var(--sf-shadow-accent)] p-10 max-w-sm w-full text-center"
        >
          <div className="mx-auto mb-6 w-14 h-14 rounded-xl bg-sf-raised border border-sf-border flex items-center justify-center">
            <svg className="w-7 h-7 text-sf-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-sf-heading mb-2">
            {t('notFound.title')}
          </h1>
          <p className="text-sm text-sf-body leading-relaxed">
            {t('notFound.description')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sf-deep py-12 px-4">
      <FloatingToolbar position="top-right" />
      <main className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl md:text-4xl font-bold text-sf-heading mb-3">
            {t('title')}
          </h1>
          <p className="text-lg text-sf-body">
            {t('subtitle')}
          </p>
        </div>

        {/* Variants Grid */}
        <div className="space-y-4">
          {variants.map((variant) => {
            const { isSaleActive, effectivePrice, saleQuantityRemaining } = getVariantPricing(variant);
            return (
            <div
              key={variant.id}
              onClick={() => handleSelectVariant(variant.slug)}
              className={`
                relative bg-sf-base rounded-2xl
                transition-all duration-300 cursor-pointer border-2
                ${variant.is_featured
                  ? 'border-sf-accent ring-2 ring-sf-accent-soft shadow-[var(--sf-shadow-accent)]'
                  : 'border-sf-border-medium hover:border-sf-border-strong shadow-sm'
                }
              `}
            >
              {/* Featured badge */}
              {variant.is_featured && (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                  <span className="bg-sf-accent-bg text-white text-xs font-bold px-4 py-1 rounded-full uppercase tracking-wider shadow-[var(--sf-shadow-accent)]">
                    {t('popular')}
                  </span>
                </div>
              )}

              <div className="p-6 flex flex-col sm:flex-row items-center gap-5">
                {/* Icon / Image */}
                {(variant.image_url || variant.icon) && (
                  <div className="flex-shrink-0">
                    {variant.image_url ? (
                      <img
                        src={variant.image_url}
                        alt={variant.variant_name || variant.name}
                        className="w-16 h-16 object-cover rounded-xl"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-xl bg-sf-raised flex items-center justify-center border border-sf-border">
                        <span className="text-3xl leading-none">{variant.icon}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Variant Info */}
                <div className="flex-grow min-w-0 text-center sm:text-left">
                  <h2 className="text-lg font-bold text-sf-heading mb-1 leading-snug">
                    {variant.variant_name || variant.name}
                  </h2>
                  {variant.description && (
                    <p className="text-sf-body text-sm line-clamp-2 mb-2">
                      {variant.description}
                    </p>
                  )}
                  {/* PWYW badge */}
                  {variant.allow_custom_price && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-sf-accent-soft text-sf-accent border border-sf-accent/30">
                      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.93V18h-2v-1.07C9.39 16.57 8 15.4 8 14h2c0 .66.9 1 2 1s2-.34 2-1c0-.66-.9-1-2-1-2.21 0-4-1.12-4-3 0-1.4 1.39-2.57 3-2.93V6h2v1.07c1.61.36 3 1.53 3 2.93h-2c0-.66-.9-1-2-1s-2 .34-2 1c0 .66.9 1 2 1 2.21 0 4 1.12 4 3 0 1.4-1.39 2.57-3 2.93z"/>
                      </svg>
                      {t('payWhatYouWant')}
                    </span>
                  )}
                </div>

                {/* Price and CTA */}
                <div className="flex-shrink-0 flex flex-col items-center sm:items-end gap-2">
                  {variant.allow_custom_price ? (
                    /* PWYW pricing */
                    <div className="text-center sm:text-right">
                      <div className="text-xs text-sf-muted mb-0.5">
                        {t('suggestedPrice')}
                      </div>
                      <div className="text-2xl md:text-3xl font-bold text-sf-heading">
                        {formatPrice(variant.price, variant.currency)}
                      </div>
                      {variant.custom_price_min !== null && (
                        <div className="text-xs text-sf-body mt-1 font-medium">
                          {t('minimumFrom', { price: formatPrice(variant.custom_price_min, variant.currency) })}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Fixed pricing — shows the promo price (with the regular
                       price struck through) whenever a sale is active. */
                    <div className="text-center sm:text-right">
                      {isSaleActive && (
                        <div className="text-base font-medium text-sf-muted line-through leading-none">
                          {formatPrice(variant.price, variant.currency)}
                        </div>
                      )}
                      <div className="text-2xl md:text-3xl font-bold text-sf-heading">
                        {formatPrice(effectivePrice, variant.currency)}
                      </div>
                      {isSaleActive && variant.sale_price_until && (
                        <div className="text-xs text-sf-warning mt-1 flex items-center gap-1 justify-center sm:justify-end">
                          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {t('saleEndsAt', {
                            date: new Date(variant.sale_price_until).toLocaleString(locale === 'pl' ? 'pl-PL' : 'en-US', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            }),
                          })}
                        </div>
                      )}
                      {isSaleActive && saleQuantityRemaining !== null && saleQuantityRemaining > 0 && (
                        <div className="text-xs text-sf-warning mt-1 flex items-center gap-1 justify-center sm:justify-end">
                          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          {t('saleQuantityRemaining', { count: saleQuantityRemaining })}
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    className={`
                      px-6 py-2.5 rounded-full font-semibold transition-all duration-200 active:scale-[0.98] whitespace-nowrap
                      ${variant.is_featured
                        ? 'bg-sf-accent-bg text-white hover:bg-sf-accent-hover shadow-[var(--sf-shadow-accent)]'
                        : 'bg-sf-raised text-sf-heading hover:bg-sf-hover'
                      }
                    `}
                  >
                    {t('select')}
                  </button>
                </div>
              </div>
            </div>
            );
          })}
        </div>

        {/* Footer note */}
        <p className="text-center text-sm text-sf-muted mt-8 pb-10">
          {t('securePayment')}
        </p>
      </main>

      {/* Sellf branding — hidden when a valid license is active */}
      {!licenseValid && <SellfBranding />}
    </div>
  );
}
