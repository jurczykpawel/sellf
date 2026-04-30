'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { Lock, ArrowLeft, Home, LayoutDashboard, Package, Users, LogIn, Info } from 'lucide-react';

// Stable mount detection that's safe for SSR hydration without the
// useState + useEffect cascade pattern.
const noopSubscribe = () => () => {};
const getMounted = () => true;
const getServerMounted = () => false;

export default function NotFound() {
  const mounted = useSyncExternalStore(noopSubscribe, getMounted, getServerMounted);
  const { user, isAdmin, loading } = useAuth();
  const t = useTranslations('notFound');

  if (!mounted || loading) {
    return null;
  }

  const isLoggedIn = !!user;

  const getContent = () => {
    if (isAdmin) {
      return {
        title: t('adminTitle'),
        description: t('adminDescription'),
        actionText: t('adminAction'),
        actionHref: '/dashboard',
        quickLinks: [
          { href: '/dashboard', label: t('linkDashboard'), icon: LayoutDashboard },
          { href: '/dashboard/products', label: t('linkProducts'), icon: Package },
          { href: '/dashboard/users', label: t('linkUsers'), icon: Users },
        ],
      };
    } else if (isLoggedIn) {
      return {
        title: t('userTitle'),
        description: t('userDescription'),
        actionText: t('userAction'),
        actionHref: '/dashboard',
        quickLinks: [
          { href: '/dashboard', label: t('linkDashboard'), icon: LayoutDashboard },
          { href: '/dashboard/products', label: t('linkProducts'), icon: Package },
          { href: '/login', label: t('linkAccount'), icon: LogIn },
        ],
      };
    }
    return {
      title: t('guestTitle'),
      description: t('guestDescription'),
      actionText: t('guestAction'),
      actionHref: '/login',
      quickLinks: [
        { href: '/login', label: t('linkLogin'), icon: LogIn },
        { href: '/', label: t('linkHome'), icon: Home },
        { href: '/about', label: t('linkLearnMore'), icon: Info },
      ],
    };
  };

  const content = getContent();

  return (
    <div className="min-h-screen bg-sf-deep flex items-center justify-center px-4">
      <div className="text-center max-w-lg mx-auto">
        <div className="mb-8 flex justify-center">
          <div className="w-20 h-20 bg-sf-accent/15 border border-sf-border-accent rounded-2xl flex items-center justify-center">
            <Lock className="h-10 w-10 text-sf-accent" />
          </div>
        </div>

        <h1 className="text-7xl font-bold text-sf-accent mb-4">404</h1>

        <h2 className="text-2xl font-bold text-sf-heading mb-3">
          {content.title}
        </h2>

        <p className="text-sf-body mb-8">
          {content.description}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-10">
          <Link
            href={content.actionHref}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white bg-sf-accent-bg hover:bg-sf-accent-hover transition-[background-color] duration-200 active:scale-[0.98]"
          >
            {content.actionText}
          </Link>

          <button
            onClick={() => window.history.back()}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-sf-heading border border-sf-border hover:border-sf-border-accent bg-sf-raised/80 transition-[border-color] duration-200 active:scale-[0.98]"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('goBack')}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {content.quickLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.href + link.label}
                href={link.href}
                className="p-4 rounded-xl border border-sf-border hover:border-sf-border-accent bg-sf-raised/60 transition-[border-color] duration-200"
              >
                <Icon className="w-5 h-5 mx-auto mb-2 text-sf-accent" />
                <p className="text-xs font-medium text-sf-heading">{link.label}</p>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
