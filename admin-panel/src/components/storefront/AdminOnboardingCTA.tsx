'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';

interface AdminOnboardingCTAProps {
  shopName: string;
  shopEmail: string | null;
}

export default function AdminOnboardingCTA({ shopName, shopEmail }: AdminOnboardingCTAProps) {
  const t = useTranslations('storefront.onboarding');

  const checklist = [
    { key: 'shopConfigured', completed: true },
    { key: 'addProduct', completed: false },
    { key: 'configurePayments', completed: false },
    { key: 'launch', completed: false },
  ];

  return (
    <div data-testid="admin-onboarding" className="min-h-screen bg-wl-deep flex items-center justify-center px-4 py-12">
      <div className="max-w-4xl w-full">
        {/* Hero Section */}
        <div className="text-center mb-12">
          {/* Welcome Badge */}
          <div className="mb-6 inline-block">
            <div className="px-6 py-2 bg-wl-accent-soft backdrop-blur-sm rounded-full border border-wl-border-accent">
              <span className="text-sm font-medium text-wl-accent">
                Admin Panel
              </span>
            </div>
          </div>

          {/* Title */}
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gf-heading mb-6">
            {t('welcome', { shopName })}
          </h1>

          {/* Subtitle */}
          <p className="text-xl md:text-2xl text-gf-body mb-8 max-w-2xl mx-auto leading-relaxed">
            {t('subtitle')}
          </p>

          {/* Main CTA Button */}
          <Link
            href="/dashboard/products?open=new"
            className="inline-flex items-center px-8 py-4 border border-transparent rounded-full text-lg font-medium text-white bg-wl-accent hover:bg-wl-accent-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-wl-accent transition-all duration-200 shadow-[var(--gf-shadow-accent)] active:scale-[0.98]"
          >
            <svg className="-ml-1 mr-3 h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            {t('addFirstProduct')}
          </Link>
        </div>

        {/* Setup Progress Card */}
        <div className="bg-gf-base rounded-2xl shadow-[var(--gf-shadow-accent)] border border-gf-border overflow-hidden">
          {/* Card Header */}
          <div className="bg-wl-accent px-8 py-6">
            <h2 className="text-2xl font-bold text-white">
              Setup Progress
            </h2>
            <p className="text-white/80 mt-1">
              Complete these steps to launch your store
            </p>
          </div>

          {/* Checklist */}
          <div className="p-8">
            <ul className="space-y-4">
              {checklist.map((item) => (
                <li key={item.key} className="flex items-start">
                  <div className="flex-shrink-0 mt-1">
                    {item.completed ? (
                      <div className="w-6 h-6 bg-gf-success rounded-full flex items-center justify-center">
                        <svg className="w-4 h-4 text-gf-heading" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    ) : (
                      <div className="w-6 h-6 bg-gf-raised rounded-full flex items-center justify-center">
                        <svg className="w-4 h-4 text-gf-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="ml-4">
                    <p className={`text-lg font-medium ${
                      item.completed
                        ? 'text-gf-heading'
                        : 'text-gf-muted'
                    }`}>
                      {t(`checklist.${item.key}`)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Quick Stats */}
          <div className="bg-gf-deep px-8 py-6 border-t border-gf-border">
            <div className="flex flex-wrap justify-center gap-6 text-center">
              <div className="flex items-center">
                <div className="w-10 h-10 bg-wl-accent-soft rounded-lg flex items-center justify-center mr-3">
                  <svg className="w-5 h-5 text-wl-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <div className="text-left">
                  <p className="text-2xl font-bold text-gf-heading">0</p>
                  <p className="text-sm text-gf-muted">{t('stats.products', { count: 0 })}</p>
                </div>
              </div>

              <div className="flex items-center">
                <div className="w-10 h-10 bg-gf-accent-soft rounded-lg flex items-center justify-center mr-3">
                  <svg className="w-5 h-5 text-gf-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                </div>
                <div className="text-left">
                  <p className="text-2xl font-bold text-gf-heading">0</p>
                  <p className="text-sm text-gf-muted">{t('stats.customers', { count: 0 })}</p>
                </div>
              </div>

              <div className="flex items-center">
                <div className="w-10 h-10 bg-gf-success-soft rounded-lg flex items-center justify-center mr-3">
                  <svg className="w-5 h-5 text-gf-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="text-left">
                  <p className="text-lg font-bold text-gf-success">{t('stats.ready')}</p>
                  <p className="text-sm text-gf-muted">{t('stats.status')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Links */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <Link
            href="/dashboard/products"
            className="group p-6 bg-gf-base rounded-2xl transition-all duration-300 border border-gf-border hover:border-wl-border-accent"
          >
            <div className="w-12 h-12 bg-wl-accent rounded-xl flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-gf-heading" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gf-heading mb-2">
              Products
            </h3>
            <p className="text-sm text-gf-body">
              Manage your product catalog
            </p>
          </Link>

          <Link
            href="/dashboard/settings"
            className="group p-6 bg-gf-base rounded-2xl transition-all duration-300 border border-gf-border hover:border-gf-border-accent"
          >
            <div className="w-12 h-12 bg-gf-accent-bg rounded-xl flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-gf-heading" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gf-heading mb-2">
              Payments
            </h3>
            <p className="text-sm text-gf-body">
              Configure Stripe integration
            </p>
          </Link>

          <Link
            href="/dashboard"
            className="group p-6 bg-gf-base rounded-2xl transition-all duration-300 border border-gf-border hover:border-gf-border-accent"
          >
            <div className="w-12 h-12 bg-gf-success rounded-xl flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-gf-heading" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gf-heading mb-2">
              Dashboard
            </h3>
            <p className="text-sm text-gf-body">
              View analytics and insights
            </p>
          </Link>
        </div>

        {/* Decorative Background */}
        <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-wl-accent-soft rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-blob"></div>
          <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-wl-accent-soft rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-blob animation-delay-2000"></div>
          <div className="absolute bottom-1/4 left-1/3 w-96 h-96 bg-wl-accent-soft rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-blob animation-delay-4000"></div>
        </div>
      </div>

      {/* Animation Styles */}
      <style jsx>{`
        @keyframes blob {
          0% {
            transform: translate(0px, 0px) scale(1);
          }
          33% {
            transform: translate(30px, -50px) scale(1.1);
          }
          66% {
            transform: translate(-20px, 20px) scale(0.9);
          }
          100% {
            transform: translate(0px, 0px) scale(1);
          }
        }
        .animate-blob {
          animation: blob 7s infinite;
        }
        .animation-delay-2000 {
          animation-delay: 2s;
        }
        .animation-delay-4000 {
          animation-delay: 4s;
        }
      `}</style>
    </div>
  );
}
