'use client';

import { useEffect, useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Product } from '@/types';
import { useProductAccess } from '@/hooks/useProductAccess';
import ProductAccessView from './ProductAccessView';
import ProductLoadingState from './ProductLoadingState';
import ProductInactiveState from './ProductInactiveState';
import ProductTemporalState from './ProductTemporalState';
import ProductExpiredState from './ProductExpiredState';
import FloatingToolbar from '@/components/FloatingToolbar';

/** Safety net: show error + retry if loading takes too long */
const LOADING_SAFETY_TIMEOUT_MS = 15_000;

interface ProductViewProps {
  product: Product;
}

export default function ProductView({ product }: ProductViewProps) {
  const t = useTranslations('productView');
  const { accessData, loading, error: accessError } = useProductAccess(product);
  const [redirecting, setRedirecting] = useState(false);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Loading safety timeout — if still loading after N seconds, show error state
  useEffect(() => {
    if (loading) {
      timeoutRef.current = setTimeout(() => {
        setLoadingTimedOut(true);
      }, LOADING_SAFETY_TIMEOUT_MS);
    } else {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setLoadingTimedOut(false);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [loading]);

  // For redirect products with access — redirect immediately without extra content fetch.
  // The redirect URL is already in the product props from the server.
  useEffect(() => {
    if (accessData?.hasAccess && product.content_delivery_type === 'redirect') {
      const redirectUrl = product.content_config?.redirect_url;
      if (redirectUrl) {
        const isRelative = redirectUrl.startsWith('/') && !redirectUrl.startsWith('//');
        const isHttp = redirectUrl.startsWith('https://') || redirectUrl.startsWith('http://');
        if (isRelative || isHttp) {
          setRedirecting(true);
          window.location.href = redirectUrl;
        }
      }
    }
  }, [accessData, product.content_delivery_type, product.content_config?.redirect_url]);

  // Loading timed out or access check error — show error with retry
  if (loadingTimedOut || accessError) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gf-deep">
        <FloatingToolbar position="top-right" />
        <div className="max-w-md mx-auto p-8 bg-gf-raised/80 border border-gf-border rounded-2xl shadow-[var(--gf-shadow-accent)] text-center">
          <div className="text-4xl mb-4">&#x26A0;</div>
          <h2 className="text-xl font-semibold text-gf-heading mb-2">{t('loadingTimeoutTitle')}</h2>
          <p className="text-gf-muted text-sm mb-6">{t('loadingTimeoutMessage')}</p>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center px-4 py-2 bg-gf-accent-bg hover:bg-gf-accent-hover text-white font-medium rounded-full transition-colors active:scale-[0.98]"
          >
            {t('tryAgain')}
          </button>
        </div>
      </div>
    );
  }

  // Loading state - show loading while checking access
  if (loading) {
    return <ProductLoadingState />;
  }

  // Redirect in progress — show redirect UI instead of mounting ProductAccessView
  if (redirecting || (accessData?.hasAccess && product.content_delivery_type === 'redirect')) {
    const redirectUrl = product.content_config?.redirect_url;

    // Missing redirect URL — show error instead of spinner forever
    if (!redirectUrl && !redirecting) {
      return (
        <div className="flex justify-center items-center min-h-screen bg-gf-deep">
          <FloatingToolbar position="top-right" />
          <div className="max-w-md mx-auto p-8 bg-gf-raised/80 border border-gf-border rounded-2xl shadow-[var(--gf-shadow-accent)] text-center">
            <div className="text-4xl mb-4">&#x26A0;</div>
            <h2 className="text-xl font-semibold text-gf-heading mb-2">{t('loadingTimeoutTitle')}</h2>
            <p className="text-gf-muted text-sm mb-6">{t('loadingTimeoutMessage')}</p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center px-4 py-2 bg-gf-accent-bg hover:bg-gf-accent-hover text-white font-medium rounded-full transition-colors active:scale-[0.98]"
            >
              {t('tryAgain')}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex justify-center items-center min-h-screen bg-gf-deep overflow-hidden relative font-sans">
        <FloatingToolbar position="top-right" />
        <div className="max-w-md mx-auto p-8 bg-gf-raised/80 border border-gf-border rounded-2xl shadow-[var(--gf-shadow-accent)] z-10 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gf-accent mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold text-gf-heading mb-2">{t('redirectingTitle')}</h2>
          <p className="text-gf-muted text-sm mb-4">{t('redirectingMessage')}</p>
          {redirectUrl && (
            <a
              href={redirectUrl}
              className="inline-flex items-center px-4 py-2 bg-gf-accent-bg hover:bg-gf-accent-hover text-white font-medium rounded-full transition-colors active:scale-[0.98]"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              {t('goToContent')}
            </a>
          )}
        </div>
      </div>
    );
  }

  // Check if user has access (non-redirect products)
  if (accessData?.hasAccess) {
    return (
      <div>
        <FloatingToolbar position="top-right" />
        <ProductAccessView product={product} />
      </div>
    );
  }

  // Handle different reasons for lack of access
  if (accessData && !accessData.hasAccess) {
    switch (accessData.reason) {
      case 'inactive':
        return <ProductInactiveState product={product} />;

      case 'temporal':
        return <ProductTemporalState product={product} />;

      case 'expired':
        return <ProductExpiredState product={product} />;

      default:
        // This includes 'no_access' case - should redirect to checkout
        // but if we're here it means redirect didn't work, so show fallback
        break;
    }
  }

  // Fallback for edge cases or while waiting for redirect
  return (
    <div className="flex justify-center items-center min-h-screen bg-gf-deep">
      <FloatingToolbar position="top-right" />
      <div className="max-w-4xl mx-auto p-8 bg-gf-raised/80 border border-gf-border rounded-2xl shadow-[var(--gf-shadow-accent)] text-center">
        <div className="animate-spin h-8 w-8 border-4 border-gf-accent border-t-transparent rounded-full mx-auto mb-4"></div>
        <p className="text-gf-heading">{t('redirectingTitle')}</p>
      </div>
    </div>
  );
}
