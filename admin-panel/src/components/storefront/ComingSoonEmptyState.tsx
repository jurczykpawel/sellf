'use client';

import { useTranslations } from 'next-intl';

interface ComingSoonEmptyStateProps {
  shopName: string;
  contactEmail: string | null;
}

export default function ComingSoonEmptyState({ shopName, contactEmail }: ComingSoonEmptyStateProps) {
  const t = useTranslations('storefront.comingSoon');

  return (
    <div data-testid="coming-soon" className="min-h-screen bg-sf-deep flex items-center justify-center px-4 py-12">
      <div className="max-w-2xl w-full text-center">
        {/* Animated Rocket */}
        <div className="mb-8 flex justify-center">
          <div className="text-8xl animate-bounce">
            🚀
          </div>
        </div>

        {/* Shop Name Badge */}
        <div className="mb-6 inline-block">
          <div className="px-6 py-2 bg-sf-base/80 backdrop-blur-sm rounded-full border border-sf-border">
            <span className="text-sm font-medium text-sf-muted">
              {shopName}
            </span>
          </div>
        </div>

        {/* Title */}
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-sf-heading mb-6">
          <span className="text-sf-accent">
            {t('title')}
          </span>
        </h1>

        {/* Subtitle */}
        <p className="text-xl md:text-2xl text-sf-body mb-8 leading-relaxed">
          {t('subtitle')}
        </p>

        {/* Learn More Link */}
        <div className="mb-12">
          <a 
            href="/about" 
            className="inline-flex items-center px-6 py-3 rounded-full bg-sf-accent-soft text-sf-accent font-bold hover:bg-sf-accent-soft transition-all group border border-sf-border-accent"
          >
            <span className="mr-2">🚀</span>
            {t('learnMore')}
            <span className="ml-2 transform transition-transform group-hover:translate-x-1">→</span>
          </a>
        </div>

        {/* Contact Information */}
        {contactEmail && (
          <div className="mt-12 p-6 bg-sf-base/50 backdrop-blur-sm rounded-2xl border border-sf-border">
            <p className="text-sm text-sf-muted">
              {t('contactUs', { email: contactEmail })}
            </p>
          </div>
        )}

        {/* Decorative Elements */}
        <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-sf-accent-soft rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-blob"></div>
          <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-sf-accent-soft rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-blob animation-delay-2000"></div>
          <div className="absolute bottom-1/4 left-1/3 w-96 h-96 bg-sf-accent-soft rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-blob animation-delay-4000"></div>
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
