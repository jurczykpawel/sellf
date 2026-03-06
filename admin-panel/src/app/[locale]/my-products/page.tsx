'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslations } from 'next-intl';
import DashboardLayout from '@/components/DashboardLayout';

interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
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
}

interface UserAccessData {
    id: string;
    created_at: string;
    product: Product;
}

const formatPrice = (price: number | null, currency: string | null = 'USD', naLabel = 'N/A', invalidLabel = 'Invalid Price') => {
  if (price === null) return naLabel;
  const numericPrice = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(numericPrice)) return invalidLabel;

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
  }).format(numericPrice);
};

export default function MyProductsPage() {
  const { user, loading: authLoading } = useAuth();
  const t = useTranslations('myProducts');
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

      // Fetch products user has access to
      const { data: userAccessData, error: userError } = await supabase
        .from('user_product_access')
        .select(`
          id,
          created_at,
          product:products!inner (
            id, name, slug, description, icon, price, currency, is_active, is_featured, created_at
          )
        `)
        .eq('user_id', user.id);

      if (userError) throw userError;
      
      const transformedUserProducts: UserProductAccess[] = (userAccessData as unknown as UserAccessData[] || []).map((item) => ({
        id: item.id,
        granted_at: item.created_at,
        product: item.product,
      })).filter((item): item is UserProductAccess => item.product !== null);

      // Fetch all active products
      const { data: allProductsData, error: productsError } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .eq('is_listed', true)
        .order('is_featured', { ascending: false })
        .order('price', { ascending: true });

      if (productsError) throw productsError;

      setUserProducts(transformedUserProducts);
      setAllProducts(allProductsData || []);

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

  const renderProductCard = (product: Product, accessible: boolean) => (
    <div
      key={product.id}
      className={`group bg-sf-raised/80 backdrop-blur-md border rounded-2xl p-6 hover:bg-sf-hover transition-all duration-300 active:scale-[0.98] relative overflow-hidden ${accessible ? 'border-sf-success/30' : 'border-sf-border'}`}
    >
      <div className="flex items-start gap-3 mb-2">
        <div className="text-4xl shrink-0">{product.icon}</div>
        <div className="flex-1 min-w-0">
          <h3 className={`text-xl font-semibold text-sf-heading transition-colors ${accessible ? 'group-hover:text-sf-success' : 'group-hover:text-sf-accent'}`}>
            {product.name}
          </h3>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        {product.price > 0 ? (
          <div className="flex items-center px-2 py-1 bg-sf-accent-soft border border-sf-border-accent rounded-full">
            <svg className="w-3 h-3 text-sf-accent mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
            <span className="text-xs font-medium text-sf-accent">{t('premium')}</span>
          </div>
        ) : (
          <span className="inline-flex items-center px-2 py-1 bg-sf-success-soft border border-sf-success/30 rounded-full text-xs font-medium text-sf-success">
            {t('free')}
          </span>
        )}
        {accessible && (
          <div className="flex items-center px-2 py-1 bg-sf-success-soft border border-sf-success/30 rounded-full text-xs font-medium text-sf-success whitespace-nowrap">
            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
            {t('accessible')}
          </div>
        )}
        {product.is_featured && (
          <div className="flex items-center px-2 py-1 bg-sf-warning-soft border border-sf-warning/30 rounded-full text-xs font-medium text-sf-warning whitespace-nowrap">
            <svg className="w-3 h-3 text-sf-warning mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            {t('featured')}
          </div>
        )}
      </div>

      <p className="text-sf-body mb-6 min-h-[3rem] line-clamp-2">
        {product.description}
      </p>
      
      <div className="flex items-center justify-between mb-4">
        <div className="text-2xl font-bold text-sf-accent">
          {formatPrice(product.price, product.currency, t('naLabel'), t('invalidPrice'))}
        </div>
      </div>

      <Link
        href={`/p/${product.slug}`}
        className={`block w-full text-center font-semibold py-3 px-4 rounded-full transition-colors duration-200 active:scale-[0.98] ${accessible ? 'bg-sf-success hover:bg-sf-success/90 text-sf-inverse' : 'bg-sf-accent-bg hover:bg-sf-accent-hover text-white'}`}
      >
        {accessible ? t('launchProduct') : t('viewProduct')}
      </Link>
    </div>
  );

  return (
    <DashboardLayout user={user ? {
      email: user.email || '',
      id: user.id || ''
    } : null}>
      <div className="min-h-screen bg-sf-deep text-sf-heading -mx-4 -my-6 px-4 py-6">
        {/* Header */}
        <header className="relative pt-20 pb-16 text-center">
          <h1 className="text-4xl md:text-6xl font-bold text-sf-heading mb-6">
            <span className="text-sf-accent">
              {t('title')}
            </span>
          </h1>
          <p className="text-xl text-sf-body max-w-3xl mx-auto">
            {t('subtitle')}
          </p>
        </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        {/* My Access Section */}
        {userProducts.length > 0 && (
          <section className="mb-16">
            <h2 className="text-3xl font-bold text-sf-heading mb-8">{t('myAccessibleProducts')}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {userProducts.map((userProduct) => renderProductCard(userProduct.product, true))}
            </div>
          </section>
        )}

        {/* Available Products Section */}
        {(freeProducts.length > 0 || paidProducts.length > 0) && (
          <section>
            <h2 className="text-3xl font-bold text-sf-heading mb-8">{t('availableProducts')}</h2>
            
            {freeProducts.length > 0 && (
              <div className="mb-12">
                <h3 className="text-2xl font-semibold text-sf-success mb-6">{t('freeResources')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {freeProducts.map((product) => renderProductCard(product, false))}
                </div>
              </div>
            )}

            {paidProducts.length > 0 && (
              <div>
                <h3 className="text-2xl font-semibold text-sf-accent mb-6">{t('premiumSolutions')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {paidProducts.map((product) => renderProductCard(product, false))}
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
