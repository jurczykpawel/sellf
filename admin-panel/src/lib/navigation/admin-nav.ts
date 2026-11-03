/**
 * Admin sidebar information architecture: sales handling and reports, product
 * catalogue, system configuration (owner proposal, demo feedback 2026-10-29 #13).
 * Labels are `navigation.*` message keys; icons are resolved in DashboardLayout.
 * @see src/components/DashboardLayout.tsx
 */
export type AdminNavIcon =
  | 'dashboard' | 'payments' | 'refunds' | 'licenses' | 'users' | 'affiliates'
  | 'products' | 'variants' | 'categories' | 'templates' | 'orderBumps' | 'coupons'
  | 'webhooks' | 'integrations' | 'apiKeys' | 'settings';

export interface AdminNavItem {
  href: string;
  labelKey: string;
  icon: AdminNavIcon;
  exact?: boolean;
  badge?: 'pendingRefunds' | 'failedWebhooks';
}

export interface AdminNavGroup {
  id: 'sales' | 'products' | 'system';
  labelKey: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    id: 'sales',
    labelKey: 'navGroupSales',
    items: [
      { href: '/dashboard', labelKey: 'dashboard', icon: 'dashboard', exact: true },
      { href: '/dashboard/payments', labelKey: 'payments', icon: 'payments' },
      { href: '/dashboard/refund-requests', labelKey: 'refundRequests', icon: 'refunds', badge: 'pendingRefunds' },
      { href: '/dashboard/licenses', labelKey: 'licenses', icon: 'licenses' },
      { href: '/dashboard/users', labelKey: 'users', icon: 'users' },
      { href: '/dashboard/affiliates', labelKey: 'affiliates', icon: 'affiliates' },
    ],
  },
  {
    id: 'products',
    labelKey: 'navGroupProducts',
    items: [
      { href: '/dashboard/products', labelKey: 'products', icon: 'products' },
      { href: '/dashboard/variants', labelKey: 'variants', icon: 'variants' },
      { href: '/dashboard/categories', labelKey: 'categories', icon: 'categories' },
      { href: '/dashboard/templates', labelKey: 'templates', icon: 'templates' },
      { href: '/dashboard/order-bumps', labelKey: 'orderBumps', icon: 'orderBumps' },
      { href: '/dashboard/coupons', labelKey: 'coupons', icon: 'coupons' },
    ],
  },
  {
    id: 'system',
    labelKey: 'navGroupSystem',
    items: [
      { href: '/dashboard/webhooks', labelKey: 'webhooks', icon: 'webhooks', badge: 'failedWebhooks' },
      { href: '/dashboard/integrations', labelKey: 'integrations', icon: 'integrations' },
      { href: '/dashboard/api-keys', labelKey: 'apiKeys', icon: 'apiKeys' },
      { href: '/dashboard/settings', labelKey: 'settings', icon: 'settings' },
    ],
  },
];
