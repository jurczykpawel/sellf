'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslations, useLocale } from 'next-intl';
import DashboardLayout from '@/components/DashboardLayout';
import { useConfig } from '@/components/providers/config-provider';

interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  image_url: string | null;
  price: number;
  currency: string;
  is_active: boolean;
  is_featured: boolean;
  created_at: string;
}

interface UserProductAccess {
  id: string;
  product: Product;
  granted_at: string;
  sellerSlug?: string;
  sellerDisplayName?: string;
}

interface CrossSchemaProduct {
  seller_slug: string;
  seller_display_name: string;
  product_id: string;
  product_name: string;
  product_slug: string;
  product_icon: string;
  product_price: number;
  product_currency: string;
  access_granted_at: string;
  access_expires_at: string | null;
}

function ProductImage({ src, alt, icon }: { src: string; alt: string; icon: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="h-40 flex items-center justify-center bg-sf-float">
        <span className="text-6xl">{icon || '📦'}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
      onError={() => setFailed(true)}
    />
  );
}

function formatDateLocalized(dateString: string, locale: string) {
  return new Date(dateString).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatPriceLocalized(price: number | null, currency: string | null = 'USD', locale: string = 'en-US', naLabel = 'N/A', invalidLabel = 'Invalid Price') {
  if (price === null) return naLabel;
  const numericPrice = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(numericPrice)) return invalidLabel;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency || 'USD',
  }).format(numericPrice);
}

export default function MyProductsPage() {
  const { user, loading: authLoading } = useAuth();
  const { marketplaceEnabled } = useConfig();
  const t = useTranslations('myProducts');
  const locale = useLocale();
  const [userProducts, setUserProducts] = useState<UserProductAccess[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProductsData = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const supabase = await createClient();

      // Cross-schema RPC: fetches user's products from ALL seller schemas.
      // Works for both single-tenant (seller_main only) and marketplace mode.
      const { data: crossData, error: crossError } = await supabase
        .rpc('get_user_products_all_sellers');

      if (crossError) throw crossError;

      const transformedUserProducts: UserProductAccess[] = ((crossData || []) as CrossSchemaProduct[])
        .filter((p) => {
          // Exclude expired access
          if (p.access_expires_at && new Date(p.access_expires_at) < new Date()) return false;
          return true;
        })
        .map((p) => ({
          id: p.product_id,
          granted_at: p.access_granted_at,
          sellerSlug: p.seller_slug !== 'main' ? p.seller_slug : undefined,
          sellerDisplayName: p.seller_slug !== 'main' ? p.seller_display_name : undefined,
          product: {
            id: p.product_id,
            name: p.product_name,
            slug: p.product_slug,
            description: '',
            icon: p.product_icon || '',
            image_url: null,
            price: p.product_price,
            currency: p.product_currency,
            is_active: true,
            is_featured: false,
            created_at: p.access_granted_at,
          },
        }));

      setUserProducts(transformedUserProducts);

      // "Discover more" — only in single-tenant mode.
      // In marketplace, promoted products require a separate feature (seller ads).
      if (!marketplaceEnabled) {
        const { data: allProductsData } = await supabase
          .from('products')
          .select('*')
          .eq('is_active', true)
          .eq('is_listed', true)
          .order('is_featured', { ascending: false })
          .order('price', { ascending: true });
        setAllProducts(allProductsData || []);
      } else {
        setAllProducts([]);
      }

    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to load products data.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading) {
      fetchProductsData();
    }
  }, [authLoading, fetchProductsData]);

  if (authLoading || loading) {
    return (
      <DashboardLayout user={user ? {
        email: user.email || '',
        id: user.id || ''
      } : null}>
        <div className="bg-sf-deep flex items-center justify-center min-h-96">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-sf-accent mx-auto mb-4"></div>
            <p className="text-sf-body">{t('loadingProducts')}</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (error) {
    return (
      <DashboardLayout user={user ? {
        email: user.email || '',
        id: user.id || ''
      } : null}>
        <div className="bg-sf-deep flex items-center justify-center min-h-96">
          <div className="text-center p-4">
            <div className="text-sf-danger text-6xl mb-4">⚠️</div>
            <h1 className="text-2xl font-bold text-sf-heading mb-2">{t('errorTitle')}</h1>
            <p className="text-sf-body mb-6">{error}</p>
            <button 
              onClick={fetchProductsData} 
              className="px-6 py-3 bg-sf-accent-bg hover:bg-sf-accent-hover text-white rounded-full transition-colors active:scale-[0.98]"
            >
              {t('tryAgain')}
            </button>
          </div>
        </div>
      </DashboardLayout>
    );
  }
  
  if (!user) {
    return (
      <DashboardLayout user={null}>
        <div className="bg-sf-deep flex items-center justify-center min-h-96">
          <div className="text-center p-4">
            <h2 className="text-2xl font-bold text-sf-heading mb-4">{t('accessRequired')}</h2>
            <p className="text-sf-body mb-6">{t('pleaseLoginToSeeProducts')}</p>
            <Link
              href="/login"
              className="inline-flex items-center px-6 py-3 border border-transparent rounded-full text-base font-medium text-white bg-sf-accent-bg hover:bg-sf-accent-hover active:scale-[0.98]"
            >
              {t('login')}
            </Link>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const accessibleProductIds = new Set(userProducts.map(up => up.product.id));
  const availableProducts = allProducts.filter(p => !accessibleProductIds.has(p.id));
  const freeProducts = availableProducts.filter(p => p.price === 0);
  const paidProducts = availableProducts.filter(p => p.price > 0);

  const renderOwnedProductCard = (product: Product, grantedAt: string, sellerSlug?: string, sellerDisplayName?: string) => (
    <div
      key={product.id}
      className="group bg-sf-raised/80 backdrop-blur-md border border-sf-success/30 rounded-2xl overflow-hidden hover:bg-sf-hover transition-all duration-300 active:scale-[0.98] relative"
    >
      <div className="relative h-40 overflow-hidden">
        {product.image_url ? (
          <ProductImage src={product.image_url} alt={product.name} icon={product.icon} />
        ) : (
          <div className="h-full flex items-center justify-center bg-sf-float">
            <span className="text-6xl">{product.icon || '📦'}</span>
          </div>
        )}
        {product.is_featured && (
          <div className="absolute top-3 right-3 flex items-center px-2 py-1 bg-sf-base border border-sf-warning/30 rounded-full text-xs font-medium text-sf-warning shadow-sm">
            <svg className="w-3 h-3 text-sf-warning mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            {t('featured')}
          </div>
        )}
      </div>

      <div className="p-6 pt-4">
        <h3 className="text-xl font-semibold text-sf-heading transition-colors group-hover:text-sf-success mb-2">
          {product.name}
        </h3>

        <p className="text-sf-body mb-4 min-h-[3rem] line-clamp-2">
          {product.description}
        </p>

        <div className="text-sm text-sf-muted mb-4">
          {t('accessSince', { date: formatDateLocalized(grantedAt, locale) })}
        </div>

        {sellerDisplayName && (
          <p className="text-xs text-sf-muted mb-3">{sellerDisplayName}</p>
        )}

        <Link
          href={sellerSlug ? `/s/${sellerSlug}/${product.slug}` : `/p/${product.slug}`}
          className="block w-full text-center font-semibold py-3 px-4 rounded-full transition-colors duration-200 active:scale-[0.98] bg-sf-success hover:bg-sf-success/90 text-sf-inverse"
        >
          {t('openProduct')}
        </Link>
      </div>
    </div>
  );

  const renderAvailableProductCard = (product: Product) => (
    <div
      key={product.id}
      className="group bg-sf-raised/80 backdrop-blur-md border border-sf-border rounded-2xl overflow-hidden hover:bg-sf-hover transition-all duration-300 active:scale-[0.98] relative"
    >
      <div className="relative h-40 overflow-hidden">
        {product.image_url ? (
          <ProductImage src={product.image_url} alt={product.name} icon={product.icon} />
        ) : (
          <div className="h-full flex items-center justify-center bg-sf-float">
            <span className="text-6xl">{product.icon || '📦'}</span>
          </div>
        )}
        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
          {product.price > 0 ? (
            <div className="flex items-center px-2 py-1 bg-sf-base border border-sf-border-accent rounded-full shadow-sm">
              <svg className="w-3 h-3 text-sf-accent mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
              <span className="text-xs font-medium text-sf-accent">{t('premium')}</span>
            </div>
          ) : (
            <span className="inline-flex items-center px-2 py-1 bg-sf-base border border-sf-success/30 rounded-full text-xs font-medium text-sf-success shadow-sm">
              {t('free')}
            </span>
          )}
        </div>
        {product.is_featured && (
          <div className="absolute top-3 right-3 flex items-center px-2 py-1 bg-sf-base border border-sf-warning/30 rounded-full text-xs font-medium text-sf-warning shadow-sm">
            <svg className="w-3 h-3 text-sf-warning mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            {t('featured')}
          </div>
        )}
      </div>

      <div className="p-6 pt-4">
        <h3 className="text-xl font-semibold text-sf-heading transition-colors group-hover:text-sf-accent mb-2">
          {product.name}
        </h3>

        <p className="text-sf-body mb-4 min-h-[3rem] line-clamp-2">
          {product.description}
        </p>

        <div className="text-2xl font-bold text-sf-accent mb-4">
          {formatPriceLocalized(product.price, product.currency, locale, t('naLabel'), t('invalidPrice'))}
        </div>

        <Link
          href={`/p/${product.slug}`}
          className="block w-full text-center font-semibold py-3 px-4 rounded-full transition-colors duration-200 active:scale-[0.98] bg-sf-accent-bg hover:bg-sf-accent-hover text-white"
        >
          {t('viewDetails')}
        </Link>
      </div>
    </div>
  );

  return (
    <DashboardLayout user={user ? {
      email: user.email || '',
      id: user.id || ''
    } : null}>
      <div className="min-h-screen bg-sf-deep text-sf-heading -mx-4 -my-6 px-4 py-6">
        {/* Header */}
        <header className="relative pt-10 pb-8 text-center">
          <h1 className="text-3xl md:text-4xl font-bold text-sf-heading mb-3">
            <span className="text-sf-accent">
              {t('title')}
            </span>
          </h1>
          <p className="text-lg text-sf-body max-w-2xl mx-auto">
            {t('subtitle')}
          </p>
        </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        {/* My Products Section */}
        {userProducts.length > 0 && (
          <section className="mb-16">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-sf-heading">
                {t('yourProducts')}
                <span className="ml-2 text-base font-normal text-sf-muted">({userProducts.length})</span>
              </h2>
              <p className="text-sf-body mt-1">{t('yourProductsDescription')}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {userProducts.map((userProduct) => renderOwnedProductCard(userProduct.product, userProduct.granted_at, userProduct.sellerSlug, userProduct.sellerDisplayName))}
            </div>
          </section>
        )}

        {/* Available Products Section */}
        {(freeProducts.length > 0 || paidProducts.length > 0) && (
          <section>
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-sf-heading">
                {t('exploreMore')}
                <span className="ml-2 text-base font-normal text-sf-muted">({availableProducts.length})</span>
              </h2>
              <p className="text-sf-body mt-1">{t('exploreMoreDescription')}</p>
            </div>

            {freeProducts.length > 0 && (
              <div className="mb-10">
                <h3 className="text-lg font-semibold text-sf-success mb-4">{t('freeResources')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {freeProducts.map((product) => renderAvailableProductCard(product))}
                </div>
              </div>
            )}

            {paidProducts.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-sf-accent mb-4">{t('premiumSolutions')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {paidProducts.map((product) => renderAvailableProductCard(product))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Empty State */}
        {userProducts.length === 0 && availableProducts.length === 0 && (
          <div className="text-center py-20">
            <div className="text-6xl mb-8">📦</div>
            <h3 className="text-3xl font-bold text-sf-heading mb-4">{t('noProductsAvailable')}</h3>
            <p className="text-xl text-sf-body max-w-md mx-auto">
              {t('noProductsMessage')}
            </p>
          </div>
        )}
      </main>
    </div>
    </DashboardLayout>
  );
}
