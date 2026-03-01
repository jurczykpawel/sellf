'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Product } from '@/types';
import DigitalContentRenderer from '@/components/DigitalContentRenderer';
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
}

export default function ProductAccessView({ product }: ProductAccessViewProps) {
  const t = useTranslations('productView');
  
  const [showConfetti, setShowConfetti] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [secureData, setSecureData] = useState<SecureProductData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch secure product data from API
  useEffect(() => {
    const controller = new AbortController();

    const fetchSecureData = async () => {
      try {
        const response = await fetchWithTimeout(
          `/api/public/products/${product.slug}/content`,
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

    // Only fetch if not showing confetti
    if (!showConfetti) {
      fetchSecureData();
    }

    return () => {
      controller.abort();
    };
  }, [product.slug, showConfetti, t]);

  // Handle redirect type products.
  // Note: redirect_url is admin-configured and intentionally allows cross-origin URLs
  // (e.g. external course platforms, membership sites). Protocol validation prevents
  // javascript:/data: injection if the DB value is compromised.
  useEffect(() => {
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
  }, [secureData]);

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
      <div className="flex justify-center items-center min-h-screen bg-gf-deep overflow-hidden relative">
        <Confetti
          width={dimensions.width}
          height={dimensions.height}
          recycle={false}
          numberOfPieces={800}
          gravity={0.25}
          initialVelocityX={{ min: -10, max: 10 }}
          initialVelocityY={{ min: -20, max: 5 }}
        />
        <div className="max-w-4xl mx-auto p-8 bg-gf-raised/80 backdrop-blur-md border border-gf-border rounded-2xl shadow-[var(--gf-shadow-accent)] z-10 text-center">
          <div className="text-5xl mb-4">🎉</div>
          <h2 className="text-3xl font-bold text-gf-heading mb-2">{t('accessGranted')}</h2>
          <p className="text-gf-body mb-6">{t('accessGrantedMessage', { productName: product.name })}</p>
          <div className="text-6xl font-bold text-gf-heading tabular-nums">{countdown}</div>
          <p className="text-gf-muted mt-2">{t('loadingContent')}</p>
        </div>
      </div>
    );
  }

  // Show loading state while fetching content
  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gf-deep">
        <div className="text-gf-heading">{t('loadingSecureContent')}</div>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gf-deep">
        <div className="text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h2 className="text-xl font-semibold text-gf-heading mb-2">{t('accessError')}</h2>
          <p className="text-gf-muted text-sm mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center px-4 py-2 bg-gf-accent-bg hover:bg-gf-accent-hover text-white font-medium rounded-full transition-colors active:scale-[0.98]"
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
      <div className="flex justify-center items-center min-h-screen bg-gf-deep">
        <div className="text-gf-heading">{t('noContentAvailable')}</div>
      </div>
    );
  }

  const { product: secureProduct, userAccess: secureUserAccess } = secureData;

  // Show loading state for redirect products
  if (secureProduct.content_delivery_type === 'redirect') {
    const redirectUrl = secureProduct.content_config?.redirect_url;
    return (
      <div className="flex justify-center items-center min-h-screen bg-gf-deep overflow-hidden relative font-sans">
        <div 
          className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_20%_20%,var(--gf-accent-glow)_0%,transparent_40%),radial-gradient(circle_at_80%_70%,var(--gf-accent-glow)_0%,transparent_40%)]"
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
        
        <div className="max-w-md mx-auto p-8 bg-gf-raised/80 backdrop-blur-md border border-gf-border rounded-2xl shadow-[var(--gf-shadow-accent)] z-10 text-center">
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

  // Show the actual product content
  return (
    <div className="flex justify-center items-center min-h-screen bg-gf-deep overflow-hidden relative font-sans">
      {/* Background aurora effect */}
      <div 
        className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_20%_20%,var(--gf-accent-glow)_0%,transparent_40%),radial-gradient(circle_at_80%_70%,var(--gf-accent-glow)_0%,transparent_40%)]"
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
      
      <div className="max-w-4xl mx-auto p-8 bg-gf-raised/80 backdrop-blur-md border border-gf-border rounded-2xl shadow-[var(--gf-shadow-accent)] z-10">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <div className="text-6xl mr-4">{secureProduct.icon}</div>
            <h1 className="text-3xl font-bold text-gf-heading">{secureProduct.name}</h1>
          </div>
          
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <div className="inline-flex items-center px-4 py-2 bg-gf-success-soft border border-gf-success/30 rounded-full">
              <svg className="w-5 h-5 text-gf-success mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-gf-success font-medium">
                {secureUserAccess.is_expired ? t('accessExpiredStatusLabel') : t('accessGrantedStatus')}
              </span>
              {secureProduct.is_featured && (
                <svg className="w-4 h-4 text-gf-warning ml-2" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              )}
            </div>
            
            {/* Show access expiration info */}
            {secureUserAccess.access_expires_at && (
              <div className={`inline-flex items-center px-4 py-2 rounded-full ${
                secureUserAccess.is_expired 
                  ? 'bg-gf-danger-soft border border-gf-danger/30' 
                  : secureUserAccess.is_expiring_soon
                    ? 'bg-gf-warning-soft border border-gf-warning/30'
                    : 'bg-gf-accent-soft border border-gf-accent/30'
              }`}>
                <svg className={`w-5 h-5 mr-2 ${
                  secureUserAccess.is_expired 
                    ? 'text-gf-danger' 
                    : secureUserAccess.is_expiring_soon
                      ? 'text-gf-warning'
                      : 'text-gf-accent'
                }`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className={`font-medium ${
                  secureUserAccess.is_expired 
                    ? 'text-gf-danger' 
                    : secureUserAccess.is_expiring_soon
                      ? 'text-gf-warning'
                      : 'text-gf-accent'
                }`}>
                  {secureUserAccess.is_expired
                    ? t('accessExpiredStatus', { date: formatDate(secureUserAccess.access_expires_at) })
                    : t('accessExpiresStatus', { date: formatDate(secureUserAccess.access_expires_at) })
                  }
                </span>
              </div>
            )}
          </div>
          
          {/* Show inactive product warning */}
          {!secureProduct.is_active && (
            <div className="inline-flex items-center px-4 py-2 bg-gf-warning-soft border border-gf-warning/30 rounded-full mt-2">
              <svg className="w-5 h-5 text-gf-warning mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L3.732 16.5c-.77.833-.23 2.5 1.732 2.5z" />
              </svg>
              <span className="text-gf-warning font-medium">{t('legacyAccess')}</span>
            </div>
          )}
        </div>
        
        <div className="bg-gf-raised border border-gf-border rounded-xl p-6 mb-8">
          <h2 className="text-xl font-semibold text-gf-heading mb-4">{t('productDescription')}</h2>
          <p className="text-gf-body">{secureProduct.description}</p>
        </div>
        
        {/* Render digital content based on content_delivery_type */}
        <DigitalContentRenderer 
          contentItems={secureProduct.content_config.content_items || []} 
          productName={secureProduct.name}
        />
        
        <div className="text-center mt-8 text-sm text-gf-muted">
          {t('securedBySellf')} • {new Date().toLocaleDateString()}
          {!secureProduct.is_active && (
            <div className="mt-2 text-xs text-gf-warning">
              {t('notAvailableToNew')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
