'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { Reveal } from '@/components/motion/Reveal';
import { RevealGroup } from '@/components/motion/RevealGroup';
import { formatPrice } from '@/lib/constants';
import type { Product } from '@/types';

interface StorefrontProps {
  products: Product[];
  shopName: string;
  featuredProducts: Product[];
  freeProducts: Product[];
  paidProducts: Product[];
  /** Override product link prefix. Default: '/p'. For seller storefronts: '/s/seller-slug' */
  productLinkPrefix?: string;
}

type FilterType = 'all' | 'featured' | 'free' | 'premium';

export default function Storefront({
  products,
  shopName,
  featuredProducts,
  freeProducts,
  paidProducts,
  productLinkPrefix = '/p',
}: StorefrontProps) {
  const t = useTranslations('storefront');
  const [mounted, setMounted] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [showAllFree, setShowAllFree] = useState(false);
  const [showAllPaid, setShowAllPaid] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isFreeOnly = freeProducts.length > 0 && paidProducts.length === 0;
  const isPaidOnly = paidProducts.length > 0 && freeProducts.length === 0;
  const isMixed = freeProducts.length > 0 && paidProducts.length > 0;

  const displayedFreeProducts = showAllFree ? freeProducts : freeProducts.slice(0, 6);
  const displayedPaidProducts = showAllPaid ? paidProducts : paidProducts.slice(0, 6);

  const showFeatured = featuredProducts.length > 0 && (activeFilter === 'all' || activeFilter === 'featured');
  const showFree = freeProducts.length > 0 && (activeFilter === 'all' || activeFilter === 'free');
  const showPremium = paidProducts.length > 0 && (activeFilter === 'all' || activeFilter === 'premium');

  if (!mounted) {
    return (
      <div className="w-full bg-sf-deep flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sf-accent"></div>
      </div>
    );
  }

  return (
    <div data-testid="storefront" className="w-full bg-sf-deep relative min-h-screen grain-overlay">

      <div className="max-w-[960px] mx-auto px-6">

        {/* Brand Moment */}
        <Reveal animation="fade-up" delay={100}>
          <section className="relative py-8 overflow-hidden">
            <div className="brand-glow" />
            <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
              <div>
                {isFreeOnly && (
                  <>
                    <h1 className="text-2xl sm:text-3xl font-extrabold text-sf-heading tracking-[-0.035em] leading-tight mb-1">
                      {t('hero.freeOnly.title')}{' '}
                      <span className="text-gradient-accent">{t('hero.freeOnly.titleHighlight')}</span>
                    </h1>
                    <p className="text-sm text-sf-muted">
                      {t('hero.freeOnly.description', { count: freeProducts.length })}
                    </p>
                  </>
                )}
                {isPaidOnly && (
                  <>
                    <h1 className="text-2xl sm:text-3xl font-extrabold text-sf-heading tracking-[-0.035em] leading-tight mb-1">
                      {t('hero.paidOnly.title')}{' '}
                      <span className="text-gradient-accent">{t('hero.paidOnly.titleHighlight')}</span>
                    </h1>
                    <p className="text-sm text-sf-muted">
                      {t('hero.paidOnly.description', { count: paidProducts.length })}
                    </p>
                  </>
                )}
                {isMixed && (
                  <>
                    <h1 className="text-2xl sm:text-3xl font-extrabold text-sf-heading tracking-[-0.035em] leading-tight mb-1">
                      {t('hero.mixed.title')}{' '}
                      <span className="text-gradient-accent">{t('hero.mixed.titleHighlight')}</span>
                    </h1>
                    <p className="text-sm text-sf-muted">
                      {t('hero.mixed.description', { freeCount: freeProducts.length, paidCount: paidProducts.length })}
                    </p>
                  </>
                )}
              </div>

              {/* Stats strip */}
              <div className="flex bg-sf-raised border border-sf-border rounded-xl overflow-hidden shrink-0">
                <div className="px-5 py-3 text-center">
                  <div className="text-xl font-extrabold text-sf-heading leading-none">{products.length}</div>
                  <div className="text-[0.6rem] uppercase tracking-wider text-sf-muted mt-0.5">{t('brandMoment.statsProducts')}</div>
                </div>
                {freeProducts.length > 0 && (
                  <div className="px-5 py-3 text-center border-l border-sf-border">
                    <div className="text-xl font-extrabold text-sf-heading leading-none">{freeProducts.length}</div>
                    <div className="text-[0.6rem] uppercase tracking-wider text-sf-muted mt-0.5">{t('brandMoment.statsFree')}</div>
                  </div>
                )}
                {paidProducts.length > 0 && (
                  <div className="px-5 py-3 text-center border-l border-sf-border">
                    <div className="text-xl font-extrabold text-sf-heading leading-none">{paidProducts.length}</div>
                    <div className="text-[0.6rem] uppercase tracking-wider text-sf-muted mt-0.5">{t('brandMoment.statsPremium')}</div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </Reveal>

        {/* Accent Divider */}
        <div className="accent-divider" />

        {/* Filter Bar */}
        <Reveal animation="fade-up" delay={200}>
          <div className="py-4 flex items-center justify-between gap-4 overflow-x-auto">
            <div className="flex gap-1.5 shrink-0">
              <FilterPill
                active={activeFilter === 'all'}
                onClick={() => setActiveFilter('all')}
                label={t('filters.all', { count: products.length })}
              />
              {featuredProducts.length > 0 && (
                <FilterPill
                  active={activeFilter === 'featured'}
                  onClick={() => setActiveFilter('featured')}
                  label={t('filters.featured', { count: featuredProducts.length })}
                />
              )}
              {freeProducts.length > 0 && (
                <FilterPill
                  active={activeFilter === 'free'}
                  onClick={() => setActiveFilter('free')}
                  label={t('filters.free', { count: freeProducts.length })}
                />
              )}
              {paidProducts.length > 0 && (
                <FilterPill
                  active={activeFilter === 'premium'}
                  onClick={() => setActiveFilter('premium')}
                  label={t('filters.premium', { count: paidProducts.length })}
                />
              )}
            </div>
          </div>
        </Reveal>

        {/* Product List */}
        <div id="products" className="pb-12">

          {/* Featured Section */}
          {showFeatured && (
            <div>
              <SectionHeader
                dotColor="var(--sf-warning, #FBBF24)"
                label={t('featured.badge')}
                count={featuredProducts.length}
                productCountLabel={t('sections.productCount', { count: featuredProducts.length })}
              />
              <RevealGroup animation="fade-up" stagger={60}>
                {featuredProducts.map((product, index) => (
                  <ProductRow
                    key={product.id}
                    product={product}
                    t={t}
                    productLinkPrefix={productLinkPrefix}
                    isHero={index === 0 && featuredProducts.length > 1}
                    showFeaturedBadge
                  />
                ))}
              </RevealGroup>
            </div>
          )}

          {/* Free Section */}
          {showFree && (
            <div>
              <SectionHeader
                dotColor="var(--sf-success, #10B981)"
                label={t('sections.free.badge', { count: freeProducts.length })}
                count={freeProducts.length}
                productCountLabel={t('sections.productCount', { count: freeProducts.length })}
              />
              <RevealGroup animation="fade-up" stagger={60}>
                {displayedFreeProducts.map((product) => (
                  <ProductRow
                    key={product.id}
                    product={product}
                    t={t}
                    productLinkPrefix={productLinkPrefix}
                    showFreeBadge
                  />
                ))}
              </RevealGroup>
              {freeProducts.length > 6 && !showAllFree && (
                <div className="text-center mt-4">
                  <button
                    onClick={() => setShowAllFree(true)}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-sf-raised hover:bg-sf-hover border border-sf-border hover:border-sf-border-accent rounded-full text-sm text-sf-heading font-medium transition-all duration-300 active:scale-[0.98]"
                  >
                    <span>{t('sections.showAll.free', { count: freeProducts.length })}</span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Premium Section */}
          {showPremium && (
            <div>
              <SectionHeader
                dotColor="var(--sf-accent, #0078BB)"
                label={t('sections.premium.badge', { count: paidProducts.length })}
                count={paidProducts.length}
                productCountLabel={t('sections.productCount', { count: paidProducts.length })}
              />
              <RevealGroup animation="fade-up" stagger={60}>
                {displayedPaidProducts.map((product) => (
                  <ProductRow
                    key={product.id}
                    product={product}
                    t={t}
                    productLinkPrefix={productLinkPrefix}
                  />
                ))}
              </RevealGroup>
              {paidProducts.length > 6 && !showAllPaid && (
                <div className="text-center mt-4">
                  <button
                    onClick={() => setShowAllPaid(true)}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-sf-raised hover:bg-sf-hover border border-sf-border hover:border-sf-border-accent rounded-full text-sm text-sf-heading font-medium transition-all duration-300 active:scale-[0.98]"
                  >
                    <span>{t('sections.showAll.premium', { count: paidProducts.length })}</span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-sf-border">
        <div className="max-w-[960px] mx-auto px-6 py-8 text-center">
          <p className="text-xs text-sf-muted opacity-50">
            {t('footer.poweredBy', { shopName })}
          </p>
        </div>
      </footer>
    </div>
  );
}

// ===== SUB-COMPONENTS =====

function FilterPill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all duration-200 border whitespace-nowrap ${
        active
          ? 'bg-sf-accent-bg border-sf-accent text-white'
          : 'bg-transparent border-sf-border text-sf-muted hover:border-sf-body hover:text-sf-body'
      }`}
    >
      {label}
    </button>
  );
}

function SectionHeader({ dotColor, label, count, productCountLabel }: { dotColor: string; label: string; count: number; productCountLabel: string }) {
  return (
    <div className="flex items-center gap-3 pt-6 pb-3">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dotColor }} />
      <span className="text-[0.7rem] uppercase tracking-wider text-sf-muted whitespace-nowrap">{label}</span>
      <div className="flex-1 h-px bg-sf-border" />
      <span className="text-[0.7rem] text-sf-muted whitespace-nowrap">
        {productCountLabel}
      </span>
    </div>
  );
}

function ProductRow({
  product,
  t,
  isHero = false,
  showFeaturedBadge = false,
  showFreeBadge = false,
  productLinkPrefix = '/p',
}: {
  product: Product;
  t: ReturnType<typeof useTranslations<'storefront'>>;
  isHero?: boolean;
  showFeaturedBadge?: boolean;
  showFreeBadge?: boolean;
  productLinkPrefix?: string;
}) {
  const isFree = product.price === 0;
  const hasAccessDuration = product.auto_grant_duration_days && product.auto_grant_duration_days > 0;

  return (
    <Link
      href={`${productLinkPrefix}/${product.slug}`}
      className={`group flex items-stretch border rounded-xl overflow-hidden mb-2.5 transition-all duration-250 bg-sf-raised cursor-pointer ${
        isHero
          ? 'border-sf-border-accent relative'
          : 'border-sf-border hover:border-sf-border-accent hover:shadow-[var(--sf-shadow-accent)]'
      }`}
    >
      {/* Accent left bar for hero */}
      {isHero && (
        <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-sf-accent to-[color-mix(in_srgb,var(--sf-accent)_70%,white)] rounded-l-xl" />
      )}

      {/* Icon / Image */}
      <div className={`flex items-center justify-center shrink-0 border-r border-sf-border bg-sf-base overflow-hidden ${
        isHero ? 'w-[88px] min-h-[88px] text-[32px]' : 'w-[72px] min-h-[72px] text-[26px]'
      }`}>
        {product.image_url ? (
          <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          product.icon || (isFree ? '🎁' : '📦')
        )}
      </div>

      {/* Body */}
      <div className={`flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-4 ${
        isHero ? 'p-4 sm:px-6' : 'p-3.5 sm:px-5'
      }`}>
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`font-semibold text-sf-heading truncate group-hover:text-sf-accent transition-colors duration-300 ${
              isHero ? 'text-base' : 'text-[0.92rem]'
            }`}>
              {product.name}
            </span>
            {showFeaturedBadge && (
              <span className="px-2 py-0.5 rounded-full text-[0.58rem] font-semibold uppercase tracking-wide bg-sf-warning-soft text-sf-warning shrink-0">
                {t('product.featured')}
              </span>
            )}
            {showFreeBadge && (
              <span className="px-2 py-0.5 rounded-full text-[0.58rem] font-semibold uppercase tracking-wide bg-sf-success-soft text-sf-success shrink-0">
                {t('product.free')}
              </span>
            )}
            {hasAccessDuration && (
              <span className="px-2 py-0.5 rounded-full text-[0.58rem] font-medium bg-sf-accent-soft text-sf-accent shrink-0">
                {t('product.daysAccessShort', { days: product.auto_grant_duration_days! })}
              </span>
            )}
          </div>
          <p className={`text-sf-muted truncate ${
            isHero ? 'text-[0.82rem] sm:whitespace-normal sm:line-clamp-2' : 'text-[0.78rem]'
          }`}>
            {product.description}
          </p>
        </div>

        {/* Action */}
        <div className="flex items-center gap-3.5 shrink-0 sm:justify-end">
          <span className={`text-[0.95rem] font-bold whitespace-nowrap ${
            isFree ? 'text-sf-success' : 'text-sf-heading'
          }`}>
            {isFree ? t('product.free') : formatPrice(product.price, product.currency)}
          </span>
          <span className={`px-4 py-1.5 rounded-lg text-[0.78rem] font-semibold whitespace-nowrap transition-all duration-200 ${
            isFree
              ? 'bg-sf-success hover:bg-sf-success/90 text-sf-inverse'
              : 'bg-sf-accent-bg hover:bg-sf-accent-hover text-white'
          }`}>
            {isFree ? t('product.getFreeAccess') : t('product.getAccessNow')}
          </span>
        </div>
      </div>
    </Link>
  );
}
