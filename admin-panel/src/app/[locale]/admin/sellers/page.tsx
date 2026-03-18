/**
 * Admin Sellers Management Page
 *
 * Lists all marketplace sellers with their status, Stripe Connect info,
 * and management actions (add, suspend, deprovision).
 *
 * Route: /admin/sellers
 *
 * @see src/lib/actions/sellers.ts — server actions
 * @see src/lib/stripe/connect.ts — Stripe Connect
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { checkMarketplaceAccess } from '@/lib/marketplace/feature-flag';
import { listSellers } from '@/lib/actions/sellers';
import type { SellerListItem } from '@/lib/actions/sellers';
import AddSellerForm from '@/components/admin/AddSellerForm';

// ===== HELPERS =====

function SellerStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-500/20 text-green-400 border-green-500/30',
    suspended: 'bg-red-500/20 text-red-400 border-red-500/30',
    pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  };

  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded border ${colors[status] || colors.pending}`}>
      {status}
    </span>
  );
}

function StripeStatusBadge({ connected, onboardingComplete }: { connected: boolean; onboardingComplete: boolean }) {
  if (!connected) {
    return (
      <span className="px-2 py-0.5 text-xs font-medium rounded border bg-gray-500/20 text-gray-400 border-gray-500/30">
        Not connected
      </span>
    );
  }

  if (onboardingComplete) {
    return (
      <span className="px-2 py-0.5 text-xs font-medium rounded border bg-green-500/20 text-green-400 border-green-500/30">
        Connected
      </span>
    );
  }

  return (
    <span className="px-2 py-0.5 text-xs font-medium rounded border bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
      Onboarding incomplete
    </span>
  );
}

function SellerRow({ seller }: { seller: SellerListItem }) {
  const isOwner = seller.schema_name === 'seller_main';
  const storefrontUrl = isOwner ? '/' : `/s/${seller.slug.replace(/_/g, '-')}`;

  return (
    <tr className="border-b border-sf-border hover:bg-sf-surface/50 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <a
            href={storefrontUrl}
            className="text-sf-heading font-medium hover:text-sf-accent transition-colors"
            title={`Open ${seller.display_name} storefront`}
          >
            {seller.display_name}
          </a>
          {isOwner && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
              Owner
            </span>
          )}
        </div>
        <div className="text-xs text-sf-muted mt-0.5">
          <a
            href={storefrontUrl}
            className="hover:text-sf-accent transition-colors"
          >
            {seller.slug} →
          </a>
        </div>
      </td>
      <td className="px-4 py-3">
        <SellerStatusBadge status={seller.status} />
      </td>
      <td className="px-4 py-3">
        <StripeStatusBadge
          connected={!!seller.stripe_account_id}
          onboardingComplete={seller.stripe_onboarding_complete}
        />
      </td>
      <td className="px-4 py-3 text-sf-body text-sm">
        {seller.platform_fee_percent}%
      </td>
      <td className="px-4 py-3 text-sf-muted text-xs font-mono">
        {seller.schema_name}
      </td>
      <td className="px-4 py-3 text-sf-muted text-xs">
        {new Date(seller.created_at).toLocaleDateString()}
      </td>
    </tr>
  );
}

// ===== PAGE =====

export default async function AdminSellersPage() {
  // Auth check
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: admin } = await supabase
    .from('admin_users')
    .select('id')
    .eq('user_id', user.id)
    .single();
  if (!admin) redirect('/');

  // Marketplace gate
  const access = await checkMarketplaceAccess();
  if (!access.accessible) {
    return (
      <div className="min-h-screen bg-sf-deep flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-sf-heading mb-2">Marketplace Not Enabled</h1>
          <p className="text-sf-muted">
            Set <code className="px-1.5 py-0.5 bg-sf-surface rounded text-sf-accent text-sm">MARKETPLACE_ENABLED=true</code> and configure a Sellf Pro license to access seller management.
          </p>
        </div>
      </div>
    );
  }

  // Load sellers
  const result = await listSellers();
  const sellers = result.data ?? [];

  return (
    <div className="min-h-screen bg-sf-deep">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-sf-heading">Sellers</h1>
            <p className="mt-1 text-sf-muted">
              Manage marketplace sellers, Stripe Connect status, and platform fees.
            </p>
          </div>
          <div className="text-sm text-sf-muted">
            {sellers.length} seller{sellers.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Add Seller Form */}
        <AddSellerForm />

        {/* Sellers Table */}
        {sellers.length === 0 ? (
          <div className="bg-sf-surface border border-sf-border rounded-lg p-12 text-center">
            <p className="text-sf-muted">No sellers yet. Use the form above to add one.</p>
          </div>
        ) : (
          <div className="bg-sf-surface border border-sf-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-sf-border bg-sf-deep/50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">Seller</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">Stripe</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">Fee</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">Schema</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">Created</th>
                </tr>
              </thead>
              <tbody>
                {sellers.map((seller) => (
                  <SellerRow key={seller.id} seller={seller} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Info */}
        <div className="mt-6 text-xs text-sf-muted space-y-1">
          <p>Seller provisioning: <code className="px-1 bg-sf-surface rounded">POST /api/stripe/connect/onboard</code></p>
          <p>Stripe Connect status: <code className="px-1 bg-sf-surface rounded">GET /api/stripe/connect/status?seller_id=...</code></p>
        </div>
      </div>
    </div>
  );
}
