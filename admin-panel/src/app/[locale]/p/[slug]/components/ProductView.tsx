'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Product } from '@/types';
import type { ProductAccessOutcome } from '@/lib/payment/product-access-decision';
import ProductAccessView, { type SecureProductResponse } from './ProductAccessView';
import ProductInactiveState from './ProductInactiveState';
import ProductTemporalState from './ProductTemporalState';
import ProductExpiredState from './ProductExpiredState';
import FloatingToolbar from '@/components/FloatingToolbar';

interface ProductViewProps {
  product: Product;
  licenseValid: boolean;
  /** Verified server-side: true only when the requester is a confirmed admin */
  previewMode?: boolean;
  /** Resolved server-side — no client-side access fetch / spinner cascade. */
  outcome: ProductAccessOutcome;
  /** Server-prefetched secure content (content_config, branding, expiry). */
  initialSecureData?: SecureProductResponse;
  /** Existing issued license, also shown when content access itself expired. */
  existingLicense?: SecureProductResponse['license'];
}

export default function ProductView({ product, licenseValid, previewMode = false, outcome, initialSecureData, existingLicense }: ProductViewProps) {
  const t = useTranslations('productView');

  // Redirect-delivery products navigate the buyer to an external URL after
  // access has been granted. This is the only path that legitimately needs
  // client-side side-effects — the decision itself was made on the server.
  const shouldRedirectExternal =
    !previewMode &&
    outcome.kind === 'render-content' &&
    product.content_delivery_type === 'redirect';
  const redirectUrlFromProduct = product.content_config?.redirect_url;

  useEffect(() => {
    if (!shouldRedirectExternal || !redirectUrlFromProduct) return;
    const isRelative = redirectUrlFromProduct.startsWith('/') && !redirectUrlFromProduct.startsWith('//');
    const isHttp = redirectUrlFromProduct.startsWith('https://') || redirectUrlFromProduct.startsWith('http://');
    if (isRelative || isHttp) {
      window.location.href = redirectUrlFromProduct;
    }
  }, [shouldRedirectExternal, redirectUrlFromProduct]);

  if (shouldRedirectExternal) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-sf-deep overflow-hidden relative font-sans">
        <FloatingToolbar position="top-right" />
        <div className="max-w-md mx-auto p-8 bg-sf-raised/80 border border-sf-border rounded-2xl shadow-[var(--sf-shadow-accent)] z-10 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sf-accent mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold text-sf-heading mb-2">{t('redirectingTitle')}</h2>
          <p className="text-sf-muted text-sm mb-4">{t('redirectingMessage')}</p>
          {redirectUrlFromProduct && (
            <a
              href={redirectUrlFromProduct}
              className="inline-flex items-center px-4 py-2 bg-sf-accent-bg hover:bg-sf-accent-hover text-white font-medium rounded-full transition-colors active:scale-[0.98]"
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

  if (outcome.kind === 'render-inactive') {
    return <ProductInactiveState product={product} />;
  }

  if (outcome.kind === 'render-temporal') {
    return <ProductTemporalState product={product} />;
  }

  if (outcome.kind === 'render-expired') {
    return <ProductExpiredState product={product} existingLicense={existingLicense} />;
  }

  if (outcome.kind === 'render-content') {
    return (
      <ProductAccessView
        product={product}
        licenseValid={licenseValid}
        previewMode={previewMode}
        initialSecureData={initialSecureData}
      />
    );
  }

  // redirect-checkout outcomes are handled by page.tsx via Next's redirect();
  // reaching here would be a bug in the resolver.
  return null;
}
