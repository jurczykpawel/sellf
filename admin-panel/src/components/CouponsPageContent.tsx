/**
 * Coupons Management Page Component
 *
 * 🤖 AI MAINTAINER NOTE:
 * This component manages the lifecycle of discount codes (Smart Coupons).
 * Key features:
 * - Server-paginated list (see `fetchCouponsPage`) with type/search filters
 *   applied server-side — the OTO system auto-generates a coupon per
 *   qualifying purchase, so a busy shop's coupon table can grow to any size
 *   and must never be pulled into the browser all at once.
 * - Create/Edit coupons via CouponFormModal
 * - Frictionless auto-apply logic is handled separately in PaidProductForm
 * - Supports global, product-specific, and email-restricted coupons
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Coupon } from '@/types/coupon';
import { toast } from 'sonner';
import CouponFormModal from './CouponFormModal';
import { Product } from '@/types';
import { useTranslations } from 'next-intl';
import { api, ApiError } from '@/lib/api/client';
import { fetchAllProductsForDropdown } from '@/hooks/useProducts';
import { fetchCouponsPage } from '@/lib/coupons/fetch-coupons-page';

// Wait for the seller to stop typing before hitting the server — avoids
// firing a request (and a fresh cursor-reset fetch) on every keystroke.
const SEARCH_DEBOUNCE_MS = 400;

// The DB field is the source of truth (set only by the OTO system's own
// functions, see `is_oto_coupon` in `supabase/migrations/20251230000000_oto_system.sql`).
const isOtoCoupon = (coupon: Coupon): boolean => coupon.is_oto_coupon;

const canDeleteCoupon = (coupon: Coupon): boolean => {
  return coupon.current_usage_count === 0;
};

// Helper to get expiry status for OTO coupons
const getOtoExpiryStatus = (coupon: Coupon): {
  isExpired: boolean;
  expiresAt: Date | null;
  minutesRemaining: number;
} => {
  if (!coupon.expires_at) {
    return { isExpired: false, expiresAt: null, minutesRemaining: 0 };
  }
  const expiresAt = new Date(coupon.expires_at);
  const now = new Date();
  const isExpired = expiresAt < now;
  const minutesRemaining = isExpired ? 0 : Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60));
  return { isExpired, expiresAt, minutesRemaining };
};

// Helper to get restricted product names
const getRestrictedProducts = (coupon: Coupon, products: Product[]): string[] => {
  const allowedIds = coupon.allowed_product_ids as string[] | null;
  if (!allowedIds || allowedIds.length === 0) return [];
  return allowedIds
    .map(id => products.find(p => p.id === id)?.name)
    .filter((name): name is string => !!name);
};

const CouponsPageContent: React.FC = () => {
  const t = useTranslations('admin.coupons');

  // State
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | 'oto' | 'regular'>('all');

  // Search: local, immediately-updated copy so typing feels responsive; the
  // debounced value below is what actually drives the server request.
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  // The visible input can change before the debounced query and its cursor.
  const searchPending = searchInput !== searchTerm;

  // Pagination — the coupons table can grow without bound (the OTO system
  // auto-generates a coupon per qualifying purchase), so only one page loads
  // at a time; "Load more" fetches subsequent pages instead of pulling
  // everything into the browser at once (mirrors the payments dashboard).
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Full, authoritative list of expired coupons for the "Delete expired"
  // housekeeping action. Loaded separately from the paginated main list (via
  // the existing `status=expired` filter) so that action always sees every
  // expired coupon, not just whatever happens to be on the currently loaded
  // page(s) of the main list.
  const [expiredCoupons, setExpiredCoupons] = useState<Coupon[]>([]);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [couponToDelete, setCouponToDelete] = useState<Coupon | null>(null);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [showDeleteExpiredConfirm, setShowDeleteExpiredConfirm] = useState(false);

  // Debounce search input -> searchTerm (drives the server request).
  useEffect(() => {
    if (searchInput === searchTerm) return;
    const timeout = setTimeout(() => setSearchTerm(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchInput, searchTerm]);

  // Fetch the first page of coupons (type/search filtered), the full expired
  // list (for "Delete expired"), and the active products picker list.
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      const [couponsPage, expiredResult, activeProducts] = await Promise.all([
        fetchCouponsPage(undefined, { type: typeFilter, search: searchTerm }),
        api.listAll<Coupon>('coupons', { status: 'expired', sort: '-created_at' }),
        fetchAllProductsForDropdown('active'),
      ]);

      if (expiredResult.truncated) {
        console.warn('[CouponsPageContent] Expired coupon list truncated at the safety ceiling; "Delete expired" may not catch every expired coupon.');
      }

      setCoupons(couponsPage.coupons);
      setCursor(couponsPage.nextCursor);
      setHasMore(couponsPage.hasMore);
      setExpiredCoupons(expiredResult.data);
      setProducts(activeProducts);
      setError(null);
    } catch (err) {
      console.error('Error fetching data:', err);
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(t('loadError'));
      }
    } finally {
      setLoading(false);
    }
  }, [typeFilter, searchTerm, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleLoadMore = useCallback(async () => {
    if (!hasMore || loading || loadingMore || searchPending) return;

    setLoadingMore(true);
    try {
      const nextPage = await fetchCouponsPage(cursor ?? undefined, { type: typeFilter, search: searchTerm });
      setCoupons(prev => [...prev, ...nextPage.coupons]);
      setCursor(nextPage.nextCursor);
      setHasMore(nextPage.hasMore);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error(t('moreLoadError'));
      }
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loading, loadingMore, searchPending, cursor, typeFilter, searchTerm, t]);

  const deletableCoupons = coupons.filter(canDeleteCoupon);
  const deletableExpiredCoupons = expiredCoupons.filter(canDeleteCoupon);

  // CRUD Handlers using v1 API
  const handleCreate = async (formData: any) => {
    setIsSubmitting(true);
    try {
      await api.create<Coupon>('coupons', formData);

      await fetchData();
      setShowForm(false);
      toast.success(t('createSuccess'));
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error(t('createError'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async (formData: any) => {
    if (!editingCoupon) return;
    setIsSubmitting(true);
    try {
      await api.update<Coupon>('coupons', editingCoupon.id, formData);

      await fetchData();
      setShowForm(false);
      setEditingCoupon(null);
      toast.success(t('updateSuccess'));
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error(t('updateError'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (coupon: Coupon) => {
    try {
      await api.delete('coupons', coupon.id);

      await fetchData();
      setCouponToDelete(null);
      toast.success(t('deleteSuccess'));
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error(t('deleteError'));
      }
    }
  };

  const handleToggleActive = async (coupon: Coupon) => {
    try {
      await api.update<Coupon>('coupons', coupon.id, { is_active: !coupon.is_active });

      await fetchData();
      toast.success(t('toggleSuccess', { status: t(!coupon.is_active ? 'activated' : 'deactivated') }));
    } catch {
      toast.error(t('statusError'));
    }
  };

  // Selection handlers. Selection (and therefore bulk delete) only ever
  // covers coupons currently loaded in the browser — the same page(s) the
  // seller can see and check — not the full server-side result set.
  const handleSelectAll = () => {
    if (selectedIds.size === deletableCoupons.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(deletableCoupons.map(c => c.id)));
    }
  };

  const handleSelectOne = (id: string) => {
    const coupon = coupons.find(c => c.id === id);
    if (coupon && !canDeleteCoupon(coupon)) return;

    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleBulkDelete = async () => {
    try {
      const deletableIds = new Set(deletableCoupons.map(c => c.id));
      const ids = Array.from(selectedIds).filter(id => deletableIds.has(id));
      const skipped = selectedIds.size - ids.length;
      let failed = 0;

      // Delete sequentially to avoid race conditions
      for (const id of ids) {
        try {
          await api.delete('coupons', id);
        } catch {
          failed++;
        }
      }

      await fetchData();
      setSelectedIds(new Set());
      setShowBulkDeleteConfirm(false);

      if (failed > 0 || skipped > 0) {
        toast.warning(t('bulkDeletePartial', { deleted: ids.length - failed, failed: failed + skipped }));
      } else {
        toast.success(t('bulkDeleteSuccess', { count: ids.length }));
      }
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error(t('bulkDeleteError'));
      }
    }
  };

  const handleDeleteExpired = async () => {
    try {
      let failed = 0;

      // Delete sequentially to avoid race conditions
      for (const coupon of deletableExpiredCoupons) {
        try {
          await api.delete('coupons', coupon.id);
        } catch {
          failed++;
        }
      }

      await fetchData();
      setSelectedIds(new Set());
      setShowDeleteExpiredConfirm(false);

      if (failed > 0) {
        toast.warning(t('deleteExpiredPartial', { deleted: deletableExpiredCoupons.length - failed, failed }));
      } else {
        toast.success(t('deleteExpiredSuccess', { count: deletableExpiredCoupons.length }));
      }
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error(t('deleteExpiredError'));
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-[40px] font-[800] text-sf-heading tracking-[-0.03em] leading-[1.1]">{t('title')}</h1>
          <p className="text-sf-body mt-2">{t('description')}</p>
        </div>
        <button
          onClick={() => { setEditingCoupon(null); setShowForm(true); }}
          className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 transition-colors flex items-center space-x-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>{t('create')}</span>
        </button>
      </div>

      {/* Type Filter, Search & Bulk Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-2">
            {(['all', 'regular', 'oto'] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => { setTypeFilter(filter); setSelectedIds(new Set()); }}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  typeFilter === filter
                    ? 'bg-blue-600 text-white'
                    : 'bg-sf-raised text-sf-body hover:bg-sf-hover'
                }`}
              >
                {t(`filter.${filter}`)}
              </button>
            ))}
          </div>

          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('search')}
            className="w-full sm:w-56 px-3 py-1.5 text-sm border-2 border-sf-border-medium focus:outline-none focus:ring-2 focus:ring-sf-accent bg-sf-input text-sf-heading"
          />
        </div>

        <div className="flex gap-2">
          {deletableExpiredCoupons.length > 0 && (
            <button
              onClick={() => setShowDeleteExpiredConfirm(true)}
              className="px-3 py-1.5 text-sm font-medium bg-amber-700 text-white hover:bg-amber-700 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {t('deleteExpired', { count: deletableExpiredCoupons.length })}
            </button>
          )}

          {selectedIds.size > 0 && (
            <button
              onClick={() => setShowBulkDeleteConfirm(true)}
              className="px-3 py-1.5 text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              {t('bulkDelete', { count: selectedIds.size })}
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-sf-base border-2 border-sf-border-medium overflow-hidden">
        {loading ? (
          <div className="flex justify-center p-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sf-accent"></div>
          </div>
        ) : error ? (
          <div className="text-center p-12 text-red-500">{error}</div>
        ) : coupons.length === 0 ? (
          <div className="text-center p-12 text-sf-muted">{t('noCoupons')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-sf-raised">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={deletableCoupons.length > 0 && selectedIds.size === deletableCoupons.length}
                      onChange={handleSelectAll}
                      disabled={deletableCoupons.length === 0}
                      aria-label={t('selectAll', { defaultValue: 'Select all coupons' })}
                      className="w-4 h-4 rounded border-sf-border text-sf-accent focus:ring-sf-accent disabled:opacity-40"
                    />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase">{t('code')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase">{t('discount')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase">{t('usage')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase">{t('status')}</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-sf-muted uppercase">{t('actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sf-border">
                {coupons.map((coupon, index) => {
                  const isOto = isOtoCoupon(coupon);
                  const otoStatus = isOto ? getOtoExpiryStatus(coupon) : null;
                  const restrictedProducts = getRestrictedProducts(coupon, products);
                  const isDeletable = canDeleteCoupon(coupon);

                  return (
                    <tr key={coupon.id} className={`hover:bg-sf-hover ${selectedIds.has(coupon.id) ? 'bg-sf-accent-soft' : index % 2 === 1 ? 'bg-sf-row-alt' : ''}`}>
                      <td className="px-4 py-4 w-10">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(coupon.id)}
                          onChange={() => handleSelectOne(coupon.id)}
                          disabled={!isDeletable}
                          aria-label={`${t('select', { defaultValue: 'Select' })} ${coupon.code}`}
                          className="w-4 h-4 rounded border-sf-border text-sf-accent focus:ring-sf-accent disabled:opacity-40"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-sf-accent">{coupon.code}</span>
                          {isOto && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-sf-accent-soft text-sf-accent">
                              OTO
                            </span>
                          )}
                        </div>
                        {coupon.name && <div className="text-xs text-sf-muted">{coupon.name}</div>}
                        {restrictedProducts.length > 0 && (
                          <div className="text-xs text-sf-muted mt-1 flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                            </svg>
                            {restrictedProducts.join(', ')}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-sf-heading">
                        {coupon.discount_type === 'percentage'
                          ? `${coupon.discount_value}%`
                          : `${coupon.discount_value} ${coupon.currency || t('allCurrencies')}`}
                      </td>
                      <td className="px-6 py-4 text-sm text-sf-muted">
                        {t(coupon.usage_limit_global ? 'usageCount' : 'usageUnlimited', {
                          current: coupon.current_usage_count,
                          limit: coupon.usage_limit_global || 0
                        })}
                      </td>
                      <td className="px-6 py-4">
                        {isOto ? (
                          // OTO coupons show expiry status instead of toggle
                          <span
                            className={`px-3 py-1 text-xs font-medium ${
                              otoStatus?.isExpired
                                ? 'bg-sf-danger-soft text-sf-danger'
                                : 'bg-sf-warning-soft text-sf-warning'
                            }`}
                            title={otoStatus?.expiresAt ? otoStatus.expiresAt.toLocaleString() : ''}
                          >
                            {otoStatus?.isExpired
                              ? t('otoExpired')
                              : t('otoExpiresIn', { minutes: otoStatus?.minutesRemaining || 0 })
                            }
                          </span>
                        ) : (
                          // Regular coupons have active/inactive toggle
                          <button
                            onClick={() => handleToggleActive(coupon)}
                            className={`px-3 py-1 text-xs font-medium ${
                              coupon.is_active
                                ? 'bg-sf-success-soft text-sf-success'
                                : 'bg-sf-raised text-sf-muted'
                            }`}
                          >
                            {t(coupon.is_active ? 'active' : 'inactive')}
                          </button>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right space-x-2">
                        {!isDeletable ? (
                          <span className="text-xs text-sf-muted" title={t('usedCouponLockedHint')}>
                            {t('usedCouponLocked')}
                          </span>
                        ) : isOto ? (
                          <button onClick={() => setCouponToDelete(coupon)} className="text-sf-danger hover:opacity-80">{t('delete')}</button>
                        ) : (
                          <>
                            <button onClick={() => { setEditingCoupon(coupon); setShowForm(true); }} className="text-sf-accent hover:opacity-80">{t('edit')}</button>
                            <button onClick={() => setCouponToDelete(coupon)} className="text-sf-danger hover:opacity-80">{t('delete')}</button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && !error && hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore || searchPending}
            className="px-4 py-2 text-sm font-medium text-sf-accent border-2 border-sf-border-medium hover:bg-sf-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loadingMore ? t('loadingMore') : t('loadMore')}
          </button>
        </div>
      )}

      {/* Modals */}
      {showForm && (
        <CouponFormModal
          products={products}
          editingCoupon={editingCoupon}
          onSubmit={editingCoupon ? handleUpdate : handleCreate}
          onClose={() => { setShowForm(false); setEditingCoupon(null); }}
          isSubmitting={isSubmitting}
        />
      )}

      {/* Delete Confirmation */}
      {couponToDelete && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-sf-base p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4 text-sf-heading">{t('confirmDelete')}</h3>
            <p className="text-sf-body mb-6">
              {t('deleteMessage', { code: couponToDelete.code })}
            </p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setCouponToDelete(null)} className="px-4 py-2 text-sf-body hover:bg-sf-hover">{t('form.cancel')}</button>
              <button onClick={() => handleDelete(couponToDelete)} className="px-4 py-2 bg-red-600 text-white hover:bg-red-700">{t('delete')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation */}
      {showBulkDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-sf-base p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4 text-sf-heading">{t('confirmBulkDelete')}</h3>
            <p className="text-sf-body mb-6">
              {t('bulkDeleteMessage', { count: selectedIds.size })}
            </p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setShowBulkDeleteConfirm(false)} className="px-4 py-2 text-sf-body hover:bg-sf-hover">{t('form.cancel')}</button>
              <button onClick={handleBulkDelete} className="px-4 py-2 bg-red-600 text-white hover:bg-red-700">{t('bulkDelete', { count: selectedIds.size })}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Expired Confirmation */}
      {showDeleteExpiredConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-sf-base p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4 text-sf-heading">{t('confirmDeleteExpired')}</h3>
            <p className="text-sf-body mb-6">
              {t('deleteExpiredMessage', { count: deletableExpiredCoupons.length })}
            </p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setShowDeleteExpiredConfirm(false)} className="px-4 py-2 text-sf-body hover:bg-sf-hover">{t('form.cancel')}</button>
              <button onClick={handleDeleteExpired} className="px-4 py-2 bg-amber-700 text-white hover:bg-amber-700">{t('deleteExpired', { count: deletableExpiredCoupons.length })}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CouponsPageContent;
