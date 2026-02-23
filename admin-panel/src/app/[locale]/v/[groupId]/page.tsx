'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { useTranslations, useLocale } from 'next-intl';
import { formatPrice } from '@/lib/constants';
import { useConfig } from '@/components/providers/config-provider';

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
  is_active: boolean;
}

// Check if string is a valid UUID
const isUUID = (str: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};

export default function VariantSelectorPage() {
  const params = useParams();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('variants');
  const config = useConfig();

  const groupIdOrSlug = params.groupId as string;

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

        // Use UUID function if it's a UUID, otherwise use slug function
        const isId = isUUID(groupIdOrSlug);
        const { data, error: fetchError } = isId
          ? await supabase.rpc('get_variant_group', { p_group_id: groupIdOrSlug })
          : await supabase.rpc('get_variant_group_by_slug', { p_slug: groupIdOrSlug });

        if (fetchError) {
          console.error('Error fetching variants:', fetchError);
          setError('Failed to load variants');
          return;
        }

        // Filter to only show active variants for public selector
        const activeVariants = data.filter((v: Variant) => v.is_active);

        if (!activeVariants || activeVariants.length === 0) {
          setError('No variants found');
          return;
        }

        setVariants(activeVariants);
      } catch (err) {
        console.error('Error:', err);
        setError('An error occurred');
      } finally {
        setLoading(false);
      }
    };

    if (groupIdOrSlug) {
      fetchVariants();
    }
  }, [groupIdOrSlug, config.supabaseUrl, config.supabaseAnonKey]);

  const handleSelectVariant = (slug: string) => {
    router.push(`/${locale}/checkout/${slug}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gf-accent"></div>
      </div>
    );
  }

  if (error || variants.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 max-w-md mx-4">
          <div className="text-center">
            <div className="text-6xl mb-4">😕</div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {t('notFound.title', { defaultValue: 'Variants Not Found' })}
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              {t('notFound.description', { defaultValue: 'The requested product variants could not be found.' })}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Get the first variant's name as the product name
  const productName = variants[0]?.name || 'Product';

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-3">
            {t('title', { defaultValue: 'Choose Your Option' })}
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            {t('subtitle', { defaultValue: 'Select the option that best fits your needs' })}
          </p>
        </div>

        {/* Variants Grid */}
        <div className="space-y-4">
          {variants.map((variant) => (
            <div
              key={variant.id}
              onClick={() => handleSelectVariant(variant.slug)}
              className={`
                relative bg-white dark:bg-gray-800 rounded-2xl shadow-lg hover:shadow-xl
                transition-all duration-300 cursor-pointer border-2
                ${variant.is_featured
                  ? 'border-gf-accent ring-2 ring-purple-500/20'
                  : 'border-transparent hover:border-purple-300 dark:hover:border-purple-700'
                }
              `}
            >
              {/* Featured badge */}
              {variant.is_featured && (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                  <span className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-xs font-bold px-4 py-1 rounded-full uppercase tracking-wider shadow-lg">
                    {t('popular', { defaultValue: 'Most Popular' })}
                  </span>
                </div>
              )}

              <div className="p-6 flex flex-col md:flex-row items-center gap-6">
                {/* Variant Image */}
                {variant.image_url && (
                  <div className="flex-shrink-0">
                    <img
                      src={variant.image_url}
                      alt={variant.variant_name || variant.name}
                      className="w-24 h-24 object-cover rounded-xl shadow-md"
                    />
                  </div>
                )}

                {/* Variant Info */}
                <div className="flex-grow text-center md:text-left">
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                    {variant.variant_name || variant.name}
                  </h3>
                  {variant.description && (
                    <p className="text-gray-600 dark:text-gray-400 text-sm line-clamp-2">
                      {variant.description}
                    </p>
                  )}
                </div>

                {/* Price and CTA */}
                <div className="flex-shrink-0 text-center md:text-right">
                  <div className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-2">
                    {formatPrice(variant.price, variant.currency)} {variant.currency}
                  </div>
                  <button
                    className={`
                      px-6 py-2.5 rounded-xl font-semibold transition-all duration-200
                      ${variant.is_featured
                        ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700 shadow-lg hover:shadow-xl'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-600'
                      }
                    `}
                  >
                    {t('select', { defaultValue: 'Select' })}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer note */}
        <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-8">
          {t('securePayment', { defaultValue: 'Secure payment • Instant access' })}
        </p>
      </div>
    </div>
  );
}
