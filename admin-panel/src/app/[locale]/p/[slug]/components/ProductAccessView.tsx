'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Product } from '@/types';
import DigitalContentRenderer from '@/components/DigitalContentRenderer';
import SellfBranding from '@/components/SellfBranding';
import FloatingToolbar from '@/components/FloatingToolbar';
import Confetti from 'react-confetti';
import { isSafeRedirectUrl } from '@/lib/validations/redirect';
import { fetchWithTimeout, FetchTimeoutError } from '@/lib/fetch-with-timeout';

interface ProductAccessViewProps {
  product: Product;
  userAccess?: {
    access_expires_at?: string | null;
    access_duration_days?: number | null;
    access_granted_at: string;
  } | null;
  licenseValid: boolean;
  previewMode?: boolean;
  sellerSlug?: string;
}

interface SecureProductData {
  product: Product;
  userAccess: {
    access_expires_at?: string | null;
    access_duration_days?: number | null;
    access_granted_at: string;
    // Backend-computed security status
    is_expired: boolean;
    is_expiring_soon: boolean;
    days_until_expiration: number | null;
  };
  branding?: {
    shop_name: string | null;
  };
}

export default function ProductAccessView({ product, licenseValid, previewMode = false, sellerSlug }: ProductAccessViewProps) {
  const t = useTranslations('productView');
  const tContent = useTranslations('digitalContent');
  
  const [showConfetti, setShowConfetti] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [secureData, setSecureData] = useState<SecureProductData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch secure product data from API (skipped in preview mode)
  useEffect(() => {
    const controller = new AbortController();

    const fetchSecureData = async () => {
      // Preview mode — build mock secureData directly from product prop
      if (previewMode) {
        setSecureData({
          // In preview mode the server already verified admin identity and passed
          // the full content_config — use it directly so admins see actual content.
          product: {
            ...product,
          },
          branding: { shop_name: null },
          userAccess: {
            access_expires_at: null,
            access_duration_days: null,
            access_granted_at: new Date().toISOString(),
            is_expired: false,
            is_expiring_soon: false,
            days_until_expiration: null,
          },
        });
        setLoading(false);
        return;
      }

      try {
        const contentUrl = sellerSlug
          ? `/api/public/products/${product.slug}/content?seller=${encodeURIComponent(sellerSlug)}`
          : `/api/public/products/${product.slug}/content`;
        const response = await fetchWithTimeout(
          contentUrl,
          { signal: controller.signal }
        );

        if (!response.ok) {
          if (response.status === 401) {
            window.location.href = '/login';
            return;
          }
          if (response.status === 403) {
            if (!controller.signal.aborted) {
              setError(t('accessDeniedOrExpired'));
            }
            return;
          }
          throw new Error('Failed to fetch content');
        }

        const data = await response.json();
        if (!controller.signal.aborted) {
          setSecureData(data);
        }
      } catch (err) {
        if (controller.signal.aborted) return;

        if (err instanceof FetchTimeoutError) {
          console.error('[ProductAccessView] Content fetch timed out:', err.message);
          setError(t('loadingTimeoutMessage'));
        } else {
          console.error('[ProductAccessView] Error fetching secure data:', err);
          setError(t('failedToLoadContent'));
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    // Only fetch if not showing confetti (preview mode always fetches — it short-circuits internally)
    if (!showConfetti || previewMode) {
      fetchSecureData();
    }

    return () => {
      controller.abort();
    };
  }, [product, previewMode, showConfetti, t, sellerSlug]);

  // Handle redirect type products.
  // Note: redirect_url is admin-configured and intentionally allows cross-origin URLs
  // (e.g. external course platforms, membership sites). Protocol validation prevents
  // javascript:/data: injection if the DB value is compromised.
  useEffect(() => {
    // In preview mode, never actually redirect — admin sees redirect screen as-is
    if (previewMode) return;
    if (secureData?.product.content_delivery_type === 'redirect') {
      const redirectUrl = secureData.product.content_config?.redirect_url;
      if (redirectUrl) {
        const isRelative = redirectUrl.startsWith('/') && !redirectUrl.startsWith('//');
        const isHttp = redirectUrl.startsWith('https://') || redirectUrl.startsWith('http://');
        if (isRelative || isHttp) {
          window.location.href = redirectUrl;
        }
      }
    }
  }, [secureData, previewMode]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Check if this is a fresh access grant (from payment success)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentSuccess = urlParams.get('payment') === 'success';
    
    if (paymentSuccess) {
      setShowConfetti(true);
      
      // Set window dimensions for confetti
      const { innerWidth, innerHeight } = window;
      setDimensions({ width: innerWidth, height: innerHeight });

      const handleResize = () => {
        setDimensions({ width: window.innerWidth, height: window.innerHeight });
      };

      window.addEventListener('resize', handleResize, { passive: true });
      return () => window.removeEventListener('resize', handleResize);
    }
  }, []);

  // Handle countdown timer
  useEffect(() => {
    if (showConfetti && countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown(prev => prev - 1);
      }, 1000);
      
      return () => clearTimeout(timer);
    } else if (showConfetti && countdown === 0) {
      // Check for return URL — uses shared isSafeRedirectUrl validation
      const urlParams = new URLSearchParams(window.location.search);
      const rawReturnUrl = urlParams.get('return_url');

      if (rawReturnUrl && isSafeRedirectUrl(rawReturnUrl)) {
        window.location.href = rawReturnUrl;
        return;
      }
      // No valid return URL, stop confetti and show content
      setShowConfetti(false);
    }
  }, [showConfetti, countdown]);

  // Show success animation
  if (showConfetti) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-sf-deep overflow-hidden relative">
        <Confetti
          width={dimensions.width}
          height={dimensions.height}
          recycle={false}
          numberOfPieces={800}
          gravity={0.25}
          initialVelocityX={{ min: -10, max: 10 }}
          initialVelocityY={{ min: -20, max: 5 }}
        />
        <div className="max-w-4xl mx-auto p-8 bg-sf-raised/80 backdrop-blur-md border border-sf-border rounded-2xl shadow-[var(--sf-shadow-accent)] z-10 text-center">
          <div className="text-5xl mb-4">🎉</div>
          <h2 className="text-3xl font-bold text-sf-heading mb-2">{t('accessGranted')}</h2>
          <p className="text-sf-body mb-6">{t('accessGrantedMessage', { productName: product.name })}</p>
          <div className="text-6xl font-bold text-sf-heading tabular-nums">{countdown}</div>
          <p className="text-sf-muted mt-2">{t('loadingContent')}</p>
        </div>
      </div>
    );
  }

  // Show loading state while fetching content
  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-sf-deep">
        <div className="text-sf-heading">{t('loadingSecureContent')}</div>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-sf-deep">
        <div className="text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h2 className="text-xl font-semibold text-sf-heading mb-2">{t('accessError')}</h2>
          <p className="text-sf-muted text-sm mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center px-4 py-2 bg-sf-accent-bg hover:bg-sf-accent-hover text-white font-medium rounded-full transition-colors active:scale-[0.98]"
          >
            {t('refreshPage')}
          </button>
        </div>
      </div>
    );
  }

  // Show no content state
  if (!secureData) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-sf-deep">
        <div className="text-sf-heading">{t('noContentAvailable')}</div>
      </div>
    );
  }

  const { product: secureProduct, userAccess: secureUserAccess } = secureData;

  // Show loading state for redirect products
  if (secureProduct.content_delivery_type === 'redirect') {
    const redirectUrl = secureProduct.content_config?.redirect_url;
    return (
      <>
        <div className="flex justify-center items-center min-h-screen bg-sf-deep overflow-hidden relative font-sans">
          <div 
            className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_20%_20%,var(--sf-accent-glow)_0%,transparent_40%),radial-gradient(circle_at_80%_70%,var(--sf-accent-glow)_0%,transparent_40%)]"
            style={{
              animation: 'aurora 20s infinite linear',
            }}
          />
          
          <style jsx>{`
            @keyframes aurora {
              0% { background-position: 0% 50%; }
              50% { background-position: 100% 50%; }
              100% { background-position: 0% 50%; }
            }
          `}</style>
          
          <div className="max-w-md mx-auto p-8 bg-sf-raised/80 backdrop-blur-md border border-sf-border rounded-2xl shadow-[var(--sf-shadow-accent)] z-10 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sf-accent mx-auto mb-4"></div>
            <h2 className="text-xl font-semibold text-sf-heading mb-2">{t('redirectingTitle')}</h2>
            <p className="text-sf-muted text-sm mb-4">{t('redirectingMessage')}</p>
            {redirectUrl && (redirectUrl.startsWith('https://') || redirectUrl.startsWith('http://') || (redirectUrl.startsWith('/') && !redirectUrl.startsWith('//'))) && (
              <a
                href={redirectUrl}
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
        {previewMode && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sf-raised/90 backdrop-blur-sm border border-sf-border shadow text-xs text-sf-body select-none pointer-events-none">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
            Tryb podglądu
          </div>
        )}
      </>
    );
  }

  const shopName = secureData?.branding?.shop_name ?? null;
  const contentItems = secureProduct.content_config.content_items?.filter(i => i.is_active) ?? [];

  return (
    <div className="min-h-screen bg-sf-deep font-sans">

      {/* Admin preview: inactive product warning banner */}
      {previewMode && !secureProduct.is_active && (
        <div className="bg-sf-danger-soft border-b border-sf-danger/30 px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center gap-3 text-sm text-sf-danger">
            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
            <div>
              <span className="font-semibold">{t('inactivePreviewTitle')}</span>
              {' '}{t('inactivePreviewDesc')}
            </div>
          </div>
        </div>
      )}

      {/* Sticky mini-header */}
      <header className="sticky top-0 z-20 bg-sf-base/90 backdrop-blur-md border-b border-sf-border">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-lg leading-none shrink-0">{secureProduct.icon}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {secureUserAccess.is_expired ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-sf-danger-soft border border-sf-danger/30 text-sf-danger">
                <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                {t('accessExpiredStatusLabel')}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-sf-success-soft border border-sf-success/30 text-sf-success">
                <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                {t('accessGrantedStatus')}
              </span>
            )}
            <FloatingToolbar mode="inline" />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-10 pb-24">

        {/* Hero — icon + title + description */}
        <div className="mb-10">
          <div className="text-5xl mb-4 leading-none">{secureProduct.icon}</div>
          <h1 className="text-2xl sm:text-3xl font-bold text-sf-heading tracking-tight mb-3">
            {secureProduct.name}
          </h1>
          {secureProduct.description && (
            <p className="text-sf-body text-base leading-relaxed">{secureProduct.description}</p>
          )}

          {/* Status banners */}
          {(secureUserAccess.access_expires_at || !secureProduct.is_active) && (
            <div className="flex flex-col gap-2 mt-5">
              {secureUserAccess.access_expires_at && (
                <div className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium w-fit border ${
                  secureUserAccess.is_expired
                    ? 'bg-sf-danger-soft border-sf-danger/30 text-sf-danger'
                    : secureUserAccess.is_expiring_soon
                      ? 'bg-sf-warning-soft border-sf-warning/30 text-sf-warning'
                      : 'bg-sf-accent-soft border-sf-accent/30 text-sf-accent'
                }`}>
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  {secureUserAccess.is_expired
                    ? t('accessExpiredStatus', { date: formatDate(secureUserAccess.access_expires_at) })
                    : t('accessExpiresStatus', { date: formatDate(secureUserAccess.access_expires_at) })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Content section label */}
        {contentItems.length > 0 && (
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-sf-body">
              {tContent('sectionTitle')}
            </h2>
            <span className="ml-auto inline-flex items-center justify-center w-5 h-5 rounded-full bg-sf-raised border border-sf-border text-xs font-semibold text-sf-body">
              {contentItems.length}
            </span>
          </div>
        )}

        {/* Digital content */}
        <DigitalContentRenderer
          contentItems={secureProduct.content_config.content_items || []}
          productName={secureProduct.name}
        />

        {/* Footer */}
        <div className="mt-16 text-center text-xs text-sf-body">
          {shopName
            ? `${shopName} • ${new Date().toLocaleDateString()}`
            : new Date().toLocaleDateString()
          }
          {!secureProduct.is_active && (
            <div className="mt-1 text-sf-warning">{t('notAvailableToNew')}</div>
          )}
        </div>
      </main>

      {!licenseValid && <SellfBranding variant="product" />}

      {/* Discrete preview mode indicator */}
      {previewMode && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-sf-raised/90 backdrop-blur border border-sf-border shadow-md text-xs text-sf-muted pointer-events-none select-none">
          <span className="w-1.5 h-1.5 rounded-full bg-sf-warning shrink-0" />
          Tryb podglądu
        </div>
      )}
    </div>
  );
}
