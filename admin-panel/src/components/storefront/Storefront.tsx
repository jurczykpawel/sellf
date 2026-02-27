'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Product } from '@/types';
import { formatPrice } from '@/lib/constants';
import { useState, useEffect } from 'react';

interface StorefrontProps {
  products: Product[];
  shopName: string;
  featuredProducts: Product[];
  freeProducts: Product[];
  paidProducts: Product[];
}

export default function Storefront({
  products,
  shopName,
  featuredProducts,
  freeProducts,
  paidProducts,
}: StorefrontProps) {
  const t = useTranslations('storefront');
  const [mounted, setMounted] = useState(false);
  const [showAllFree, setShowAllFree] = useState(false);
  const [showAllPaid, setShowAllPaid] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Determine shop personality based on product mix
  const isFreeOnly = freeProducts.length > 0 && paidProducts.length === 0;
  const isPaidOnly = paidProducts.length > 0 && freeProducts.length === 0;
  const isMixed = freeProducts.length > 0 && paidProducts.length > 0;

  // Check for temporal availability badges
  const hasLimitedTimeProducts = products.some(p => p.available_until);
  const hasComingSoonProducts = products.some(p => p.available_from && new Date(p.available_from) > new Date());

  // Display logic - show 6 initially, then all on click
  const displayedFreeProducts = showAllFree ? freeProducts : freeProducts.slice(0, 6);
  const displayedPaidProducts = showAllPaid ? paidProducts : paidProducts.slice(0, 6);

  if (!mounted) {
    return (
      <div className="w-full bg-gf-deep flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gf-accent"></div>
      </div>
    );
  }

  return (
    <div data-testid="storefront" className="w-full bg-gf-deep relative overflow-hidden">
      {/* Mesh gradient background */}
      <div className="absolute inset-0 z-0">
        <div
          className="absolute inset-0"
          style={{
            background: [
              'radial-gradient(ellipse at 20% 50%, var(--gf-accent-glow) 0%, transparent 60%)',
              'radial-gradient(ellipse at 80% 20%, rgba(0,170,255,0.08) 0%, transparent 50%)',
              'radial-gradient(ellipse at 50% 100%, rgba(0,170,255,0.05) 0%, transparent 40%)',
            ].join(', '),
          }}
        />
        <div className="absolute top-1/4 -left-48 w-96 h-96 bg-gf-accent rounded-full filter blur-3xl opacity-[0.06]" />
        <div className="absolute top-1/3 -right-48 w-96 h-96 bg-gf-accent rounded-full filter blur-3xl opacity-[0.04]" />
      </div>

      {/* Hero Section - Dynamic based on product mix */}
      <section className="relative pt-32 pb-20 px-4 sm:px-6 lg:px-8 z-10">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            {/* Shop name badge with pulse effect */}
            <div className="mb-8 inline-block group">
              <div className="relative">
                <div className="absolute -inset-1 bg-gf-accent rounded-full blur opacity-25 group-hover:opacity-75 transition duration-1000"></div>
                <div className="relative px-8 py-3 bg-gf-raised/60 backdrop-blur-xl border border-gf-border rounded-full">
                  <span className="text-lg font-semibold bg-gradient-to-r from-gf-accent to-gf-accent-hover bg-clip-text text-transparent">
                    {shopName}
                  </span>
                </div>
              </div>
            </div>

            {/* Dynamic hero headline based on shop type */}
            {isFreeOnly && (
              <div className="space-y-6">
                <h1 className="text-5xl md:text-7xl lg:text-8xl font-black text-gf-heading leading-tight">
                  {t('hero.freeOnly.title')}
                  <br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-green-400 via-emerald-400 to-teal-400 animate-gradient-xy">
                    {t('hero.freeOnly.titleHighlight')}
                  </span>
                </h1>
                <p className="text-xl md:text-2xl text-gf-body max-w-3xl mx-auto leading-relaxed">
                  {t('hero.freeOnly.description', { count: freeProducts.length })}
                </p>
              </div>
            )}

            {isPaidOnly && (
              <div className="space-y-6">
                <h1 className="text-5xl md:text-7xl lg:text-8xl font-black text-gf-heading leading-tight">
                  {t('hero.paidOnly.title')}
                  <br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-gf-accent to-gf-accent-hover animate-gradient-xy">
                    {t('hero.paidOnly.titleHighlight')}
                  </span>
                </h1>
                <p className="text-xl md:text-2xl text-gf-body max-w-3xl mx-auto leading-relaxed">
                  {t('hero.paidOnly.description', { count: paidProducts.length })}
                </p>
              </div>
            )}

            {isMixed && (
              <div className="space-y-6">
                <h1 className="text-5xl md:text-7xl lg:text-8xl font-black text-gf-heading leading-tight">
                  {t('hero.mixed.title')}
                  <br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-green-400 via-gf-accent to-gf-accent-hover animate-gradient-xy">
                    {t('hero.mixed.titleHighlight')}
                  </span>
                </h1>
                <p className="text-xl md:text-2xl text-gf-body max-w-3xl mx-auto leading-relaxed">
                  {t('hero.mixed.description', { freeCount: freeProducts.length, paidCount: paidProducts.length })}
                </p>
              </div>
            )}

            {/* Dynamic badges */}
            <div className="flex flex-wrap justify-center gap-4 mt-12">
              <div className="flex items-center gap-3 px-6 py-3 bg-gf-raised/40 backdrop-blur-xl border border-gf-border rounded-full group hover:bg-gf-raised/60 transition-all duration-300">
                <div className="relative">
                  <div className="absolute -inset-1 bg-gf-accent rounded-full blur opacity-25 group-hover:opacity-75 transition duration-300"></div>
                  <div className="relative w-8 h-8 bg-gf-accent rounded-full flex items-center justify-center">
                    <span className="text-gf-heading font-bold text-sm">{products.length}</span>
                  </div>
                </div>
                <span className="text-gf-heading font-medium">
                  {t('hero.badges.productsAvailable', { count: products.length })}
                </span>
              </div>

              {hasLimitedTimeProducts && (
                <div className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-orange-500/20 to-red-500/20 backdrop-blur-xl border border-orange-500/30 rounded-full">
                  <svg className="w-5 h-5 text-orange-400 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                  </svg>
                  <span className="text-orange-300 font-medium text-sm">{t('hero.badges.limitedTime')}</span>
                </div>
              )}

              {hasComingSoonProducts && (
                <div className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500/20 to-cyan-500/20 backdrop-blur-xl border border-blue-500/30 rounded-full">
                  <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
                  </svg>
                  <span className="text-blue-300 font-medium text-sm">{t('hero.badges.comingSoon')}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Featured Products - Bento Grid */}
      {featuredProducts.length > 0 && (
        <section className="relative py-20 px-4 sm:px-6 lg:px-8 z-10">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <div className="inline-block mb-4">
                <div className="flex items-center gap-2 px-4 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-full">
                  <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <span className="text-yellow-300 font-semibold text-sm uppercase tracking-wide">{t('featured.badge')}</span>
                </div>
              </div>
              <h2 className="text-4xl md:text-5xl font-black text-gf-heading mb-4">
                {t('featured.title')}
              </h2>
              <p className="text-xl text-gf-muted max-w-2xl mx-auto">
                {t('featured.subtitle')}
              </p>
            </div>

            {/* Bento Grid Layout - responsive and dynamic */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {featuredProducts.map((product, index) => {
                const isLimitedTime = product.available_until && new Date(product.available_until) > new Date();
                const isComingSoon = product.available_from && new Date(product.available_from) > new Date();
                const hasAccessDuration = product.auto_grant_duration_days && product.auto_grant_duration_days > 0;

                // First featured product gets larger card
                const isHero = index === 0 && featuredProducts.length > 1;

                return (
                  <div
                    key={product.id}
                    className={`group relative ${
                      isHero ? 'md:col-span-2 md:row-span-2' : ''
                    }`}
                  >
                    <div className="absolute -inset-0.5 bg-gf-accent rounded-2xl blur opacity-25 group-hover:opacity-75 transition duration-1000"></div>
                    <div className="relative h-full bg-gf-raised/60 backdrop-blur-xl border border-gf-border rounded-2xl p-6 md:p-8 hover:border-gf-border-accent transition-all duration-300 flex flex-col">
                      {/* Badges */}
                      <div className="flex flex-wrap gap-2 mb-4">
                        <div className="flex items-center px-3 py-1.5 bg-yellow-500/20 border border-yellow-500/30 rounded-full">
                          <svg className="w-4 h-4 text-yellow-400 mr-1.5" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                          </svg>
                          <span className="text-yellow-300 font-semibold text-xs uppercase">{t('product.featured')}</span>
                        </div>
                        {isLimitedTime && (
                          <div className="flex items-center px-3 py-1.5 bg-orange-500/20 border border-orange-500/30 rounded-full animate-pulse">
                            <svg className="w-4 h-4 text-orange-400 mr-1.5" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                            </svg>
                            <span className="text-orange-300 font-semibold text-xs uppercase">{t('product.limited')}</span>
                          </div>
                        )}
                        {isComingSoon && (
                          <div className="flex items-center px-3 py-1.5 bg-blue-500/20 border border-blue-500/30 rounded-full">
                            <span className="text-blue-300 font-semibold text-xs uppercase">{t('product.comingSoon')}</span>
                          </div>
                        )}
                      </div>

                      {/* Icon */}
                      <div className={`${isHero ? 'text-6xl md:text-8xl' : 'text-5xl'} mb-4 transform group-hover:scale-110 transition-transform duration-300`}>
                        {product.icon || '📦'}
                      </div>

                      {/* Content */}
                      <h3 className={`${isHero ? 'text-3xl md:text-4xl' : 'text-2xl'} font-bold text-gf-heading mb-3 group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-gf-accent group-hover:to-gf-accent-hover transition-all duration-300`}>
                        {product.name}
                      </h3>

                      <p className={`${isHero ? 'text-lg' : 'text-base'} text-gf-muted mb-6 flex-grow`}>
                        {product.description}
                      </p>

                      {/* Price & Duration */}
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          {product.price === 0 ? (
                            <div className="flex items-center gap-2 px-4 py-2 bg-green-500/20 border border-green-500/30 rounded-lg">
                              <span className="text-2xl font-black text-green-400">{t('product.free')}</span>
                            </div>
                          ) : (
                            <div className={`${isHero ? 'text-4xl md:text-5xl' : 'text-3xl'} font-black text-transparent bg-clip-text bg-gradient-to-r from-gf-accent to-gf-accent-hover`}>
                              {formatPrice(product.price, product.currency)}
                            </div>
                          )}
                          {hasAccessDuration && (
                            <div className="px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                              <span className="text-blue-300 text-sm font-medium">
                                {t('product.daysAccess', { days: product.auto_grant_duration_days! })}
                              </span>
                            </div>
                          )}
                        </div>

                        <Link
                          href={`/p/${product.slug}`}
                          className={`block w-full text-center font-bold ${isHero ? 'py-5 text-lg' : 'py-4'} px-6 rounded-xl transition-all duration-300 transform hover:scale-105 hover:shadow-2xl ${
                            product.price === 0
                              ? 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white'
                              : 'bg-gf-accent hover:bg-gf-accent-hover text-white'
                          }`}
                        >
                          {product.price === 0 ? t('product.getFreeAccessIcon') : t('product.getAccessNowIcon')}
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Free Products Section */}
      {freeProducts.length > 0 && (
        <section id="products" className="relative py-20 px-4 sm:px-6 lg:px-8 z-10">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <div className="inline-block mb-4">
                <div className="flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/20 rounded-full">
                  <svg className="w-5 h-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-green-300 font-semibold text-sm uppercase tracking-wide">
                    {t('sections.free.badge', { count: freeProducts.length })}
                  </span>
                </div>
              </div>
              <h2 className="text-4xl md:text-5xl font-black text-gf-heading mb-4">
                {isFreeOnly ? t('sections.free.titleFreeOnly') : t('sections.free.titleMixed')}
              </h2>
              <p className="text-xl text-gf-muted max-w-2xl mx-auto">
                {isFreeOnly
                  ? t('sections.free.subtitleFreeOnly')
                  : t('sections.free.subtitleMixed')}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {displayedFreeProducts.map((product) => (
                <div key={product.id} className="group relative">
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-green-600 to-emerald-600 rounded-2xl blur opacity-25 group-hover:opacity-75 transition duration-1000"></div>
                  <div className="relative h-full bg-gf-raised/60 backdrop-blur-xl border border-gf-border rounded-2xl p-6 hover:border-gf-border-accent transition-all duration-300 flex flex-col">
                    <div className="text-4xl mb-4 transform group-hover:scale-110 transition-transform duration-300">
                      {product.icon || '🎁'}
                    </div>

                    <h3 className="text-xl font-bold text-gf-heading mb-3 group-hover:text-green-400 transition-colors duration-300">
                      {product.name}
                    </h3>

                    <p className="text-gf-muted mb-6 flex-grow">
                      {product.description}
                    </p>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/20 border border-green-500/30 rounded-lg">
                          <span className="text-xl font-black text-green-400">{t('product.free')}</span>
                        </div>
                        {product.auto_grant_duration_days && product.auto_grant_duration_days > 0 && (
                          <div className="px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-300">
                            {t('product.daysAccessShort', { days: product.auto_grant_duration_days! })}
                          </div>
                        )}
                      </div>

                      <Link
                        href={`/p/${product.slug}`}
                        className="block w-full text-center font-bold py-3 px-6 rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white transition-all duration-300 transform hover:scale-105"
                      >
                        {t('product.getFreeAccess')}
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {freeProducts.length > 6 && !showAllFree && (
              <div className="text-center mt-12">
                <button
                  onClick={() => setShowAllFree(true)}
                  className="inline-flex items-center gap-2 px-8 py-4 bg-gf-raised/40 hover:bg-gf-raised/60 backdrop-blur-xl border border-gf-border hover:border-gf-border-accent rounded-xl text-gf-heading font-semibold transition-all duration-300 transform hover:scale-105"
                >
                  <span>{t('sections.showAll.free', { count: freeProducts.length })}</span>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Premium Products Section */}
      {paidProducts.length > 0 && (
        <section id={freeProducts.length === 0 ? "products" : undefined} className="relative py-20 px-4 sm:px-6 lg:px-8 z-10">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <div className="inline-block mb-4">
                <div className="flex items-center gap-2 px-4 py-2 bg-gf-accent-soft border border-gf-border-accent rounded-full">
                  <svg className="w-5 h-5 text-gf-accent" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <span className="text-gf-accent font-semibold text-sm uppercase tracking-wide">
                    {t('sections.premium.badge', { count: paidProducts.length })}
                  </span>
                </div>
              </div>
              <h2 className="text-4xl md:text-5xl font-black text-gf-heading mb-4">
                {isPaidOnly ? t('sections.premium.titlePaidOnly') : t('sections.premium.titleMixed')}
              </h2>
              <p className="text-xl text-gf-muted max-w-2xl mx-auto">
                {isPaidOnly
                  ? t('sections.premium.subtitlePaidOnly')
                  : t('sections.premium.subtitleMixed')}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {displayedPaidProducts.map((product) => {
                const isLimitedTime = product.available_until && new Date(product.available_until) > new Date();

                return (
                  <div key={product.id} className="group relative">
                    <div className="absolute -inset-0.5 bg-gf-accent rounded-2xl blur opacity-25 group-hover:opacity-75 transition duration-1000"></div>
                    <div className="relative h-full bg-gf-raised/60 backdrop-blur-xl border border-gf-border rounded-2xl p-6 hover:border-gf-border-accent transition-all duration-300 flex flex-col">
                      {/* Badges */}
                      <div className="flex flex-wrap gap-2 mb-4">
                        <div className="flex items-center px-2 py-1 bg-gf-accent-soft border border-gf-border-accent rounded-full">
                          <svg className="w-3 h-3 text-gf-accent mr-1" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                          </svg>
                          <span className="text-xs font-semibold text-gf-accent uppercase">{t('product.premium')}</span>
                        </div>
                        {isLimitedTime && (
                          <div className="flex items-center px-2 py-1 bg-orange-500/20 border border-orange-500/30 rounded-full animate-pulse">
                            <svg className="w-3 h-3 text-orange-400 mr-1" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                            </svg>
                            <span className="text-xs font-semibold text-orange-300 uppercase">{t('product.limited')}</span>
                          </div>
                        )}
                      </div>

                      <div className="text-4xl mb-4 transform group-hover:scale-110 transition-transform duration-300">
                        {product.icon || '💎'}
                      </div>

                      <h3 className="text-xl font-bold text-gf-heading mb-3 group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-gf-accent group-hover:to-gf-accent-hover transition-all duration-300">
                        {product.name}
                      </h3>

                      <p className="text-gf-muted mb-6 flex-grow">
                        {product.description}
                      </p>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-gf-accent to-gf-accent-hover">
                            {formatPrice(product.price, product.currency)}
                          </div>
                          {product.auto_grant_duration_days && product.auto_grant_duration_days > 0 && (
                            <div className="px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-300">
                              {t('product.daysAccessShort', { days: product.auto_grant_duration_days! })}
                            </div>
                          )}
                        </div>

                        <Link
                          href={`/p/${product.slug}`}
                          className="block w-full text-center font-bold py-3 px-6 rounded-xl bg-gf-accent hover:bg-gf-accent-hover text-white transition-all duration-300 transform hover:scale-105 hover:shadow-2xl"
                        >
                          {t('product.getAccessNow')}
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {paidProducts.length > 6 && !showAllPaid && (
              <div className="text-center mt-12">
                <button
                  onClick={() => setShowAllPaid(true)}
                  className="inline-flex items-center gap-2 px-8 py-4 bg-gf-accent-soft hover:bg-gf-accent-med backdrop-blur-xl border border-gf-border-accent hover:border-gf-accent/40 rounded-xl text-gf-heading font-semibold transition-all duration-300 transform hover:scale-105"
                >
                  <span>{t('sections.showAll.premium', { count: paidProducts.length })}</span>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Final CTA Section - Dynamic */}
      <section className="relative py-32 px-4 sm:px-6 lg:px-8 z-10">
        <div className="max-w-4xl mx-auto text-center">
          <div className="relative">
            <div className="absolute -inset-4 bg-gf-accent rounded-3xl blur-2xl opacity-20"></div>
            <div className="relative bg-slate-900/90 backdrop-blur-2xl border border-white/10 rounded-3xl p-12 md:p-16">
              <h2 className="text-4xl md:text-5xl font-black text-gf-heading mb-6">
                {isFreeOnly && t('cta.freeOnly.title')}
                {isPaidOnly && t('cta.paidOnly.title')}
                {isMixed && t('cta.mixed.title')}
              </h2>
              <p className="text-xl text-gf-muted mb-10 max-w-2xl mx-auto">
                {isFreeOnly && t('cta.freeOnly.description')}
                {isPaidOnly && t('cta.paidOnly.description')}
                {isMixed && t('cta.mixed.description')}
              </p>

              <a
                href="#products"
                className="inline-flex items-center gap-3 px-10 py-5 bg-gf-accent hover:bg-gf-accent-hover text-white rounded-xl font-black text-lg transition-all duration-300 transform hover:scale-105 hover:shadow-2xl"
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById('products')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              >
                <span>{t('cta.browseAll')}</span>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </a>

              <p className="mt-8 text-sm text-gf-muted">
                {t('cta.poweredBy', { count: products.length, shopName })}
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
