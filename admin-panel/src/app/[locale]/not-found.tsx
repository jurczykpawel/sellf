'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Lock, ArrowLeft, Home, LayoutDashboard, Package, Users, LogIn, Info } from 'lucide-react';

export default function NotFound() {
  const [mounted, setMounted] = useState(false);
  const { user, isAdmin, loading } = useAuth();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || loading) {
    return null;
  }

  const isLoggedIn = !!user;

  const getContent = () => {
    if (isAdmin) {
      return {
        title: 'Admin Gate Locked',
        description: 'Even admins can\'t access pages that don\'t exist.',
        actionText: 'Return to Dashboard',
        actionHref: '/dashboard',
        quickLinks: [
          { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
          { href: '/dashboard/products', label: 'Products', icon: Package },
          { href: '/dashboard/users', label: 'Users', icon: Users },
        ],
      };
    } else if (isLoggedIn) {
      return {
        title: 'Page Not Found',
        description: 'This page might be restricted or doesn\'t exist.',
        actionText: 'Back to Dashboard',
        actionHref: '/dashboard',
        quickLinks: [
          { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
          { href: '/dashboard/products', label: 'Products', icon: Package },
          { href: '/login', label: 'Account', icon: LogIn },
        ],
      };
    }
    return {
      title: 'Page Not Found',
      description: 'This page doesn\'t exist or requires authentication.',
      actionText: 'Get Access',
      actionHref: '/login',
      quickLinks: [
        { href: '/login', label: 'Login', icon: LogIn },
        { href: '/', label: 'Home', icon: Home },
        { href: '/about', label: 'Learn More', icon: Info },
      ],
    };
  };

  const content = getContent();

  return (
    <div className="min-h-screen bg-gf-deep flex items-center justify-center px-4">
      <div className="text-center max-w-lg mx-auto">
        <div className="mb-8 flex justify-center">
          <div className="w-20 h-20 bg-gf-accent/15 border border-gf-border-accent rounded-2xl flex items-center justify-center">
            <Lock className="h-10 w-10 text-gf-accent" />
          </div>
        </div>

        <h1 className="text-7xl font-bold text-gf-accent mb-4">404</h1>

        <h2 className="text-2xl font-bold text-gf-heading mb-3">
          {content.title}
        </h2>

        <p className="text-gf-body mb-8">
          {content.description}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-10">
          <Link
            href={content.actionHref}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white bg-gf-accent hover:bg-gf-accent-hover transition-[background-color] duration-200 active:scale-[0.98]"
          >
            {content.actionText}
          </Link>

          <button
            onClick={() => window.history.back()}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-gf-heading border border-gf-border hover:border-gf-border-accent bg-gf-raised/80 transition-[border-color] duration-200 active:scale-[0.98]"
          >
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {content.quickLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.href + link.label}
                href={link.href}
                className="p-4 rounded-xl border border-gf-border hover:border-gf-border-accent bg-gf-raised/60 transition-[border-color] duration-200"
              >
                <Icon className="w-5 h-5 mx-auto mb-2 text-gf-accent" />
                <p className="text-xs font-medium text-gf-heading">{link.label}</p>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
