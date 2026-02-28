/**
 * Order Bumps Management Page Component
 * 
 * 🤖 AI MAINTAINER NOTE:
 * Manages complementary product offers (upsells) displayed on the checkout page.
 * Key features:
 * - Links a main product to a bump product with a special price.
 * - Supports custom access duration for the bump product.
 * - Stable sorting by created_at DESC.
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Product } from '@/types';
import { useToast } from '@/contexts/ToastContext';
import OrderBumpFormModal from './OrderBumpFormModal';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { api } from '@/lib/api/client';

interface OrderBumpWithDetails {
  id: string;
  main_product_id: string;
  bump_product_id: string;
  bump_price: number | null;
  bump_title: string;
  bump_description: string | null;
  is_active: boolean;
  display_order: number;
  access_duration_days: number | null;
  created_at: string;
  updated_at: string;
  main_product: {
    id: string;
    name: string;
    slug: string;
    currency: string;
  };
  bump_product: {
    id: string;
    name: string;
    slug: string;
    price: number;
    currency: string;
  };
}

const OrderBumpsPageContent: React.FC = () => {
  const { addToast } = useToast();
  const t = useTranslations('admin.orderBumps');

  // State for order bumps and loading status
  const [orderBumps, setOrderBumps] = useState<OrderBumpWithDetails[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // State for modals
  const [showBumpForm, setShowBumpForm] = useState(false);
  const [editingBump, setEditingBump] = useState<OrderBumpWithDetails | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [bumpToDelete, setBumpToDelete] = useState<OrderBumpWithDetails | null>(null);

  // Fetch products for dropdown using v1 API
  const fetchProducts = useCallback(async () => {
    try {
      setLoadingProducts(true);
      const response = await api.list<Product>('products', {
        limit: 1000,
        status: 'active',
        sort: 'name',
      });
      setProducts(response.data || []);
    } catch (err) {
      console.error('Error fetching products:', err);
    } finally {
      setLoadingProducts(false);
    }
  }, []);

  // Fetch order bumps from the v1 API
  const fetchOrderBumps = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const orderBumps = await api.getCustom<OrderBumpWithDetails[]>('order-bumps');
      setOrderBumps(orderBumps || []);
    } catch (err) {
      setError(t('loadError'));
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial data fetch
  useEffect(() => {
    fetchOrderBumps();
    fetchProducts();
  }, [fetchOrderBumps, fetchProducts]);

  // CRUD Handlers
  const handleCreateBump = async (formData: any) => {
    setSubmitting(true);
    try {
      await api.create('order-bumps', formData);

      setShowBumpForm(false);
      await fetchOrderBumps();
      addToast(t('createSuccess'), 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : t('createError'), 'error');
      return Promise.reject(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateBump = async (formData: any) => {
    if (!editingBump) return Promise.reject(new Error('No bump selected for editing'));
    setSubmitting(true);

    try {
      await api.update('order-bumps', editingBump.id, formData);

      setShowBumpForm(false);
      setEditingBump(null);
      await fetchOrderBumps();
      addToast(t('updateSuccess'), 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : t('updateError'), 'error');
      return Promise.reject(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteBump = async (bump: OrderBumpWithDetails) => {
    try {
      await api.delete('order-bumps', bump.id);

      setBumpToDelete(null);
      await fetchOrderBumps();
      addToast(t('deleteSuccess'), 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : t('deleteError'), 'error');
    }
  };

  const handleToggleActive = async (bump: OrderBumpWithDetails) => {
    try {
      await api.update('order-bumps', bump.id, { is_active: !bump.is_active });

      await fetchOrderBumps();
      addToast(
        t('toggleSuccess', { status: t(!bump.is_active ? 'activated' : 'deactivated') }),
        'success'
      );
    } catch (err) {
      addToast(err instanceof Error ? err.message : t('statusError'), 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gf-heading">
            {t('title')}
          </h1>
          <p className="text-gf-body mt-2">
            {t('description')}
          </p>
        </div>
        <button
          onClick={() => {
            setEditingBump(null);
            setShowBumpForm(true);
          }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2 shadow-sm"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>{t('create')}</span>
        </button>
      </div>

      {/* Stats Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gf-base rounded-xl shadow-sm border border-gf-border p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gf-body">{t('stats.total')}</p>
              <p className="text-2xl font-bold text-gf-heading mt-1">
                {orderBumps.length}
              </p>
            </div>
            <div className="w-12 h-12 bg-gf-accent-soft rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-gf-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-gf-base rounded-xl shadow-sm border border-gf-border p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gf-body">{t('stats.active')}</p>
              <p className="text-2xl font-bold text-gf-heading mt-1">
                {orderBumps.filter(b => b.is_active).length}
              </p>
            </div>
            <div className="w-12 h-12 bg-gf-success-soft rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-gf-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-gf-base rounded-xl shadow-sm border border-gf-border p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gf-body">{t('stats.inactive')}</p>
              <p className="text-2xl font-bold text-gf-heading mt-1">
                {orderBumps.filter(b => !b.is_active).length}
              </p>
            </div>
            <div className="w-12 h-12 bg-gf-raised rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-gf-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-gf-base rounded-xl shadow-sm border border-gf-border overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center p-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gf-accent"></div>
          </div>
        ) : error ? (
          <div className="text-center p-12 text-red-500">{error}</div>
        ) : orderBumps.length === 0 ? (
          <div className="text-center p-12">
            <div className="w-16 h-16 bg-gf-raised rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gf-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gf-heading mb-2">
              {t('noBumps')}
            </h3>
            <button
              onClick={() => {
                setEditingBump(null);
                setShowBumpForm(true);
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
            >
              {t('create')}
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gf-raised">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">
                    {t('mainProduct')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">
                    {t('bumpProduct')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">
                    {t('price')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">
                    {t('status')}
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gf-muted uppercase tracking-wider">
                    {t('actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-gf-base divide-y divide-gf-border">
                {orderBumps.map((bump) => (
                  <tr key={bump.id} className="hover:bg-gf-hover transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Link
                        href={`/p/${bump.main_product.slug}`}
                        className="group block"
                      >
                        <div className="text-sm font-medium text-gf-heading group-hover:text-gf-accent transition-colors">
                          {bump.main_product.name}
                        </div>
                        <div className="text-sm text-gf-muted font-mono group-hover:text-gf-accent transition-colors">
                          /{bump.main_product.slug}
                        </div>
                      </Link>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-semibold text-gf-accent">
                        {bump.bump_title}
                      </div>
                      <Link
                        href={`/p/${bump.bump_product.slug}`}
                        className="text-xs text-gf-muted hover:text-gf-accent transition-colors"
                      >
                        {bump.bump_product.name}
                      </Link>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-bold text-gf-heading">
                        {bump.bump_price !== null ? bump.bump_price : bump.bump_product.price} {bump.main_product.currency}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button
                        onClick={() => handleToggleActive(bump)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          bump.is_active
                            ? 'bg-gf-success-soft text-gf-success hover:bg-gf-success-soft'
                            : 'bg-gf-raised text-gf-muted hover:bg-gf-hover'
                        }`}
                      >
                        {t(bump.is_active ? 'active' : 'inactive')}
                      </button>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end space-x-3">
                        <button
                          onClick={() => {
                            setEditingBump(bump);
                            setShowBumpForm(true);
                          }}
                          className="text-gf-accent hover:opacity-80"
                        >
                          {t('edit')}
                        </button>
                        <button
                          onClick={() => setBumpToDelete(bump)}
                          className="text-gf-danger hover:opacity-80"
                        >
                          {t('delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Order Bump Form Modal */}
      {showBumpForm && (
        <OrderBumpFormModal
          products={products}
          loadingProducts={loadingProducts}
          editingBump={editingBump}
          onSubmit={editingBump ? handleUpdateBump : handleCreateBump}
          onClose={() => {
            setShowBumpForm(false);
            setEditingBump(null);
          }}
          isSubmitting={submitting}
        />
      )}

      {/* Delete Confirmation Modal */}
      {bumpToDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-gf-base rounded-xl shadow-2xl max-w-md w-full p-6 border border-gf-border">
            <h3 className="text-lg font-bold text-gf-heading mb-4">
              {t('confirmDelete')}
            </h3>
            <p className="text-gf-body mb-6">
              {t('deleteMessage')}
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setBumpToDelete(null)}
                className="px-4 py-2 text-gf-body hover:bg-gf-hover rounded-lg transition-colors"
              >
                {t('form.cancel')}
              </button>
              <button
                onClick={() => handleDeleteBump(bumpToDelete)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors shadow-sm"
              >
                {t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderBumpsPageContent;