'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import FloatingLanguageSwitcher from './FloatingLanguageSwitcher'
import ThemeToggleButton from './ThemeToggleButton'
import type { ShopConfig } from '@/lib/actions/shop-config'
import DemoBanner from './DemoBanner'
import { useUpdateCheck } from '@/hooks/useUpdateCheck'
import UpdateNotificationModal from './UpdateNotificationModal'

interface DashboardLayoutProps {
  children: React.ReactNode
  user?: {
    email?: string
    id: string
  } | null
  isAdmin?: boolean
  shopConfig?: ShopConfig | null
  showSellfCTA?: boolean
}

// Icons
const Icons = {
  dashboard: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  ),
  products: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
  categories: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
    </svg>
  ),
  orderBumps: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  ),
  variants: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  ),
  coupons: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
    </svg>
  ),
  webhooks: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  integrations: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
    </svg>
  ),
  users: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
    </svg>
  ),
  payments: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  ),
  myProducts: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  ),
  store: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
    </svg>
  ),
  profile: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  logout: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  ),
  settings: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  apiKeys: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
    </svg>
  ),
  about: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  refunds: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
    </svg>
  ),
  purchases: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  )
};

export default function DashboardLayout({ children, user, isAdmin: isAdminProp, shopConfig, showSellfCTA }: DashboardLayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const { signOut, isAdmin: isAdminContext } = useAuth()
  const t = useTranslations('navigation')
  const pathname = usePathname()

  // Use prop if provided (from server), otherwise fallback to context (client)
  const isAdmin = isAdminProp !== undefined ? isAdminProp : isAdminContext

  // Auto-check for updates (admin only, with smart caching)
  const updateCheck = useUpdateCheck(!!isAdmin)

  // Extract branding from shop config
  const shopName = shopConfig?.shop_name || 'Sellf'
  const logoUrl = shopConfig?.logo_url
  const primaryColor = shopConfig?.primary_color || '#00AAFF'
  const secondaryColor = shopConfig?.secondary_color || '#33BBFF'

  const handleSignOut = async () => {
    await signOut()
  }

  // Navigation Items Config
  const adminLinks = [
    { href: '/dashboard', label: t('dashboard'), icon: Icons.dashboard, exact: true },
    { href: '/dashboard/products', label: t('products'), icon: Icons.products },
    { href: '/dashboard/variants', label: t('variants', { defaultValue: 'Variants' }), icon: Icons.variants },
    { href: '/dashboard/categories', label: t('categories'), icon: Icons.categories },
    { href: '/dashboard/order-bumps', label: t('orderBumps'), icon: Icons.orderBumps },
    { href: '/dashboard/coupons', label: t('coupons'), icon: Icons.coupons },
    { href: '/dashboard/refund-requests', label: t('refundRequests', { defaultValue: 'Refund Requests' }), icon: Icons.refunds },
    { href: '/dashboard/webhooks', label: t('webhooks'), icon: Icons.webhooks },
    { href: '/dashboard/integrations', label: t('integrations'), icon: Icons.integrations },
    { href: '/dashboard/api-keys', label: t('apiKeys', { defaultValue: 'API Keys' }), icon: Icons.apiKeys },
    { href: '/dashboard/users', label: t('users'), icon: Icons.users },
    { href: '/dashboard/settings', label: t('settings'), icon: Icons.settings },
  ];

  const userLinks = [
    { href: '/my-products', label: t('myProducts'), icon: Icons.myProducts },
    { href: '/my-purchases', label: t('myPurchases', { defaultValue: 'My Purchases' }), icon: Icons.purchases },
    { href: '/', label: t('store'), icon: Icons.store },
    { href: '/profile', label: t('profile'), icon: Icons.profile },
    { href: '/about', label: t('about'), icon: Icons.about },
  ];

  const NavItem = ({ href, label, icon, exact }: { href: string, label: string, icon: React.ReactNode, exact?: boolean }) => {
    const active = exact ? pathname === href || pathname === href + '/' : pathname.includes(href);
    return (
      <Link
        href={href}
        onClick={() => setIsSidebarOpen(false)}
        className={`flex items-center px-3 py-2.5 rounded-lg mb-1 transition-colors duration-200 group ${
          active
            ? 'bg-gf-sidebar-accent text-gf-accent font-medium'
            : 'text-gf-sidebar-text hover:bg-gf-hover hover:text-gf-sidebar-text-active'
        }`}
      >
        <span className={`mr-3 ${active ? 'text-gf-accent' : 'text-gf-sidebar-text group-hover:text-gf-sidebar-text-active'}`}>
          {icon}
        </span>
        {label}
      </Link>
    );
  };

  // ---------------------------------------------------------------------------
  // PUBLIC LAYOUT (No Sidebar) - For guests / login page / storefront
  // ---------------------------------------------------------------------------
  if (!user) {
    return (
      <div className="min-h-screen bg-gf-deep flex flex-col">
        {/* Simple Top Header for Guests */}
        <header className="h-16 bg-gf-base border-b border-gf-border flex items-center shadow-sm sticky top-0 z-40">
          <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 flex items-center justify-between">
            <div className="flex items-center">
              <Link href="/" className="flex items-center group">
                {logoUrl ? (
                  <img src={logoUrl} alt={shopName} className="w-9 h-9 object-contain mr-3 group-hover:scale-105 transition-transform" />
                ) : (
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center mr-3 shadow-md group-hover:scale-105 transition-transform"
                    style={{
                      background: `linear-gradient(to right, ${primaryColor}, ${secondaryColor})`
                    }}
                  >
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                    </svg>
                  </div>
                )}
                <span className="text-xl font-extrabold text-gf-heading leading-none">
                  {shopName}
                </span>
              </Link>
            </div>
            <div className="flex items-center space-x-2 sm:space-x-4">
              {showSellfCTA && (
                <Link
                  href="/about"
                  className="hidden sm:inline-flex items-center px-4 py-2 rounded-full bg-gf-accent text-white text-xs font-bold hover:bg-gf-accent-hover hover:shadow-lg transition-all transform hover:scale-105"
                >
                  <span className="mr-1.5">🚀</span>
                  {t('getSellf', { defaultValue: 'Get Sellf' })}
                </Link>
              )}
              <div className="flex items-center h-full gap-1">
                <ThemeToggleButton size="sm" />
                <FloatingLanguageSwitcher mode="static" variant="compact" />
              </div>
              <div className="h-8 w-px bg-gf-border mx-2 hidden sm:block"></div>
              <Link 
                href="/login" 
                className="inline-flex items-center px-4 py-2 bg-gf-accent hover:bg-gf-accent-hover text-gf-inverse rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow-md active:scale-95"
              >
                {t('login')}
              </Link>
            </div>
          </div>
        </header>

        <main className="flex-1">
          {children}
        </main>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // AUTHENTICATED LAYOUT (With Sidebar)
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gf-deep flex">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-gf-sidebar-bg border-r border-gf-border h-screen sticky top-0">
        <div className="h-16 flex items-center px-6 border-b border-gf-border">
          <Link href="/" className="flex items-center">
            {logoUrl ? (
              <img src={logoUrl} alt={shopName} className="w-8 h-8 object-contain mr-3" />
            ) : (
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center mr-3 shadow-sm"
                style={{
                  background: `linear-gradient(to right, ${primaryColor}, ${secondaryColor})`
                }}
              >
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
              </div>
            )}
            <span className="text-xl font-bold text-gf-heading">
              {shopName}
            </span>
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto py-6 px-4">
          {user && isAdmin && (
            <div className="mb-8">
              <h3 className="px-3 text-xs font-semibold text-gf-sidebar-text uppercase tracking-wider mb-2">
                {t('adminSection')}
              </h3>
              <nav className="space-y-0.5">
                {adminLinks.map(link => (
                  <NavItem key={link.href} {...link} />
                ))}
              </nav>
            </div>
          )}

          <div>
            <h3 className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              {t('userSection')}
            </h3>
            <nav className="space-y-0.5">
              {userLinks.map(link => (
                <NavItem key={link.href} {...link} />
              ))}
            </nav>
          </div>
        </div>

        <div className="p-4 border-t border-gf-border bg-gf-raised">
          <div className="flex items-center w-full">
            <div className="w-8 h-8 rounded-full bg-gf-accent flex items-center justify-center text-gf-inverse text-xs font-bold mr-3 shadow-sm">
              {user.email?.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gf-heading truncate">
                {user.email}
              </p>
              <p className="text-xs text-gf-muted truncate">
                {isAdmin ? t('roleAdmin') : t('roleUser')}
              </p>
            </div>
            <button 
              onClick={handleSignOut}
              className="ml-2 p-1.5 text-gf-muted hover:text-gf-heading rounded-md hover:bg-gf-hover transition-colors"
              title={t('logout')}
            >
              {Icons.logout}
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
            onClick={() => setIsSidebarOpen(false)}
          />

          <div className="fixed inset-y-0 left-0 w-64 bg-gf-sidebar-bg shadow-2xl flex flex-col h-full transform transition-transform duration-300 ease-in-out">
            <div className="h-16 flex items-center justify-between px-6 border-b border-gf-border">
              <div className="flex items-center">
                {logoUrl ? (
                  <img src={logoUrl} alt={shopName} className="w-8 h-8 object-contain mr-3" />
                ) : (
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center mr-3"
                    style={{
                      background: `linear-gradient(to right, ${primaryColor}, ${secondaryColor})`
                    }}
                  >
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                    </svg>
                  </div>
                )}
                <span className="text-xl font-bold text-gf-heading">{shopName}</span>
              </div>
              <button 
                onClick={() => setIsSidebarOpen(false)}
                className="text-gf-muted hover:text-gf-heading"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-6 px-4">
              {user && isAdmin && (
                <div className="mb-8">
                  <h3 className="px-3 text-xs font-semibold text-gf-sidebar-text uppercase tracking-wider mb-2">{t('adminSection')}</h3>
                  {adminLinks.map(link => <NavItem key={link.href} {...link} />)}
                </div>
              )}
              <div>
                <h3 className="px-3 text-xs font-semibold text-gf-sidebar-text uppercase tracking-wider mb-2">{t('userSection')}</h3>
                {userLinks.map(link => <NavItem key={link.href} {...link} />)}
              </div>
            </div>

            <div className="p-4 border-t border-gf-border">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                  <div className="w-8 h-8 rounded-full bg-gf-accent flex items-center justify-center text-gf-inverse text-xs font-bold mr-3">
                    {user?.email?.charAt(0).toUpperCase()}
                  </div>
                  <div className="text-sm font-medium text-gf-heading truncate max-w-[120px]">
                    {user?.email}
                  </div>
                </div>
                <button onClick={handleSignOut} className="text-gf-muted">{Icons.logout}</button>
              </div>
              <div className="flex justify-center gap-2">
                <ThemeToggleButton size="sm" />
                <FloatingLanguageSwitcher mode="static" variant="compact" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 bg-gf-base border-b border-gf-border flex items-center justify-between px-4 sm:px-6 lg:px-8">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="md:hidden p-2 rounded-md text-gf-muted hover:text-gf-body hover:bg-gf-hover focus:outline-none focus:ring-2 focus:ring-inset focus:ring-gf-accent"
          >
            <span className="sr-only">{t('openSidebar')}</span>
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="flex-1 flex justify-end items-center space-x-4">
            {showSellfCTA && (
              <Link
                href="/about"
                className="hidden sm:inline-flex items-center px-4 py-2 rounded-full bg-gf-accent text-white text-xs font-bold hover:bg-gf-accent-hover hover:shadow-lg transition-all transform hover:scale-105"
              >
                <span className="mr-1.5">🚀</span>
                {t('getSellf', { defaultValue: 'Get Sellf' })}
              </Link>
            )}
            <div className="hidden md:flex md:items-center md:gap-1">
              <ThemeToggleButton size="sm" />
              <FloatingLanguageSwitcher mode="static" variant="compact" />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-gf-deep p-4 sm:p-6 lg:p-8">
          <DemoBanner />
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>

      {/* Update notification modal (auto-shown when update available) */}
      {(updateCheck.showModal || updateCheck.upgradeInProgress) && updateCheck.updateInfo && (
        <UpdateNotificationModal
          updateInfo={updateCheck.updateInfo}
          upgradeInProgress={updateCheck.upgradeInProgress}
          upgradeProgress={updateCheck.upgradeProgress}
          onUpgrade={updateCheck.startUpgrade}
          onDismiss={updateCheck.dismissUpdate}
        />
      )}
    </div>
  )
}